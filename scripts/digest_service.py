#!/usr/bin/env python3
from __future__ import annotations

import json
import traceback
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from build_digest import (
    CONFIG_PATH,
    DEFAULT_MAX_ARTICLES,
    DEFAULT_OUTPUT_DIR,
    SourceConfig,
    build_digest_artifacts,
    fetch_rows_for_sources,
    load_rows_from_fixture,
    load_source_configs,
    source_counts_from_rows,
)


HOST = "0.0.0.0"
PORT = 8000
DEFAULT_OUTPUT_PATH = Path(DEFAULT_OUTPUT_DIR)


def parse_sources(items: object, config_path: Path | None = None) -> list[SourceConfig]:
    effective_path = config_path or CONFIG_PATH
    if not isinstance(items, list):
        return load_source_configs(effective_path)
    parsed: list[SourceConfig] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        parsed.append(
            SourceConfig(
                name=str(item["name"]),
                category=str(item["category"]),
                url=str(item["url"]),
                priority=int(item.get("priority", 3)),
            )
        )
    return parsed or load_source_configs(effective_path)


def _build_artifacts(
    *,
    rows: list[dict[str, object]],
    sources: list[SourceConfig],
    source_counts: dict[str, int],
    errors: list[str],
    max_articles: int,
    delivery_mode: str,
    enable_ai_dedupe: bool | None,
) -> dict[str, object]:
    return build_digest_artifacts(
        rows=rows,
        sources=sources,
        source_counts=source_counts,
        errors=errors,
        output_dir=DEFAULT_OUTPUT_PATH,
        max_articles=max_articles,
        delivery_mode=delivery_mode,
        enable_ai_dedupe=enable_ai_dedupe,
    )


def build_digest_response(payload: dict[str, object] | None = None) -> dict[str, object]:
    payload = payload or {}
    config_path = payload.get("sourceConfigPath")
    resolved_config = Path(str(config_path)) if isinstance(config_path, str) and config_path.strip() else CONFIG_PATH
    sources = parse_sources(payload.get("sources"), resolved_config)
    max_articles = payload.get("maxArticles", DEFAULT_MAX_ARTICLES)
    if not isinstance(max_articles, int):
        max_articles = DEFAULT_MAX_ARTICLES
    enable_ai = payload.get("enableAiDedupe")
    if not isinstance(enable_ai, bool):
        enable_ai = None

    fixture_path = payload.get("fixturePath")
    if isinstance(fixture_path, str) and fixture_path.strip():
        rows = load_rows_from_fixture(Path(fixture_path))
        return _build_artifacts(
            rows=rows,
            sources=sources,
            source_counts=source_counts_from_rows(rows),
            errors=[],
            max_articles=max_articles,
            delivery_mode="python-service-fixture",
            enable_ai_dedupe=enable_ai,
        )

    if isinstance(payload.get("rows"), list):
        rows = [row for row in payload["rows"] if isinstance(row, dict)]
        source_counts = payload.get("sourceNodeCounts")
        if not isinstance(source_counts, dict):
            source_counts = source_counts_from_rows(rows)
        errors = payload.get("errors")
        if not isinstance(errors, list):
            errors = []
        return _build_artifacts(
            rows=rows,
            sources=sources,
            source_counts={str(key): int(value) for key, value in source_counts.items()},
            errors=[str(item) for item in errors],
            max_articles=max_articles,
            delivery_mode="python-service-n8n-rss",
            enable_ai_dedupe=enable_ai,
        )

    rows, source_counts, errors = fetch_rows_for_sources(sources)
    return _build_artifacts(
        rows=rows,
        sources=sources,
        source_counts=source_counts,
        errors=errors,
        max_articles=max_articles,
        delivery_mode="python-service",
        enable_ai_dedupe=enable_ai,
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "DailyNewsDigestPython/2.0"

    def _read_json(self) -> dict[str, object] | None:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        if not raw:
            return None
        payload = json.loads(raw.decode("utf-8"))
        return payload if isinstance(payload, dict) else None

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_not_found(self) -> None:
        self._send_json(HTTPStatus.NOT_FOUND, {"status": "error", "message": "Not found"})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send_json(HTTPStatus.OK, {"status": "ok"})
            return
        self._send_not_found()

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/build":
            self._send_not_found()
            return
        try:
            payload = self._read_json()
            response = build_digest_response(payload)
        except Exception as exc:  # pragma: no cover
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {
                    "status": "error",
                    "message": str(exc),
                    "traceback": traceback.format_exc(),
                },
            )
            return
        self._send_json(HTTPStatus.OK, response)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
