#!/usr/bin/env python3
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class StoredStory:
    story_key: str
    category: str
    canonical_title: str
    canonical_url: str
    source: str
    last_seen_at: datetime | None
    confirmation_count: int


class DigestStore:
    def __init__(self, conninfo: str) -> None:
        self.conninfo = conninfo

    @classmethod
    def from_env(cls) -> "DigestStore | None":
        user = os.environ.get("POSTGRES_USER", "").strip()
        password = os.environ.get("POSTGRES_PASSWORD", "").strip()
        database = os.environ.get("POSTGRES_DB", "").strip()
        if not user or not password or not database:
            return None
        host = os.environ.get("POSTGRES_HOST", "postgres").strip() or "postgres"
        port = os.environ.get("POSTGRES_PORT", "5432").strip() or "5432"
        conninfo = (
            f"host={host} port={port} dbname={database} "
            f"user={user} password={password}"
        )
        return cls(conninfo)

    def _connect(self) -> Any:
        import psycopg

        return psycopg.connect(self.conninfo)

    def ensure_schema(self) -> None:
        ddl = """
        CREATE TABLE IF NOT EXISTS digest_runs (
            id BIGSERIAL PRIMARY KEY,
            report_date DATE NOT NULL,
            delivery_mode TEXT NOT NULL,
            article_count INTEGER NOT NULL,
            max_articles INTEGER NOT NULL,
            errors JSONB NOT NULL DEFAULT '[]'::jsonb,
            sources JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS digest_story_clusters (
            id BIGSERIAL PRIMARY KEY,
            story_key TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            canonical_title TEXT NOT NULL,
            canonical_url TEXT NOT NULL,
            source TEXT NOT NULL,
            latest_summary TEXT NOT NULL DEFAULT '',
            first_seen_at TIMESTAMPTZ,
            last_seen_at TIMESTAMPTZ,
            latest_published_at TIMESTAMPTZ,
            latest_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
            latest_duplicate_count INTEGER NOT NULL DEFAULT 1,
            confirmation_count INTEGER NOT NULL DEFAULT 1,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS digest_articles (
            id BIGSERIAL PRIMARY KEY,
            url TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            source TEXT NOT NULL,
            category TEXT NOT NULL,
            published_at TIMESTAMPTZ,
            raw_summary TEXT NOT NULL DEFAULT '',
            first_seen_at TIMESTAMPTZ,
            last_seen_at TIMESTAMPTZ,
            latest_story_key TEXT NOT NULL DEFAULT '',
            enrichment_status TEXT NOT NULL DEFAULT 'not_requested',
            enriched_title TEXT,
            enriched_description TEXT,
            enriched_text TEXT,
            enriched_word_count INTEGER NOT NULL DEFAULT 0,
            enriched_fetched_at TIMESTAMPTZ,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS digest_story_articles (
            story_id BIGINT NOT NULL REFERENCES digest_story_clusters(id) ON DELETE CASCADE,
            article_id BIGINT NOT NULL REFERENCES digest_articles(id) ON DELETE CASCADE,
            run_id BIGINT NOT NULL REFERENCES digest_runs(id) ON DELETE CASCADE,
            is_canonical BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (story_id, article_id, run_id)
        );

        CREATE TABLE IF NOT EXISTS digest_story_snapshots (
            id BIGSERIAL PRIMARY KEY,
            story_id BIGINT NOT NULL REFERENCES digest_story_clusters(id) ON DELETE CASCADE,
            run_id BIGINT NOT NULL REFERENCES digest_runs(id) ON DELETE CASCADE,
            report_date DATE NOT NULL,
            is_selected BOOLEAN NOT NULL DEFAULT FALSE,
            editorial_score DOUBLE PRECISION NOT NULL DEFAULT 0,
            impact_score INTEGER NOT NULL DEFAULT 0,
            novelty_score INTEGER NOT NULL DEFAULT 0,
            confirmation_score INTEGER NOT NULL DEFAULT 0,
            scope_fit_score INTEGER NOT NULL DEFAULT 0,
            urgency_score INTEGER NOT NULL DEFAULT 0,
            duplicate_count INTEGER NOT NULL DEFAULT 1,
            changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS digest_story_clusters_last_seen_idx
            ON digest_story_clusters (last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS digest_story_clusters_category_idx
            ON digest_story_clusters (category);
        CREATE INDEX IF NOT EXISTS digest_articles_last_seen_idx
            ON digest_articles (last_seen_at DESC);
        CREATE INDEX IF NOT EXISTS digest_story_snapshots_story_report_idx
            ON digest_story_snapshots (story_id, report_date DESC);
        """
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(ddl)
            conn.commit()

    def load_recent_stories(self, lookback_days: int = 7) -> list[StoredStory]:
        sql = """
        SELECT
            story_key,
            category,
            canonical_title,
            canonical_url,
            source,
            last_seen_at,
            confirmation_count
        FROM digest_story_clusters
        WHERE last_seen_at >= NOW() - (%s * INTERVAL '1 day')
        ORDER BY last_seen_at DESC
        """
        stories: list[StoredStory] = []
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, (lookback_days,))
                for row in cur.fetchall():
                    stories.append(
                        StoredStory(
                            story_key=str(row[0]),
                            category=str(row[1]),
                            canonical_title=str(row[2]),
                            canonical_url=str(row[3]),
                            source=str(row[4]),
                            last_seen_at=row[5],
                            confirmation_count=int(row[6] or 1),
                        )
                    )
        return stories

    def persist_digest_run(
        self,
        *,
        report_date: str,
        delivery_mode: str,
        article_count: int,
        max_articles: int,
        errors: list[str],
        sources: list[dict[str, Any]],
        metadata: dict[str, Any],
        stories: list[Any],
        selected_story_keys: set[str],
    ) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO digest_runs (
                        report_date,
                        delivery_mode,
                        article_count,
                        max_articles,
                        errors,
                        sources,
                        metadata
                    )
                    VALUES (
                        %s,
                        %s,
                        %s,
                        %s,
                        %s::jsonb,
                        %s::jsonb,
                        %s::jsonb
                    )
                    RETURNING id
                    """,
                    (
                        report_date,
                        delivery_mode,
                        article_count,
                        max_articles,
                        self._json(errors),
                        self._json(sources),
                        self._json(metadata),
                    ),
                )
                run_id = int(cur.fetchone()[0])
                for story in stories:
                    story_id = self._upsert_story(cur, story)
                    article_id = self._upsert_article(cur, story)
                    snapshot_metadata = self._snapshot_metadata(story)
                    cur.execute(
                        """
                        INSERT INTO digest_story_articles (
                            story_id,
                            article_id,
                            run_id,
                            is_canonical
                        )
                        VALUES (%s, %s, %s, TRUE)
                        ON CONFLICT (story_id, article_id, run_id) DO NOTHING
                        """,
                        (story_id, article_id, run_id),
                    )
                    cur.execute(
                        """
                        INSERT INTO digest_story_snapshots (
                            story_id,
                            run_id,
                            report_date,
                            is_selected,
                            editorial_score,
                            impact_score,
                            novelty_score,
                            confirmation_score,
                            scope_fit_score,
                            urgency_score,
                            duplicate_count,
                            changed_fields,
                            metadata
                        )
                        VALUES (
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s,
                            %s::jsonb,
                            %s::jsonb
                        )
                        """,
                        (
                            story_id,
                            run_id,
                            report_date,
                            story.story_key in selected_story_keys,
                            self._story_editorial_score(story),
                            self._story_int(story, "impact_score"),
                            self._story_int(story, "novelty_score"),
                            self._story_int(story, "confirmation_score"),
                            self._story_int(story, "scope_fit_score"),
                            self._story_int(story, "urgency_score"),
                            self._story_int(story, "duplicate_count", default=1),
                            self._json(list(getattr(story, "changed_fields", []) or [])),
                            self._json(snapshot_metadata),
                        ),
                    )
            conn.commit()
        return run_id

    def _upsert_story(self, cur: Any, story: Any) -> int:
        published_at = getattr(story, "published_at", None)
        cur.execute(
            """
            INSERT INTO digest_story_clusters (
                story_key,
                category,
                canonical_title,
                canonical_url,
                source,
                latest_summary,
                first_seen_at,
                last_seen_at,
                latest_published_at,
                latest_scores,
                latest_duplicate_count,
                confirmation_count
            )
            VALUES (
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                NOW(),
                %s,
                %s::jsonb,
                %s,
                %s
            )
            ON CONFLICT (story_key) DO UPDATE SET
                category = EXCLUDED.category,
                canonical_title = EXCLUDED.canonical_title,
                canonical_url = EXCLUDED.canonical_url,
                source = EXCLUDED.source,
                latest_summary = EXCLUDED.latest_summary,
                last_seen_at = NOW(),
                latest_published_at = EXCLUDED.latest_published_at,
                latest_scores = EXCLUDED.latest_scores,
                latest_duplicate_count = EXCLUDED.latest_duplicate_count,
                confirmation_count = EXCLUDED.confirmation_count,
                updated_at = NOW()
            RETURNING id
            """,
            (
                story.story_key,
                story.category,
                story.title,
                story.url,
                story.source,
                story.summary,
                published_at,
                published_at,
                self._json(self._story_scores(story)),
                self._story_int(story, "duplicate_count", default=1),
                self._story_int(story, "source_count", default=1),
            ),
        )
        return int(cur.fetchone()[0])

    def _upsert_article(self, cur: Any, story: Any) -> int:
        published_at = getattr(story, "published_at", None)
        enriched_text = getattr(story, "enriched_text", None)
        cur.execute(
            """
            INSERT INTO digest_articles (
                url,
                title,
                source,
                category,
                published_at,
                raw_summary,
                first_seen_at,
                last_seen_at,
                latest_story_key,
                enrichment_status,
                enriched_title,
                enriched_description,
                enriched_text,
                enriched_word_count,
                enriched_fetched_at,
                metadata
            )
            VALUES (
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                NOW(),
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s,
                %s::jsonb
            )
            ON CONFLICT (url) DO UPDATE SET
                title = EXCLUDED.title,
                source = EXCLUDED.source,
                category = EXCLUDED.category,
                published_at = EXCLUDED.published_at,
                raw_summary = EXCLUDED.raw_summary,
                last_seen_at = NOW(),
                latest_story_key = EXCLUDED.latest_story_key,
                enrichment_status = EXCLUDED.enrichment_status,
                enriched_title = COALESCE(EXCLUDED.enriched_title, digest_articles.enriched_title),
                enriched_description = COALESCE(EXCLUDED.enriched_description, digest_articles.enriched_description),
                enriched_text = COALESCE(EXCLUDED.enriched_text, digest_articles.enriched_text),
                enriched_word_count = GREATEST(EXCLUDED.enriched_word_count, digest_articles.enriched_word_count),
                enriched_fetched_at = COALESCE(EXCLUDED.enriched_fetched_at, digest_articles.enriched_fetched_at),
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            RETURNING id
            """,
            (
                story.url,
                story.title,
                story.source,
                story.category,
                published_at,
                story.summary,
                published_at,
                story.story_key,
                getattr(story, "enrichment_status", "not_requested"),
                getattr(story, "enriched_title", None),
                getattr(story, "enriched_description", None),
                enriched_text,
                len(str(enriched_text or "").split()),
                getattr(story, "enriched_fetched_at", None),
                self._json(self._article_metadata(story)),
            ),
        )
        return int(cur.fetchone()[0])

    @staticmethod
    def _story_int(story: Any, field: str, *, default: int = 0) -> int:
        return int(getattr(story, field, default) or default)

    @staticmethod
    def _story_editorial_score(story: Any) -> float:
        return float(getattr(story, "editorial_score", 0.0) or 0.0)

    def _story_scores(self, story: Any) -> dict[str, int | float]:
        return {
            "editorial": self._story_editorial_score(story),
            "impact": self._story_int(story, "impact_score"),
            "novelty": self._story_int(story, "novelty_score"),
            "confirmation": self._story_int(story, "confirmation_score"),
            "scopeFit": self._story_int(story, "scope_fit_score"),
            "urgency": self._story_int(story, "urgency_score"),
        }

    @staticmethod
    def _snapshot_metadata(story: Any) -> dict[str, Any]:
        return {
            "matchedStoryKey": getattr(story, "matched_story_key", None),
            "matchedTitle": getattr(story, "matched_title", None),
            "matchedLastSeenAt": getattr(story, "matched_last_seen_at", None),
            "enrichmentStatus": getattr(story, "enrichment_status", "not_requested"),
            "aiKeep": getattr(story, "ai_keep", None),
            "aiReason": getattr(story, "ai_reason", None),
            "aiImportanceScore": getattr(story, "ai_importance_score", None),
            "aiScopeFitScore": getattr(story, "ai_scope_fit_score", None),
            "aiWarRelevanceScore": getattr(story, "ai_war_relevance_score", None),
            "aiEditorialAdjustment": getattr(story, "ai_editorial_adjustment", 0.0),
            "aiModel": getattr(story, "ai_model", None),
        }

    @staticmethod
    def _article_metadata(story: Any) -> dict[str, Any]:
        return {
            "duplicateSources": getattr(story, "duplicate_sources", []),
            "duplicateTitles": getattr(story, "duplicate_titles", []),
        }

    @staticmethod
    def _json(value: Any) -> str:
        import json

        return json.dumps(value, ensure_ascii=False, default=str)
