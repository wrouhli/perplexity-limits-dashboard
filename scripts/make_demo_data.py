"""Regenerate the demo dataset as a clean, jitter-free series.

Deliberately arithmetic (integer steps, one point per day) so the committed
file is reproducible by hand and reviewable in a diff.

    python3 scripts/make_demo_data.py [data_dir]
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

START = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
DAYS = 14
POINTS = DAYS + 1
RESET = "2026-10-10T00:00:00Z"

QUOTAS = {
    "pro": (600, 29),
    "research": (100, 4),
    "labs": (15, 1),
    "agentic": (14, 1),
}

CAPPED = {
    "github_mcp_direct": (100, 4, 100),
    "notion_mcp": (50, 2, 50),
    "scholar": (30, 1, 30),
    "crunchbase": (14, 1, 20),
}


def main() -> int:
    data_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
    )
    os.makedirs(data_dir, exist_ok=True)

    rows = []
    for i in range(POINTS):
        stamp = START + timedelta(days=i)
        row = {
            "t": stamp.isoformat().replace("+00:00", "Z"),
            **{key: start - step * i for key, (start, step) in QUOTAS.items()},
            "sources": {key: start - step * i for key, (start, step, _) in CAPPED.items()},
        }
        rows.append(json.dumps(row, separators=(",", ":")))

    with open(os.path.join(data_dir, "history.jsonl"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(rows) + "\n")

    last = rows and json.loads(rows[-1])
    source_to_limit = {
        key: {"remaining": last["sources"][key], "monthly_limit": monthly}
        for key, (_, _, monthly) in CAPPED.items()
    }
    source_to_limit["web"] = {"remaining": None, "monthly_limit": None}
    source_to_limit["social"] = {"remaining": None, "monthly_limit": None}
    for key in ("factset", "pitchbook_mcp_cashmere", "wiley_mcp_cashmere"):
        source_to_limit[key] = {"remaining": 0, "monthly_limit": 0}

    latest = {
        "demo": True,
        "status": "ok",
        "fetched_at": last["t"],
        "reset_at": RESET,
        "remaining_pro": last["pro"],
        "remaining_research": last["research"],
        "remaining_labs": last["labs"],
        "remaining_agentic_research": last["agentic"],
        "limit_pro": QUOTAS["pro"][0],
        "limit_research": QUOTAS["research"][0],
        "limit_labs": QUOTAS["labs"][0],
        "limit_agentic_research": QUOTAS["agentic"][0],
        "sources": {"source_to_limit": source_to_limit},
    }
    with open(os.path.join(data_dir, "latest.json"), "w", encoding="utf-8") as handle:
        json.dump(latest, handle, indent=2)
        handle.write("\n")

    print(f"{len(rows)} history rows, latest: " + ", ".join(f"{k}={last[k]}" for k in QUOTAS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
