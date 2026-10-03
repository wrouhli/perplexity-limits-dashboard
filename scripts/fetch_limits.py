#!/usr/bin/env python3
"""Fetch Perplexity rate limits and publish them as static JSON.

Writes data/latest.json (the current snapshot) and appends one compact
line to data/history.jsonl (pruned to the retention window). Both files
are read same-origin by the dashboard, so no CORS proxy is involved.

Configuration:
  PERPLEXITY_COOKIE   full Cookie header, or just the session token
  PLD_DATA_DIR        output directory (default: data)

Exit codes: 0 published, 1 fetch/validate failed, 2 not configured.
On failure nothing is overwritten, so the page keeps the last good
snapshot and shows a staleness banner instead of an empty dashboard.

Privacy note: this script never prints the cookie, the raw payload, or
any quota number. CI logs on a public repository are public.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SOURCE_URL = "https://www.perplexity.ai/rest/rate-limit/all"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
SESSION_COOKIE_NAME = "__Secure-next-auth.session-token"
RETENTION_DAYS = 30
MAX_POINTS = 4000

QUOTA_KEYS = {
    "pro": "remaining_pro",
    "research": "remaining_research",
    "labs": "remaining_labs",
    "agentic": "remaining_agentic_research",
}

CAPPED_KEYS = ("remaining", "remaining_count", "count")


class NotConfigured(RuntimeError):
    pass


class FetchFailed(RuntimeError):
    pass


def cookie_header(value: str) -> str:
    """Accept a full Cookie header or a bare session token."""
    value = value.strip()
    if not value:
        raise NotConfigured("PERPLEXITY_COOKIE is empty")
    if "=" in value:
        return value
    return f"{SESSION_COOKIE_NAME}={value}"


def fetch_raw(cookie: str, url: str = SOURCE_URL, timeout: int = 30) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "accept": "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            "referer": "https://www.perplexity.ai/",
            "user-agent": USER_AGENT,
            "cookie": cookie,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise FetchFailed(f"HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise FetchFailed(f"network error: {exc.reason}") from exc

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise FetchFailed(f"response was not JSON ({exc.msg})") from exc
    if not isinstance(payload, dict):
        raise FetchFailed("response was not a JSON object")
    return payload


def looks_like_limits(payload: dict) -> bool:
    if any(key in payload for key in QUOTA_KEYS.values()):
        return True
    sources = payload.get("sources")
    if isinstance(sources, dict) and "source_to_limit" in sources:
        return True
    return isinstance(payload.get("model_specific_limits"), dict)


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def extract_point(payload: dict) -> dict:
    """The compact history row: timestamp plus remaining counts."""
    point = {}
    for short, source_key in QUOTA_KEYS.items():
        value = number(payload.get(source_key))
        if value is None:
            value = number((payload.get("model_specific_limits") or {}).get(source_key))
        if value is not None:
            point[short] = int(value)

    sources = payload.get("sources") or {}
    source_map = sources.get("source_to_limit") if isinstance(sources, dict) else None
    if isinstance(source_map, dict):
        caps = {}
        for key, value in source_map.items():
            entry = value if isinstance(value, dict) else {"remaining": value}
            remaining = None
            for candidate in CAPPED_KEYS:
                remaining = number(entry.get(candidate))
                if remaining is not None:
                    break
            if remaining is not None:
                caps[key] = int(remaining)
        if caps:
            point["sources"] = caps
    return point


def build_latest(payload: dict, fetched_at: str) -> dict:
    """What the dashboard reads. Keeps the payload's own shape intact."""
    return {
        "demo": False,
        "status": "ok",
        "fetched_at": fetched_at,
        **payload,
    }


def append_history(path: str, point: dict, now: datetime) -> int:
    """Append one row, drop rows past retention, rewrite atomically."""
    cutoff = now - timedelta(days=RETENTION_DAYS)
    rows = []
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    stamp = datetime.fromisoformat(str(row["t"]).replace("Z", "+00:00"))
                except (json.JSONDecodeError, KeyError, ValueError):
                    continue
                if stamp >= cutoff:
                    rows.append((stamp, line))

    stamp = datetime.fromisoformat(point["t"].replace("Z", "+00:00"))
    # Same timestamp means a re-run: replace it. Anything else is kept, even
    # if it is newer than this row.
    rows = [r for r in rows if r[0] != stamp]
    rows.append((stamp, json.dumps(point, separators=(",", ":"))))
    rows.sort(key=lambda r: r[0])
    rows = rows[-MAX_POINTS:]

    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        for _, line in rows:
            handle.write(line + "\n")
    os.replace(tmp, path)
    return len(rows)


def write_json(path: str, document: dict) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-file", help="parse a saved response instead of fetching")
    parser.add_argument("--check", action="store_true", help="validate only, write nothing")
    parser.add_argument("--data-dir", default=os.environ.get("PLD_DATA_DIR", "data"))
    args = parser.parse_args(argv)

    data_dir = args.data_dir
    os.makedirs(data_dir, exist_ok=True)
    now = datetime.now(timezone.utc)
    fetched_at = now.isoformat().replace("+00:00", "Z")

    try:
        if args.from_file:
            with open(args.from_file, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        else:
            cookie = cookie_header(os.environ.get("PERPLEXITY_COOKIE", ""))
            payload = fetch_raw(cookie)
    except (NotConfigured, FetchFailed) as exc:
        print(f"fetch failed: {exc}", file=sys.stderr)
        return 2 if isinstance(exc, NotConfigured) else 1
    except OSError as exc:
        print(f"could not read {args.from_file}: {exc}", file=sys.stderr)
        return 1

    if not looks_like_limits(payload):
        print("response did not look like a rate-limit payload", file=sys.stderr)
        return 1

    point = extract_point(payload)
    if not point:
        print("no quota values found in the payload", file=sys.stderr)
        return 1

    if args.check:
        print(f"payload OK — {len(point)} fields extracted, nothing written")
        return 0

    latest_path = os.path.join(data_dir, "latest.json")
    history_path = os.path.join(data_dir, "history.jsonl")
    point = {"t": fetched_at, **point}

    write_json(latest_path, build_latest(payload, fetched_at))
    total = append_history(history_path, point, now)

    # Deliberately no numbers: CI logs may be public.
    print(f"published snapshot ({len(point) - 1} quota fields), history rows: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
