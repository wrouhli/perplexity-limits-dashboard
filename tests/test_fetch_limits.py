"""Tests for the refresh script. Run: python3 -m unittest discover -s tests"""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import fetch_limits as fl  # noqa: E402

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)

PAYLOAD = {
    "remaining_pro": 196,
    "remaining_research": 48,
    "remaining_labs": 1,
    "remaining_agentic_research": 0,
    "reset_at": "2026-10-10T00:00:00Z",
    "sources": {
        "source_to_limit": {
            "github_mcp_direct": {"remaining": 45, "monthly_limit": 100},
            "notion_mcp": {"remaining": 12, "monthly_limit": 50},
            "web": {"remaining": None, "monthly_limit": None},
            "social": {"remaining": 0, "monthly_limit": 0},
            "box": 7,
        }
    },
}


class CookieTest(unittest.TestCase):
    def test_bare_token_gets_the_cookie_name(self):
        self.assertEqual(
            fl.cookie_header("abc123"),
            f"{fl.SESSION_COOKIE_NAME}=abc123",
        )

    def test_full_header_passes_through(self):
        raw = "a=1; __Secure-next-auth.session-token=xyz"
        self.assertEqual(fl.cookie_header(raw), raw)

    def test_empty_is_not_configured(self):
        with self.assertRaises(fl.NotConfigured):
            fl.cookie_header("   ")


class ShapeTest(unittest.TestCase):
    def test_recognises_a_limits_payload(self):
        self.assertTrue(fl.looks_like_limits(PAYLOAD))
        self.assertTrue(fl.looks_like_limits({"model_specific_limits": {}}))
        self.assertTrue(fl.looks_like_limits({"sources": {"source_to_limit": {}}}))

    def test_rejects_an_error_body(self):
        self.assertFalse(fl.looks_like_limits({"error": "unauthorized"}))

    def test_numbers(self):
        self.assertEqual(fl.number("42"), 42)
        self.assertEqual(fl.number(0), 0)
        self.assertIsNone(fl.number(None))
        self.assertIsNone(fl.number(True))
        self.assertIsNone(fl.number("nope"))


class ExtractTest(unittest.TestCase):
    def test_point_has_quota_and_source_counts(self):
        point = fl.extract_point(PAYLOAD)
        self.assertEqual(point["pro"], 196)
        self.assertEqual(point["agentic"], 0)
        self.assertEqual(point["sources"]["github_mcp_direct"], 45)
        self.assertEqual(point["sources"]["box"], 7)

    def test_missing_quotas_are_omitted_not_zeroed(self):
        point = fl.extract_point({"remaining_pro": 5, "sources": {"source_to_limit": {}}})
        self.assertEqual(point, {"pro": 5})

    def test_falls_back_to_model_specific_limits(self):
        point = fl.extract_point({"model_specific_limits": {"remaining_pro": 11}})
        self.assertEqual(point["pro"], 11)

    def test_empty_payload_extracts_nothing(self):
        self.assertEqual(fl.extract_point({"sources": {}}), {})

    def test_latest_keeps_the_original_shape(self):
        latest = fl.build_latest(PAYLOAD, "2026-10-03T12:00:00Z")
        self.assertFalse(latest["demo"])
        self.assertEqual(latest["remaining_pro"], 196)
        self.assertEqual(latest["fetched_at"], "2026-10-03T12:00:00Z")


class HistoryTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "history.jsonl")

    def rows(self):
        with open(self.path, encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def test_appends_in_order(self):
        fl.append_history(self.path, {"t": "2026-10-03T06:00:00Z", "pro": 220}, NOW)
        total = fl.append_history(self.path, {"t": "2026-10-03T12:00:00Z", "pro": 196}, NOW)
        self.assertEqual(total, 2)
        self.assertEqual([r["pro"] for r in self.rows()], [220, 196])

    def test_out_of_order_rows_are_sorted(self):
        fl.append_history(self.path, {"t": "2026-10-03T12:00:00Z", "pro": 196}, NOW)
        fl.append_history(self.path, {"t": "2026-10-03T06:00:00Z", "pro": 220}, NOW)
        self.assertEqual([r["pro"] for r in self.rows()], [220, 196])

    def test_old_rows_are_pruned(self):
        stale = (NOW - timedelta(days=45)).isoformat().replace("+00:00", "Z")
        fl.append_history(self.path, {"t": stale, "pro": 600}, NOW - timedelta(days=1))
        fl.append_history(self.path, {"t": "2026-10-03T12:00:00Z", "pro": 196}, NOW)
        self.assertEqual(len(self.rows()), 1)

    def test_junk_lines_do_not_break_the_file(self):
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write("not json\n")
            handle.write('{"t":"whenever","pro":1}\n')
            handle.write('{"t":"2026-10-03T06:00:00Z","pro":220}\n')
        total = fl.append_history(self.path, {"t": "2026-10-03T12:00:00Z", "pro": 196}, NOW)
        self.assertEqual(total, 2)

    def test_retention_bound_is_enforced(self):
        for days in (40, 20, 5):
            stamp = (NOW - timedelta(days=days)).isoformat().replace("+00:00", "Z")
            fl.append_history(self.path, {"t": stamp, "pro": days}, NOW)
        self.assertEqual(len(self.rows()), 2, "only rows inside the window survive")


class MainTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.fixture = os.path.join(self.dir, "payload.json")
        with open(self.fixture, "w", encoding="utf-8") as handle:
            json.dump(PAYLOAD, handle)
        self.data_dir = os.path.join(self.dir, "data")
        os.makedirs(self.data_dir)

    def latest(self):
        with open(os.path.join(self.data_dir, "latest.json"), encoding="utf-8") as handle:
            return json.load(handle)

    def test_check_mode_writes_nothing(self):
        code = fl.main(["--from-file", self.fixture, "--check", "--data-dir", self.data_dir])
        self.assertEqual(code, 0)
        self.assertFalse(os.listdir(self.data_dir))

    def test_publishes_latest_and_history(self):
        code = fl.main(["--from-file", self.fixture, "--data-dir", self.data_dir])
        self.assertEqual(code, 0)
        self.assertFalse(self.latest()["demo"])
        self.assertIn("remaining_pro", self.latest())
        with open(os.path.join(self.data_dir, "history.jsonl"), encoding="utf-8") as handle:
            row = json.loads(handle.readline())
        self.assertEqual(row["pro"], 196)
        self.assertEqual(row["sources"]["notion_mcp"], 12)

    def test_missing_configuration_exits_2_and_keeps_old_data(self):
        sentinel = os.path.join(self.data_dir, "latest.json")
        with open(sentinel, "w", encoding="utf-8") as handle:
            handle.write('{"keep":"me"}')
        saved = os.environ.pop("PERPLEXITY_COOKIE", None)
        try:
            code = fl.main(["--data-dir", self.data_dir, "--from-file", ""])
        finally:
            if saved is not None:
                os.environ["PERPLEXITY_COOKIE"] = saved
        self.assertEqual(code, 2)
        with open(sentinel, encoding="utf-8") as handle:
            self.assertEqual(handle.read(), '{"keep":"me"}')

    def test_unrelated_payload_is_rejected(self):
        junk = os.path.join(self.dir, "junk.json")
        with open(junk, "w", encoding="utf-8") as handle:
            json.dump({"error": "unauthorized"}, handle)
        code = fl.main(["--from-file", junk, "--data-dir", self.data_dir])
        self.assertEqual(code, 1)
        self.assertFalse(os.listdir(self.data_dir))

    def test_missing_fixture_is_an_error_not_a_crash(self):
        code = fl.main(["--from-file", os.path.join(self.dir, "nope.json"), "--data-dir", self.data_dir])
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
