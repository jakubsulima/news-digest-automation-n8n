#!/usr/bin/env python3
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import http.client
import json
import math
import os
import re
import sys
import textwrap
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

from digest_store import DigestStore, StoredStory

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]


WARSAW_TZ = ZoneInfo("Europe/Warsaw") if ZoneInfo else timezone.utc
ROOT_DIR = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT_DIR / "config" / "rss-sources.json"
EDITORIAL_CONFIG_PATH = ROOT_DIR / "config" / "editorial-settings.json"
AI_EDITORIAL_REVIEW_PROMPT_PATH = ROOT_DIR / "prompts" / "ai-editorial-review.md"
DEFAULT_OUTPUT_DIR = ROOT_DIR / "storage" / "digests"
DEFAULT_MAX_ARTICLES = 30
MAX_ARTICLE_AGE_DAYS = 7
MAX_DEDUPE_CANDIDATES = 180
MAX_SUMMARY_LENGTH = 1400
MAX_AI_GROUPS = 30
DEFAULT_ENRICH_TOP_N = 12
RECENT_STORY_LOOKBACK_DAYS = 7
USER_AGENT = "daily-news-digest/3.0 (+n8n-python)"
TRACKING_PARAMS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "ref",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
    "at_campaign",
    "at_medium",
}
STOPWORDS = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "for",
    "of",
    "in",
    "on",
    "at",
    "with",
    "from",
    "by",
    "is",
    "are",
    "after",
    "into",
    "over",
    "under",
    "as",
    "new",
    "how",
    "why",
    "what",
    "when",
    "this",
    "that",
    "polska",
}
DEFAULT_EDITORIAL_CONFIG = {
    "matching": {
        "recent_story_lookback_days": RECENT_STORY_LOOKBACK_DAYS,
        "story_match_min_score": 0.68,
        "title_change_threshold": 0.92,
    },
    "enrichment": {
        "default_top_n": DEFAULT_ENRICH_TOP_N,
    },
    "ai_editorial_review": {
        "enabled": True,
        "shortlist_size": 24,
        "temperature": 0.1,
        "max_tokens": 2800,
        "max_abs_adjustment": 20,
        "reject_penalty": 18,
        "weight": 1.0,
    },
    "scoring": {
        "newsworthy_keywords": {
            "breach": 5,
            "exploit": 5,
            "vulnerability": 5,
            "ransomware": 5,
            "attack": 5,
            "zero-day": 5,
            "outage": 4,
            "incident": 4,
            "earnings": 4,
            "ipo": 4,
            "acquisition": 4,
            "merger": 4,
            "sanction": 4,
            "troops": 2,
            "war": 2,
            "tariff": 4,
            "rate cut": 4,
            "fed": 3,
            "ai": 3,
            "model": 3,
            "launch": 3,
            "security": 3,
            "cyber": 3,
            "gpw": 3,
            "gielda": 3,
        },
        "scope_keywords": {
            "ai": [
                "ai",
                "llm",
                "model",
                "openai",
                "anthropic",
                "nvidia",
                "deepmind",
                "inference",
            ],
            "devtools": [
                "developer",
                "devtools",
                "github",
                "gitlab",
                "programming",
                "software",
                "engineering",
                "compiler",
                "framework",
                "library",
                "agent",
                "cli",
            ],
            "poland_world": [
                "polska",
                "warsaw",
                "gospodarka",
                "economy",
                "market",
                "markets",
                "business",
                "macro",
                "macroekonomia",
                "geopolityka",
                "geopolitics",
                "security",
                "cybersecurity",
                "supply chain",
                "regulation",
                "policy",
            ],
        },
        "war_filter": {
            "signal_keywords": [
                "war",
                "troops",
                "missile",
                "missiles",
                "drone strike",
                "airstrike",
                "front line",
                "battlefield",
                "artillery",
                "offensive",
                "ceasefire",
                "military",
                "defense ministry",
            ],
            "relevance_keywords": [
                "sanction",
                "sanctions",
                "tariff",
                "markets",
                "market",
                "economy",
                "business",
                "energy",
                "gas",
                "oil",
                "chip",
                "chips",
                "semiconductor",
                "supply chain",
                "cyber",
                "cybersecurity",
                "technology",
                "tech",
                "policy",
                "regulation",
                "trade",
                "nato",
            ],
            "scope_fit_score": 3,
            "editorial_penalty": 18.0,
        },
        "impact": {
            "duplicate_weight_cap": 5,
            "duplicate_weight_multiplier": 2,
            "enriched_text_bonus": 2,
            "long_summary_threshold": 220,
            "long_summary_bonus": 1,
            "normalizer": 2.4,
        },
        "novelty": {
            "same_url_24h_max": 3,
            "same_story_24h_max": 5,
            "same_story_72h_max": 7,
            "older_story_max": 9,
        },
        "confirmation": {
            "score_for_1": 3,
            "score_for_2": 6,
            "score_for_3": 8,
            "score_for_4": 9,
            "score_for_5_plus": 10,
        },
        "scope_fit": {
            "ai_score": 10,
            "devtools_score": 9,
            "cyber_score": 9,
            "poland_world_score": 8,
            "default_score": 5,
        },
        "urgency": {
            "base_score": 2,
            "score_6h": 10,
            "score_24h": 8,
            "score_48h": 6,
            "score_72h": 5,
            "score_older": 3,
            "security_bonus": 1,
            "markets_bonus": 1,
        },
        "editorial_weights": {
            "impact": 4.0,
            "novelty": 2.5,
            "confirmation": 1.5,
            "scope_fit": 1.0,
            "urgency": 1.0,
        },
    },
}
_EDITORIAL_CONFIG_CACHE: dict[str, Any] | None = None
_EDITORIAL_CONFIG_MTIME_NS: int | None = None
DEFAULT_AI_EDITORIAL_REVIEW_PROMPT = """You are an editorial judge for a personal daily digest.

The user's priorities are:
- AI
- devtools / software engineering
- Poland and world economy
- tech policy
- cybersecurity
- geopolitics only when it materially affects markets, technology, supply chains, regulation, or cyber

Return strict JSON only.

You will receive shortlisted story clusters that already have heuristic scores.
Your job is to refine the shortlist, not to rewrite it from scratch.

For each candidate return one review item with keys:
- storyKey
- keep
- editorialAdjustment
- importance
- scopeFit
- warRelevance
- reason

Rules:
- editorialAdjustment must be an integer from -20 to 20
- use negative adjustments for generic war updates, repetitive stories, or low-signal items
- use positive adjustments for materially important items in the user's scope
- keep `reason` under 20 words
- if a war-related story has real impact on markets, chips, energy, policy, cybersecurity, regulation, or supply chains, do not treat it as generic war noise
"""


@dataclass(frozen=True)
class SourceConfig:
    name: str
    category: str
    url: str
    priority: int


@dataclass
class ArticleEnrichment:
    status: str
    fetched_at: str | None = None
    title: str | None = None
    description: str | None = None
    text: str | None = None


@dataclass
class Article:
    title: str
    source: str
    category: str
    priority: int
    summary: str
    url: str
    published_at: str | None
    duplicate_sources: list[str] = field(default_factory=list)
    duplicate_titles: list[str] = field(default_factory=list)
    duplicate_count: int = 1
    story_key: str = ""
    source_count: int = 1
    matched_story_key: str | None = None
    matched_title: str | None = None
    matched_last_seen_at: str | None = None
    matched_story_similarity: float = 0.0
    changed_fields: list[str] = field(default_factory=list)
    impact_score: int = 0
    novelty_score: int = 0
    confirmation_score: int = 0
    scope_fit_score: int = 0
    urgency_score: int = 0
    editorial_score: float = 0.0
    enriched_title: str | None = None
    enriched_description: str | None = None
    enriched_text: str | None = None
    enriched_fetched_at: str | None = None
    enrichment_status: str = "not_requested"
    ai_keep: bool | None = None
    ai_reason: str | None = None
    ai_importance_score: int | None = None
    ai_scope_fit_score: int | None = None
    ai_war_relevance_score: int | None = None
    ai_editorial_adjustment: float = 0.0
    ai_model: str | None = None


class ArticleHtmlExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_chunks: list[str] = []
        self.description: str | None = None
        self._skip_depth = 0
        self._in_title = False
        self._in_paragraph = False
        self._paragraph_chunks: list[str] = []
        self.paragraphs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = True
            return
        if tag == "meta":
            meta = {key.lower(): (value or "") for key, value in attrs}
            name = meta.get("name", "").lower()
            prop = meta.get("property", "").lower()
            content = strip_html(meta.get("content", ""))
            if not content:
                return
            if name == "description" and not self.description:
                self.description = content
            if prop == "og:description" and not self.description:
                self.description = content
            return
        if tag == "p":
            self._in_paragraph = True
            self._paragraph_chunks = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = False
            return
        if tag == "p" and self._in_paragraph:
            paragraph = normalize_whitespace(" ".join(self._paragraph_chunks))
            self._in_paragraph = False
            self._paragraph_chunks = []
            if len(paragraph) >= 80:
                self.paragraphs.append(paragraph)

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = normalize_whitespace(data)
        if not text:
            return
        if self._in_title:
            self.title_chunks.append(text)
        if self._in_paragraph:
            self._paragraph_chunks.append(text)

    @property
    def title(self) -> str | None:
        title = normalize_whitespace(" ".join(self.title_chunks))
        return title or None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a markdown news digest from RSS feeds.")
    parser.add_argument(
        "--input-file",
        type=Path,
        help="Optional JSON fixture with raw RSS rows. When omitted, configured sources are fetched.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory where latest.md and archive/YYYY-MM-DD.md should be written.",
    )
    parser.add_argument(
        "--max-articles",
        type=int,
        default=DEFAULT_MAX_ARTICLES,
        help="Upper bound for the total number of selected articles.",
    )
    parser.add_argument(
        "--stdout-markdown",
        action="store_true",
        help="Print the digest markdown to stdout instead of the status JSON.",
    )
    return parser.parse_args()


def now_warsaw() -> datetime:
    return datetime.now(tz=WARSAW_TZ)


def digest_date() -> str:
    return now_warsaw().strftime("%Y-%m-%d")


def normalize_whitespace(value: Any = "") -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def deep_merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def get_editorial_config() -> dict[str, Any]:
    global _EDITORIAL_CONFIG_CACHE
    global _EDITORIAL_CONFIG_MTIME_NS

    try:
        stat_result = EDITORIAL_CONFIG_PATH.stat()
    except FileNotFoundError:
        _EDITORIAL_CONFIG_CACHE = DEFAULT_EDITORIAL_CONFIG
        _EDITORIAL_CONFIG_MTIME_NS = None
        return _EDITORIAL_CONFIG_CACHE

    if _EDITORIAL_CONFIG_CACHE is not None and _EDITORIAL_CONFIG_MTIME_NS == stat_result.st_mtime_ns:
        return _EDITORIAL_CONFIG_CACHE

    payload = json.loads(EDITORIAL_CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Editorial settings config must be a JSON object.")
    _EDITORIAL_CONFIG_CACHE = deep_merge_dicts(DEFAULT_EDITORIAL_CONFIG, payload)
    _EDITORIAL_CONFIG_MTIME_NS = stat_result.st_mtime_ns
    return _EDITORIAL_CONFIG_CACHE


def load_text_prompt(path: Path, fallback: str) -> str:
    try:
        prompt = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return fallback.strip()
    return prompt or fallback.strip()


def strip_html(value: Any = "") -> str:
    text = unescape(str(value or ""))
    text = re.sub(r"<[^>]*>", " ", text)
    return normalize_whitespace(text)


def source_from_url(value: str) -> str:
    try:
        host = urllib.parse.urlparse(value).hostname or ""
    except ValueError:
        return "unknown"
    host = re.sub(r"^www\.", "", host)
    return host or "unknown"


def normalize_url(value: str | None) -> str | None:
    if not value or not str(value).strip():
        return None
    trimmed = str(value).strip()
    if not trimmed.startswith(("http://", "https://")):
        return trimmed
    parsed = urllib.parse.urlparse(trimmed)
    query_items = [
        (key, val)
        for key, val in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if key not in TRACKING_PARAMS
    ]
    query_items.sort(key=lambda item: item[0])
    normalized = parsed._replace(query=urllib.parse.urlencode(query_items), fragment="")
    url = urllib.parse.urlunparse(normalized).rstrip("/")
    return url or trimmed


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError, IndexError, OverflowError):
        pass
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def format_article_date(value: str | None) -> str:
    dt = parse_datetime(value)
    if not dt:
        return "brak daty"
    return dt.astimezone(WARSAW_TZ).strftime("%Y-%m-%d")


def is_recent_enough(value: str | None, max_age_days: int = MAX_ARTICLE_AGE_DAYS) -> bool:
    published = parse_datetime(value)
    if not published:
        return False
    cutoff = now_warsaw() - timedelta(days=max_age_days)
    return published.astimezone(WARSAW_TZ) >= cutoff


def normalize_title_and_source(row: dict[str, Any], fallback_source: str) -> tuple[str, str]:
    cleaned_title = strip_html(row.get("title") or "Bez tytulu")
    explicit_source = strip_html(
        row.get("source")
        or row.get("sourceName")
        or row.get("_sourceName")
        or row.get("creator")
        or row.get("author")
        or ""
    )
    return cleaned_title, explicit_source or fallback_source


def get_published_at(row: dict[str, Any]) -> str | None:
    for key in ("isoDate", "pubDate", "published", "date", "createdAt", "updated"):
        value = row.get(key)
        if value:
            return str(value)
    return None


def local_name(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def child_text(element: ET.Element, names: Iterable[str]) -> str:
    wanted = set(names)
    for child in element:
        if local_name(child.tag) in wanted:
            text = "".join(child.itertext()).strip()
            if text:
                return text
    return ""


def extract_link(element: ET.Element) -> str:
    for child in element:
        name = local_name(child.tag)
        if name == "link":
            href = child.attrib.get("href")
            if href:
                return href.strip()
            text = "".join(child.itertext()).strip()
            if text:
                return text
    return ""


def parse_feed_xml(content: bytes, source: SourceConfig) -> list[dict[str, Any]]:
    root = ET.fromstring(content)
    rows: list[dict[str, Any]] = []
    items = [element for element in root.iter() if local_name(element.tag) in {"item", "entry"}]
    for item in items:
        row = {
            "title": child_text(item, ("title",)),
            "link": extract_link(item),
            "contentSnippet": child_text(item, ("description", "summary", "content", "encoded")),
            "content": child_text(item, ("content", "encoded")),
            "summary": child_text(item, ("summary", "description")),
            "description": child_text(item, ("description",)),
            "pubDate": child_text(item, ("pubDate", "published", "updated")),
            "author": child_text(item, ("author", "creator")),
            "_sourceName": source.name,
            "_category": source.category,
            "_priority": source.priority,
            "_sourceUrl": source.url,
        }
        if row["title"] or row["link"]:
            rows.append(row)
    return rows


def load_source_configs(path: Path = CONFIG_PATH) -> list[SourceConfig]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("RSS source config must be a JSON array.")
    configs: list[SourceConfig] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        configs.append(
            SourceConfig(
                name=str(item["name"]),
                category=str(item["category"]),
                url=str(item["url"]),
                priority=int(item.get("priority", 3)),
            )
        )
    if not configs:
        raise ValueError("RSS source config is empty.")
    return configs


def category_order_from_sources(sources: Iterable[SourceConfig]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for source in sources:
        if source.category not in seen:
            seen.add(source.category)
            ordered.append(source.category)
    return ordered


def category_order_with_articles(sources: Iterable[SourceConfig], articles: Iterable[Article]) -> list[str]:
    ordered = category_order_from_sources(sources)
    seen = set(ordered)
    for article in articles:
        if article.category not in seen:
            seen.add(article.category)
            ordered.append(article.category)
    return ordered


def fetch_feed(source: SourceConfig) -> list[dict[str, Any]]:
    request = urllib.request.Request(source.url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=6) as response:
        return parse_feed_xml(response.read(), source)


def fetch_rows_for_sources(
    sources: list[SourceConfig],
) -> tuple[list[dict[str, Any]], dict[str, int], list[str]]:
    rows: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    errors: list[str] = []

    def fetch_one(source: SourceConfig) -> tuple[SourceConfig, list[dict[str, Any]], str | None]:
        try:
            return source, fetch_feed(source), None
        except (
            urllib.error.URLError,
            TimeoutError,
            ET.ParseError,
            ValueError,
            http.client.IncompleteRead,
        ) as exc:
            return source, [], str(exc)

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(12, max(1, len(sources)))) as executor:
        futures = [executor.submit(fetch_one, source) for source in sources]
        for future in concurrent.futures.as_completed(futures):
            source, source_rows, error = future.result()
            if error:
                errors.append(f"{source.name}: {error}")
                counts[source.name] = 0
                continue
            counts[source.name] = len(source_rows)
            rows.extend(source_rows)
    return rows, counts, errors


def load_rows_from_fixture(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Fixture JSON must be a list of raw rows.")
    return [row for row in payload if isinstance(row, dict)]


def source_counts_from_rows(rows: Iterable[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        source_name = str(row.get("_sourceName") or row.get("source") or "unknown")
        counts[source_name] = counts.get(source_name, 0) + 1
    return counts


def rows_to_articles(rows: Iterable[dict[str, Any]]) -> list[Article]:
    seen_urls: set[str] = set()
    articles: list[Article] = []
    for row in rows:
        if not isinstance(row, dict) or row.get("error"):
            continue
        published_at = get_published_at(row)
        if not is_recent_enough(published_at):
            continue
        raw_url = row.get("link") or row.get("url") or row.get("guid") or row.get("id") or ""
        url = normalize_url(str(raw_url))
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        fallback_source = str(row.get("_sourceName") or row.get("source") or source_from_url(url))
        title, source = normalize_title_and_source(row, fallback_source)
        summary = strip_html(
            row.get("contentSnippet")
            or row.get("content")
            or row.get("summary")
            or row.get("description")
            or ""
        )[:MAX_SUMMARY_LENGTH]
        articles.append(
            Article(
                title=title,
                source=source,
                category=str(row.get("_category") or row.get("category") or "Inne"),
                priority=int(row.get("_priority") or row.get("priority") or 3),
                summary=summary,
                url=url,
                published_at=published_at,
            )
        )
    articles.sort(key=sort_key, reverse=True)
    return articles


def normalize_sentence(value: str) -> str:
    text = normalize_whitespace(value)
    if not text:
        return ""
    if text[-1] not in ".!?":
        text = f"{text}."
    return text


def split_sentences(value: str) -> list[str]:
    parts = re.findall(r"[^.!?]+[.!?]+|[^.!?]+$", value)
    sentences: list[str] = []
    for part in parts:
        sentence = normalize_sentence(part)
        if sentence:
            sentences.append(sentence)
    return sentences


def contains_any(text: str, keywords: Iterable[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def text_tokens(value: str) -> set[str]:
    lowered = normalize_whitespace(value).lower()
    parts = re.findall(r"[a-z0-9ąćęłńóśźż-]{3,}", lowered)
    return {part for part in parts if part not in STOPWORDS}


def article_tokens(article: Article) -> set[str]:
    extra_titles = " ".join(article.duplicate_titles[:4])
    text = f"{article.title} {extra_titles} {article.summary}"
    return text_tokens(text)


def title_similarity(left: Article, right: Article) -> float:
    return SequenceMatcher(None, left.title.lower(), right.title.lower()).ratio()


def token_overlap(left: Article, right: Article) -> float:
    left_tokens = article_tokens(left)
    right_tokens = article_tokens(right)
    if not left_tokens or not right_tokens:
        return 0.0
    intersection = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    return intersection / union if union else 0.0


def likely_duplicate(left: Article, right: Article) -> bool:
    similarity = title_similarity(left, right)
    overlap = token_overlap(left, right)
    same_category = left.category == right.category
    same_day = format_article_date(left.published_at) == format_article_date(right.published_at)
    if similarity >= 0.9:
        return True
    if overlap >= 0.7 and same_day:
        return True
    if similarity >= 0.75 and overlap >= 0.45 and (same_category or same_day):
        return True
    return False


def heuristic_duplicate_groups(articles: list[Article]) -> list[list[int]]:
    parent = list(range(len(articles)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for left in range(len(articles)):
        for right in range(left + 1, len(articles)):
            if likely_duplicate(articles[left], articles[right]):
                union(left, right)

    groups: dict[int, list[int]] = {}
    for index in range(len(articles)):
        root = find(index)
        groups.setdefault(root, []).append(index)
    return [indices for indices in groups.values() if len(indices) > 1]


def extract_json_object(text: str) -> dict[str, Any] | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    snippet = cleaned[start : end + 1]
    try:
        payload = json.loads(snippet)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def ai_dedupe_enabled(force_enable: bool | None = None) -> bool:
    if force_enable is not None:
        return force_enable
    env_flag = os.environ.get("AI_DEDUPE_ENABLED", "").strip().lower()
    if env_flag in {"0", "false", "no", "off"}:
        return False
    return bool(os.environ.get("NVIDIA_API_KEY"))


def nvidia_chat_completion(
    *,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    model: str | None = None,
) -> dict[str, Any] | None:
    api_key = os.environ.get("NVIDIA_API_KEY", "").strip()
    if not api_key:
        return None
    resolved_model = model or os.environ.get("NVIDIA_NIM_MODEL", "meta/llama-3.3-70b-instruct")
    body = {
        "model": resolved_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    request = urllib.request.Request(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def ai_refine_duplicate_groups(
    articles: list[Article],
    groups: list[list[int]],
    force_enable: bool | None = None,
) -> list[dict[str, Any]]:
    if not groups or not ai_dedupe_enabled(force_enable):
        return []
    limited_groups = groups[:MAX_AI_GROUPS]
    prompt_groups = []
    for group_index, indices in enumerate(limited_groups):
        prompt_groups.append(
            {
                "group_id": group_index,
                "articles": [
                    {
                        "index": article_index,
                        "title": articles[article_index].title,
                        "source": articles[article_index].source,
                        "category": articles[article_index].category,
                        "priority": articles[article_index].priority,
                        "publishedAt": articles[article_index].published_at,
                        "summary": articles[article_index].summary[:500],
                        "url": articles[article_index].url,
                    }
                    for article_index in indices
                ],
            }
        )
    payload = nvidia_chat_completion(
        temperature=0.1,
        max_tokens=1800,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are deduplicating RSS news candidates. Return strict JSON only. "
                    "Identify which candidate groups describe the same underlying story. "
                    "Prefer the article with the best real information value, using source priority only as a hint."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": (
                            "For each candidate group, decide whether all listed items are the same story. "
                            "Return JSON with key 'groups'. Each entry must be "
                            "{group_id, merge, canonical_index, duplicate_indices, note}. "
                            "Set merge=false if they are related but should remain separate."
                        ),
                        "candidate_groups": prompt_groups,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    )
    if payload is None:
        return []
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = extract_json_object(str(content))
    if not parsed or not isinstance(parsed.get("groups"), list):
        return []
    return [item for item in parsed["groups"] if isinstance(item, dict)]


def ai_editorial_review_enabled() -> bool:
    settings = get_editorial_config()["ai_editorial_review"]
    return bool(settings.get("enabled")) and bool(os.environ.get("NVIDIA_API_KEY", "").strip())


def ai_editorial_review_shortlist(articles: list[Article]) -> list[Article]:
    settings = get_editorial_config()["ai_editorial_review"]
    shortlist_size = max(0, int(settings["shortlist_size"]))
    return sorted(articles, key=sort_key, reverse=True)[: min(shortlist_size, len(articles))]


def ai_editorial_candidate_payload(article: Article) -> dict[str, Any]:
    return {
        "storyKey": article.story_key,
        "title": article.title,
        "source": article.source,
        "category": article.category,
        "publishedAt": article.published_at,
        "url": article.url,
        "summary": article.summary[:500],
        "enrichedDescription": (article.enriched_description or "")[:500],
        "enrichedText": (article.enriched_text or "")[:1200],
        "duplicateCount": article.duplicate_count,
        "sourceCount": article.source_count,
        "heuristicScores": {
            "impact": article.impact_score,
            "novelty": article.novelty_score,
            "confirmation": article.confirmation_score,
            "scopeFit": article.scope_fit_score,
            "urgency": article.urgency_score,
            "editorial": article.editorial_score,
        },
        "isGenericWarStory": is_generic_war_story(article),
    }


def apply_ai_editorial_review(articles: list[Article]) -> int:
    if not articles or not ai_editorial_review_enabled():
        return 0
    shortlist = ai_editorial_review_shortlist(articles)
    if not shortlist:
        return 0

    settings = get_editorial_config()["ai_editorial_review"]
    max_abs_adjustment = float(settings["max_abs_adjustment"])
    reject_penalty = float(settings["reject_penalty"])
    weight = float(settings["weight"])
    model = os.environ.get("NVIDIA_NIM_MODEL", "meta/llama-3.3-70b-instruct")
    candidates = [ai_editorial_candidate_payload(article) for article in shortlist]
    system_prompt = load_text_prompt(AI_EDITORIAL_REVIEW_PROMPT_PATH, DEFAULT_AI_EDITORIAL_REVIEW_PROMPT)

    payload = nvidia_chat_completion(
        model=model,
        temperature=float(settings["temperature"]),
        max_tokens=int(settings["max_tokens"]),
        messages=[
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": (
                            "Review the shortlisted story clusters. For each candidate return one review item with "
                            "keys: storyKey, keep, editorialAdjustment, importance, scopeFit, warRelevance, reason. "
                            "editorialAdjustment must be an integer from -20 to 20. Use negative adjustments for "
                            "generic war updates, repetitive stories, or low-signal items. Use positive adjustments "
                            "for materially important items in the user's scope. Keep reason under 20 words."
                        ),
                        "candidates": candidates,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    )
    if payload is None:
        return 0
    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
    parsed = extract_json_object(str(content))
    if not parsed or not isinstance(parsed.get("reviews"), list):
        return 0

    reviews_by_story_key = {
        str(item.get("storyKey")): item
        for item in parsed["reviews"]
        if isinstance(item, dict) and item.get("storyKey")
    }
    applied = 0
    for article in shortlist:
        review = reviews_by_story_key.get(article.story_key)
        if review is None:
            continue
        adjustment = review.get("editorialAdjustment", 0)
        try:
            adjustment_value = float(adjustment)
        except (TypeError, ValueError):
            adjustment_value = 0.0
        adjustment_value = max(-max_abs_adjustment, min(max_abs_adjustment, adjustment_value))
        keep = review.get("keep")
        article.ai_keep = bool(keep) if isinstance(keep, bool) else None
        article.ai_reason = normalize_whitespace(str(review.get("reason") or ""))[:160] or None
        article.ai_model = model
        for field_name, key_name in (
            ("ai_importance_score", "importance"),
            ("ai_scope_fit_score", "scopeFit"),
            ("ai_war_relevance_score", "warRelevance"),
        ):
            try:
                value = int(review.get(key_name))
            except (TypeError, ValueError):
                value = None
            setattr(article, field_name, value)
        final_adjustment = adjustment_value * weight
        if article.ai_keep is False:
            final_adjustment -= reject_penalty
        article.ai_editorial_adjustment = final_adjustment
        article.editorial_score = round(article.editorial_score + final_adjustment, 2)
        applied += 1
    articles.sort(key=sort_key, reverse=True)
    return applied


def importance_signal(article: Article) -> int:
    text = article_context(article).lower()
    score = 0
    newsworthy_keywords = get_editorial_config()["scoring"]["newsworthy_keywords"]
    for keyword, weight in newsworthy_keywords.items():
        if keyword in text:
            score += weight
    if len(article.summary) > 280:
        score += 2
    if article.enriched_text and len(article.enriched_text) > 900:
        score += 2
    return score


def fallback_priority_score(article: Article) -> float:
    impact_settings = get_editorial_config()["scoring"]["impact"]
    published = parse_datetime(article.published_at)
    age_bonus = 0.0
    if published:
        delta_hours = max((now_warsaw() - published.astimezone(WARSAW_TZ)).total_seconds() / 3600, 0)
        age_bonus_limit = 18.0
        age_bonus = max(0.0, age_bonus_limit - min(delta_hours, age_bonus_limit))
    return importance_signal(article) * 3.0 + article.duplicate_count * 4.0 + article.priority * 1.5 + age_bonus


def merge_duplicate_group(group: list[Article], ai_note: str = "") -> Article:
    canonical = max(group, key=fallback_priority_score)
    duplicates = [article for article in group if article.url != canonical.url]
    duplicate_sources = sorted({article.source for article in duplicates if article.source != canonical.source})
    duplicate_titles = [article.title for article in duplicates if article.title != canonical.title]
    merged_summary = canonical.summary
    if ai_note:
        merged_summary = f"{merged_summary} {ai_note}".strip()
    return replace(
        canonical,
        summary=merged_summary,
        duplicate_sources=duplicate_sources,
        duplicate_titles=duplicate_titles,
        duplicate_count=len(group),
    )


def deduplicate_articles(
    articles: list[Article],
    enable_ai: bool | None = None,
) -> list[Article]:
    groups = heuristic_duplicate_groups(articles)
    ai_groups = ai_refine_duplicate_groups(articles, groups, force_enable=enable_ai)
    approved_groups: dict[int, dict[str, Any]] = {}
    for item in ai_groups:
        try:
            group_id = int(item.get("group_id"))
        except (TypeError, ValueError):
            continue
        approved_groups[group_id] = item

    grouped_indices: set[int] = set()
    merged_articles: list[Article] = []
    for group_id, indices in enumerate(groups):
        decision = approved_groups.get(group_id)
        if decision is not None and not bool(decision.get("merge")):
            continue
        group_articles = [articles[index] for index in indices]
        if decision and bool(decision.get("merge")):
            canonical_index = decision.get("canonical_index")
            if isinstance(canonical_index, int):
                preferred = next((article for idx, article in zip(indices, group_articles) if idx == canonical_index), None)
                if preferred is not None:
                    group_articles = [preferred] + [article for article in group_articles if article.url != preferred.url]
            note = str(decision.get("note") or "")
        else:
            note = ""
        merged_articles.append(merge_duplicate_group(group_articles, ai_note=note))
        grouped_indices.update(indices)

    for index, article in enumerate(articles):
        if index not in grouped_indices:
            merged_articles.append(article)

    merged_articles.sort(key=sort_key, reverse=True)
    return merged_articles


def article_context(article: Article) -> str:
    parts = [article.title, article.summary, article.enriched_description or "", article.enriched_text or ""]
    return normalize_whitespace(" ".join(parts))


def source_count(article: Article) -> int:
    return 1 + len(set(article.duplicate_sources))


def stable_story_key(article: Article) -> str:
    tokens = sorted(article_tokens(article))
    title_tokens = [token for token in re.findall(r"[a-z0-9ąćęłńóśźż-]{3,}", article.title.lower()) if token not in STOPWORDS]
    signature_tokens = title_tokens[:8] or tokens[:8] or ["story"]
    base = f"{article.category.lower()}|{' '.join(signature_tokens)}"
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]
    slug = "-".join(signature_tokens[:5])[:48].strip("-") or "story"
    return f"{slug}-{digest}"


def category_head(value: str) -> str:
    return value.split("/", 1)[0]


def is_generic_war_story(article: Article) -> bool:
    war_filter = get_editorial_config()["scoring"]["war_filter"]
    war_signal_keywords = war_filter["signal_keywords"]
    war_relevance_keywords = war_filter["relevance_keywords"]
    category = article.category.lower()
    text = article_context(article).lower()
    if not (
        contains_any(category, ("geopolityka", "bezpieczeństwo", "bezpieczenstwo", "świat", "swiat"))
        or contains_any(text, war_signal_keywords)
    ):
        return False
    if not contains_any(text, war_signal_keywords):
        return False
    return not contains_any(text, war_relevance_keywords)


def stored_story_similarity(article: Article, stored: StoredStory) -> float:
    title_sim = SequenceMatcher(None, article.title.lower(), stored.canonical_title.lower()).ratio()
    overlap = token_overlap_with_text(article, stored.canonical_title)
    score = max(title_sim, overlap)
    if stored.canonical_url == article.url:
        score += 0.2
    if stored.category == article.category:
        score += 0.05
    return min(score, 1.0)


def token_overlap_with_text(article: Article, text: str) -> float:
    left_tokens = article_tokens(article)
    right_tokens = text_tokens(text)
    if not left_tokens or not right_tokens:
        return 0.0
    intersection = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    return intersection / union if union else 0.0


def find_recent_story_match(article: Article, recent_stories: list[StoredStory]) -> tuple[StoredStory | None, float]:
    min_score = float(get_editorial_config()["matching"]["story_match_min_score"])
    best_story: StoredStory | None = None
    best_score = 0.0
    article_category_head = category_head(article.category)
    for stored in recent_stories:
        if stored.category != article.category and category_head(stored.category) != article_category_head:
            continue
        score = stored_story_similarity(article, stored)
        if score > best_score:
            best_score = score
            best_story = stored
    if best_score < min_score:
        return None, 0.0
    return best_story, best_score


def detect_changed_fields(article: Article, matched_story: StoredStory | None) -> list[str]:
    title_change_threshold = float(get_editorial_config()["matching"]["title_change_threshold"])
    if matched_story is None:
        return ["new_story"]
    changed: list[str] = []
    if matched_story.canonical_url != article.url:
        changed.append("canonical_url")
    if SequenceMatcher(None, matched_story.canonical_title.lower(), article.title.lower()).ratio() < title_change_threshold:
        changed.append("canonical_title")
    if matched_story.source != article.source:
        changed.append("source")
    if source_count(article) > max(matched_story.confirmation_count, 1):
        changed.append("confirmation_count")
    if article.enrichment_status == "enriched":
        changed.append("enriched_text")
    return changed


def impact_score_component(article: Article) -> int:
    impact_settings = get_editorial_config()["scoring"]["impact"]
    raw = importance_signal(article)
    raw += min(article.duplicate_count, int(impact_settings["duplicate_weight_cap"])) * int(
        impact_settings["duplicate_weight_multiplier"]
    )
    raw += article.priority
    if article.enriched_text:
        raw += int(impact_settings["enriched_text_bonus"])
    if len(article.summary) > int(impact_settings["long_summary_threshold"]):
        raw += int(impact_settings["long_summary_bonus"])
    return max(1, min(10, int(round(raw / float(impact_settings["normalizer"])))))


def novelty_score_component(article: Article, matched_story: StoredStory | None) -> int:
    novelty_settings = get_editorial_config()["scoring"]["novelty"]
    if matched_story is None:
        return 10
    last_seen = matched_story.last_seen_at
    if not last_seen:
        return 7
    hours = max((now_warsaw() - last_seen.astimezone(WARSAW_TZ)).total_seconds() / 3600, 0.0)
    same_url = matched_story.canonical_url == article.url
    similarity = SequenceMatcher(None, matched_story.canonical_title.lower(), article.title.lower()).ratio()
    changed_bonus = min(len(article.changed_fields), 2)
    if same_url and hours <= 24:
        return min(int(novelty_settings["same_url_24h_max"]), 1 + changed_bonus)
    if hours <= 24:
        return min(int(novelty_settings["same_story_24h_max"]), 3 + changed_bonus + (0 if similarity > 0.9 else 1))
    if hours <= 72:
        return min(int(novelty_settings["same_story_72h_max"]), 5 + changed_bonus)
    return min(int(novelty_settings["older_story_max"]), 7 + changed_bonus)


def confirmation_score_component(article: Article) -> int:
    confirmation_settings = get_editorial_config()["scoring"]["confirmation"]
    count = source_count(article)
    if count >= 5:
        return int(confirmation_settings["score_for_5_plus"])
    if count == 4:
        return int(confirmation_settings["score_for_4"])
    if count == 3:
        return int(confirmation_settings["score_for_3"])
    if count == 2:
        return int(confirmation_settings["score_for_2"])
    return int(confirmation_settings["score_for_1"])


def scope_fit_score_component(article: Article) -> int:
    scoring = get_editorial_config()["scoring"]
    scope_keywords = scoring["scope_keywords"]
    scope_fit = scoring["scope_fit"]
    war_filter = scoring["war_filter"]
    category = article.category.lower()
    text = article_context(article).lower()
    if is_generic_war_story(article):
        return int(war_filter["scope_fit_score"])
    if "ai" in category or contains_any(text, scope_keywords["ai"]):
        return int(scope_fit["ai_score"])
    if contains_any(category, ("software", "it", "devtools", "engineering")) or contains_any(
        text, scope_keywords["devtools"]
    ):
        return int(scope_fit["devtools_score"])
    if contains_any(category, ("cyber", "bezpieczeń", "bezpieczen")):
        return int(scope_fit["cyber_score"])
    if contains_any(category, ("polska", "świat", "swiat", "gospodarka", "geopolityka", "biznes")):
        return int(scope_fit["poland_world_score"])
    if contains_any(text, scope_keywords["poland_world"]):
        return int(scope_fit["poland_world_score"])
    return int(scope_fit["default_score"])


def urgency_score_component(article: Article) -> int:
    urgency_settings = get_editorial_config()["scoring"]["urgency"]
    published = parse_datetime(article.published_at)
    score = int(urgency_settings["base_score"])
    if published:
        hours = max((now_warsaw() - published.astimezone(WARSAW_TZ)).total_seconds() / 3600, 0.0)
        if hours <= 6:
            score = int(urgency_settings["score_6h"])
        elif hours <= 24:
            score = int(urgency_settings["score_24h"])
        elif hours <= 48:
            score = int(urgency_settings["score_48h"])
        elif hours <= 72:
            score = int(urgency_settings["score_72h"])
        else:
            score = int(urgency_settings["score_older"])
    text = article_context(article).lower()
    if contains_any(text, ("breach", "attack", "outage", "zero-day", "ransomware")):
        score += int(urgency_settings["security_bonus"])
    if contains_any(text, ("earnings", "ipo", "sanction", "tariff", "rate cut")):
        score += int(urgency_settings["markets_bonus"])
    return max(1, min(10, score))


def weighted_editorial_score(article: Article) -> float:
    scoring = get_editorial_config()["scoring"]
    weights = scoring["editorial_weights"]
    war_filter = scoring["war_filter"]
    score = (
        article.impact_score * float(weights["impact"])
        + article.novelty_score * float(weights["novelty"])
        + article.confirmation_score * float(weights["confirmation"])
        + article.scope_fit_score * float(weights["scope_fit"])
        + article.urgency_score * float(weights["urgency"])
    )
    if is_generic_war_story(article):
        score -= float(war_filter["editorial_penalty"])
    return round(score, 2)


def assign_editorial_metadata(articles: list[Article], recent_stories: list[StoredStory]) -> None:
    for article in articles:
        article.source_count = source_count(article)
        article.story_key = stable_story_key(article)
        matched_story, similarity = find_recent_story_match(article, recent_stories)
        if matched_story is not None:
            article.story_key = matched_story.story_key
            article.matched_story_key = matched_story.story_key
            article.matched_title = matched_story.canonical_title
            article.matched_last_seen_at = matched_story.last_seen_at.isoformat() if matched_story.last_seen_at else None
            article.matched_story_similarity = similarity
        else:
            article.matched_story_key = None
            article.matched_title = None
            article.matched_last_seen_at = None
            article.matched_story_similarity = 0.0
        article.changed_fields = detect_changed_fields(article, matched_story)
        article.impact_score = impact_score_component(article)
        article.confirmation_score = confirmation_score_component(article)
        article.scope_fit_score = scope_fit_score_component(article)
        article.urgency_score = urgency_score_component(article)
        article.novelty_score = novelty_score_component(article, matched_story)
        article.editorial_score = weighted_editorial_score(article)
    articles.sort(key=sort_key, reverse=True)


def enrichment_top_n(max_articles: int) -> int:
    configured = os.environ.get("ENRICH_TOP_N", "").strip()
    if configured.isdigit():
        return max(0, int(configured))
    default_top_n = int(get_editorial_config()["enrichment"]["default_top_n"])
    return max(max_articles, default_top_n)


def fetch_article_enrichment(article: Article) -> ArticleEnrichment:
    request = urllib.request.Request(
        article.url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.8,pl;q=0.6",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            content_type = response.headers.get_content_charset() or "utf-8"
            payload = response.read(600_000)
    except (urllib.error.URLError, TimeoutError, ValueError):
        return ArticleEnrichment(status="fetch_error")
    try:
        html = payload.decode(content_type, errors="ignore")
    except LookupError:
        html = payload.decode("utf-8", errors="ignore")
    parser = ArticleHtmlExtractor()
    parser.feed(html)
    paragraphs = parser.paragraphs[:6]
    text = normalize_whitespace(" ".join(paragraphs))[:3600] or None
    return ArticleEnrichment(
        status="enriched" if parser.description or text else "empty",
        fetched_at=now_warsaw().isoformat(),
        title=parser.title,
        description=parser.description,
        text=text,
    )


def enrich_top_articles(articles: list[Article], limit: int) -> int:
    if limit <= 0 or not articles:
        return 0
    candidates = sorted(articles, key=sort_key, reverse=True)[: min(limit, len(articles))]
    enriched_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, max(1, len(candidates)))) as executor:
        future_map = {executor.submit(fetch_article_enrichment, article): article for article in candidates}
        for future in concurrent.futures.as_completed(future_map):
            article = future_map[future]
            result = future.result()
            article.enrichment_status = result.status
            article.enriched_fetched_at = result.fetched_at
            article.enriched_title = result.title
            article.enriched_description = result.description
            article.enriched_text = result.text
            if result.status == "enriched":
                enriched_count += 1
    return enriched_count


def select_articles(
    articles: list[Article],
    max_articles: int,
    category_order: list[str],
) -> list[Article]:
    if not articles:
        return []
    max_per_category = max(2, min(4, math.ceil(max_articles / max(1, len(category_order)))))
    selected: list[Article] = []
    selected_story_keys: set[str] = set()
    def selection_sort_key(article: Article) -> tuple[bool, float, float]:
        score, timestamp = sort_key(article)
        return (is_generic_war_story(article), -score, -timestamp)
    for category in category_order:
        bucket = sorted(
            (article for article in articles if article.category == category),
            key=selection_sort_key,
        )[:max_per_category]
        for article in bucket:
            if article.story_key in selected_story_keys:
                continue
            selected.append(article)
            selected_story_keys.add(article.story_key)
    remaining_articles = sorted(articles, key=selection_sort_key)
    if len(selected) < max_articles:
        for article in remaining_articles:
            if article.story_key in selected_story_keys:
                continue
            selected.append(article)
            selected_story_keys.add(article.story_key)
            if len(selected) >= max_articles:
                break
    selected.sort(key=sort_key, reverse=True)
    return selected[:max_articles]


def build_summary(article: Article) -> str:
    sentences: list[str] = []
    seen: set[str] = set()
    candidates = [
        *(split_sentences(article.enriched_description or "")[:2]),
        *(split_sentences(article.enriched_text or "")[:3]),
        *(split_sentences(article.summary)[:2]),
    ]
    if article.duplicate_sources:
        sources = ", ".join(article.duplicate_sources[:4])
        candidates.append(f"Temat pojawil sie tez w innych zrodlach, m.in. {sources}.")
    if article.changed_fields and "new_story" not in article.changed_fields:
        candidates.append(f"Od poprzedniego uruchomienia zmienily sie pola: {', '.join(article.changed_fields[:3])}.")
    if article.ai_reason:
        candidates.append(f"Ocena AI: {article.ai_reason}.")
    if article.enrichment_status != "enriched":
        candidates.append("Dostepne streszczenie opiera sie glownie na metadanych RSS, wiec warto otworzyc link po pelny kontekst.")
    candidates.append("Najlepszym kliknieciem jest link kanoniczny tej historii, bo skupia najbardziej informacyjna wersje tematu.")
    for candidate in candidates:
        sentence = normalize_sentence(candidate)
        key = sentence.lower()
        if not sentence or key in seen:
            continue
        seen.add(key)
        sentences.append(sentence)
        if len(sentences) >= 5:
            break
    while len(sentences) < 4:
        sentences.append("Ta historia utrzymala sie wysoko, bo laczy sensowny impact z aktualnoscia i dopasowaniem do zakresu digestu.")
    return " ".join(sentences[:5])


def render_digest(
    articles: list[Article],
    source_counts: dict[str, int],
    errors: list[str],
    report_date: str,
    sources: list[SourceConfig],
) -> str:
    category_order = category_order_with_articles(sources, articles)
    grouped = {category: [article for article in articles if article.category == category] for category in category_order}
    new_story_count = sum(1 for article in articles if "new_story" in article.changed_fields)
    continuing_story_count = len(articles) - new_story_count
    snapshot_lines = [f"- {category}: {len(grouped[category])} story clusterow." for category in category_order]
    snapshot_lines.append(f"- Lacznie po deduplikacji: {len(articles)} story clusterow.")
    snapshot_lines.append(f"- Nowe historie: {new_story_count}. Kontynuacje lub aktualizacje: {continuing_story_count}.")
    if errors:
        snapshot_lines.append(f"- Problemy z feedami lub storage: {', '.join(errors[:3])}.")
    lines = [f"# News Digest - {report_date}", "", "## Szybkie podsumowanie dnia", ""]
    lines.extend(snapshot_lines)
    lines.extend(["", "## Zrodla", ""])
    for source in sources:
        lines.append(
            f"- {source.name} | {source.category} | priority {source.priority}/5 | "
            f"{source_counts.get(source.name, 0)} wpisow | {source.url}"
        )
    for category in category_order:
        lines.extend(["", f"## {category}", ""])
        bucket = grouped[category]
        if not bucket:
            lines.append("Brak artykulow w tej kategorii.")
            continue
        for article in bucket:
            lines.extend(
                [
                    f"### {article.title}",
                    f"Zrodlo: {article.source}",
                    f"Kategoria: {article.category}",
                    f"Skoring: impact {article.impact_score}/10 | novelty {article.novelty_score}/10 | "
                    f"confirmation {article.confirmation_score}/10 | scope {article.scope_fit_score}/10 | urgency {article.urgency_score}/10",
                    f"Ocena redakcyjna: {article.editorial_score:.1f}/100",
                    f"Data: {format_article_date(article.published_at)}",
                    "Podsumowanie:",
                    textwrap.fill(build_summary(article), width=100),
                    f"Link: {article.url}",
                    "",
                ]
            )
    return "\n".join(lines).strip() + "\n"


def write_outputs(digest: str, output_dir: Path, report_date: str) -> tuple[Path, Path]:
    archive_dir = output_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    latest_path = output_dir / "latest.md"
    archive_path = archive_dir / f"{report_date}.md"
    latest_path.write_text(digest, encoding="utf-8")
    archive_path.write_text(digest, encoding="utf-8")
    return latest_path, archive_path


def sort_key(article: Article) -> tuple[float, float]:
    published = parse_datetime(article.published_at)
    timestamp = published.timestamp() if published else 0.0
    score = article.editorial_score if article.editorial_score > 0 else fallback_priority_score(article)
    return (score, timestamp)


def load_recent_story_state(store: DigestStore | None, errors: list[str]) -> list[StoredStory]:
    if store is None:
        return []
    try:
        store.ensure_schema()
        lookback_days = int(get_editorial_config()["matching"]["recent_story_lookback_days"])
        return store.load_recent_stories(lookback_days=lookback_days)
    except Exception as exc:  # pragma: no cover
        errors.append(f"storage bootstrap failed: {exc}")
        return []


def persist_story_state(
    store: DigestStore | None,
    *,
    report_date: str,
    delivery_mode: str,
    selected: list[Article],
    all_articles: list[Article],
    max_articles: int,
    errors: list[str],
    sources: list[SourceConfig],
    metadata: dict[str, Any],
) -> tuple[str, int | None]:
    if store is None:
        return "disabled", None
    try:
        run_id = store.persist_digest_run(
            report_date=report_date,
            delivery_mode=delivery_mode,
            article_count=len(selected),
            max_articles=max_articles,
            errors=errors,
            sources=[
                {
                    "name": source.name,
                    "category": source.category,
                    "url": source.url,
                    "priority": source.priority,
                }
                for source in sources
            ],
            metadata=metadata,
            stories=all_articles,
            selected_story_keys={article.story_key for article in selected},
        )
        return "ok", run_id
    except Exception as exc:  # pragma: no cover
        errors.append(f"storage persist failed: {exc}")
        return "error", None


def build_digest_artifacts(
    rows: list[dict[str, Any]],
    sources: list[SourceConfig],
    source_counts: dict[str, int] | None = None,
    errors: list[str] | None = None,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    max_articles: int = DEFAULT_MAX_ARTICLES,
    delivery_mode: str = "python-rss",
    enable_ai_dedupe: bool | None = None,
) -> dict[str, object]:
    effective_counts = source_counts or source_counts_from_rows(rows)
    effective_errors = list(errors or [])
    store = DigestStore.from_env()
    recent_stories = load_recent_story_state(store, effective_errors)

    articles = rows_to_articles(rows)
    articles = articles[:MAX_DEDUPE_CANDIDATES]
    articles = deduplicate_articles(articles, enable_ai=enable_ai_dedupe)
    assign_editorial_metadata(articles, recent_stories)

    enrich_limit = enrichment_top_n(max_articles)
    enriched_count = enrich_top_articles(articles, enrich_limit)
    if enriched_count:
        assign_editorial_metadata(articles, recent_stories)
    ai_reviewed_count = apply_ai_editorial_review(articles)

    selected = select_articles(
        articles,
        max_articles=max(1, max_articles),
        category_order=category_order_with_articles(sources, articles),
    )
    report_date = digest_date()
    digest = render_digest(selected, effective_counts, effective_errors, report_date, sources)
    latest_path, archive_path = write_outputs(digest, output_dir, report_date)

    storage_status, run_id = persist_story_state(
        store,
        report_date=report_date,
        delivery_mode=delivery_mode,
        selected=selected,
        all_articles=articles,
        max_articles=max_articles,
        errors=effective_errors,
        sources=sources,
        metadata={
            "candidateCount": len(articles),
            "recentStoryCount": len(recent_stories),
            "enrichmentTopN": enrich_limit,
            "enrichedCount": enriched_count,
            "aiEditorialReviewedCount": ai_reviewed_count,
        },
    )

    return {
        "status": "ok",
        "deliveryMode": delivery_mode,
        "digestDate": report_date,
        "articleCount": len(selected),
        "latestPath": str(latest_path),
        "archivePath": str(archive_path),
        "errors": effective_errors,
        "digest": digest,
        "storageStatus": storage_status,
        "storageRunId": run_id,
        "enrichedCount": enriched_count,
        "aiEditorialReviewedCount": ai_reviewed_count,
        "candidateCount": len(articles),
    }


def main() -> int:
    args = parse_args()
    sources = load_source_configs()
    if args.input_file:
        rows = load_rows_from_fixture(args.input_file)
        source_counts = source_counts_from_rows(rows)
        errors: list[str] = []
    else:
        rows, source_counts, errors = fetch_rows_for_sources(sources)
    result = build_digest_artifacts(
        rows=rows,
        sources=sources,
        source_counts=source_counts,
        errors=errors,
        output_dir=args.output_dir,
        max_articles=args.max_articles,
        delivery_mode="python-rss",
    )
    if args.stdout_markdown:
        sys.stdout.write(str(result["digest"]))
        return 0
    status = dict(result)
    status.pop("digest", None)
    sys.stdout.write(json.dumps(status, ensure_ascii=False))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
