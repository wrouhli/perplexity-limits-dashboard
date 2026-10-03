"""Static wiring tests: the page, the script, the stylesheet and the two
data files must agree with each other. These catch the failures a browser
would otherwise reveal at runtime (missing ids, dangling asset paths,
malformed JSON), without needing a browser in CI.

Run: python3 -m unittest discover -s tests
"""

import json
import os
import re
import unittest
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


class ElementWiringTest(unittest.TestCase):
    """app.js reaches for elements by id; every one must exist."""

    @classmethod
    def setUpClass(cls):
        cls.html = read("index.html")
        cls.app = read("app.js")

    def test_every_referenced_id_exists_in_the_markup(self):
        html_ids = set(re.findall(r'\bid="([^"]+)"', self.html))
        referenced = set(re.findall(r"\bel\('([^']+)'\)", self.app))
        missing = sorted(referenced - html_ids)
        self.assertEqual(missing, [], f"app.js references ids that index.html does not define: {missing}")

    def test_no_duplicate_ids(self):
        ids = re.findall(r'\bid="([^"]+)"', self.html)
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        self.assertEqual(duplicates, [], f"duplicate ids in index.html: {duplicates}")

    def test_aria_references_resolve(self):
        targets = re.findall(r'aria-labelledby="([^"]+)"', self.html)
        html_ids = set(re.findall(r'\bid="([^"]+)"', self.html))
        missing = sorted({t for t in targets if t not in html_ids})
        self.assertEqual(missing, [], f"aria-labelledby points at nothing: {missing}")

    def test_every_asset_index_html_references_exists(self):
        refs = re.findall(r'(?:href|src)="([^":#?]+)"', self.html)
        local = [r for r in refs if not r.startswith(("http", "//"))]
        missing = [r for r in local if not os.path.exists(os.path.join(ROOT, r))]
        self.assertEqual(missing, [], f"index.html references missing files: {missing}")

    def test_classes_toggled_from_js_are_styled(self):
        css = read("styles.css")
        toggled = set(re.findall(r"classList\.(?:add|remove|toggle)\('([^']+)'", self.app))
        missing = sorted(c for c in toggled if not re.search(rf"\.{re.escape(c)}\b", css))
        self.assertEqual(missing, [], f"classes toggled by app.js have no CSS rule: {missing}")

    def test_script_is_loaded_as_a_module(self):
        self.assertIn('type="module" src="app.js"', self.html)
        self.assertIn("import * as L from './lib.js'", self.app)

    def test_lib_exports_everything_app_imports(self):
        lib = read("lib.js")
        exported = set(re.findall(r"export (?:function|const)\s+(\w+)", lib))
        used = set(re.findall(r"\bL\.(\w+)", self.app))
        missing = sorted(used - exported)
        self.assertEqual(missing, [], f"app.js uses lib.js exports that do not exist: {missing}")


class WorkflowTest(unittest.TestCase):
    """The deploy step copies the site by hand, so it can silently go stale."""

    WORKFLOWS = (".github/workflows/deploy.yml", ".github/workflows/refresh.yml")

    def staged_files(self, workflow):
        text = read(*workflow.split("/"))
        staged = []
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("cp "):
                staged.extend(t for t in line.split()[1:-1] if not t.startswith("-"))
        return [s for s in staged if not s.endswith("/")]

    def test_every_staged_file_exists(self):
        for workflow in self.WORKFLOWS:
            staged = self.staged_files(workflow)
            self.assertTrue(staged, f"{workflow} stages nothing")
            missing = [s for s in staged if not os.path.exists(os.path.join(ROOT, s))]
            self.assertEqual(missing, [], f"{workflow} stages files that do not exist: {missing}")

    def test_both_workflows_stage_the_same_files(self):
        lists = {w: sorted(self.staged_files(w)) for w in self.WORKFLOWS}
        values = list(lists.values())
        self.assertEqual(values[0], values[1], f"the workflows disagree about what to publish: {lists}")

    def test_every_page_file_is_published(self):
        must_publish = ["index.html", "styles.css", "app.js", "lib.js", "sw.js", "icon.svg", "manifest.webmanifest"]
        staged = self.staged_files(self.WORKFLOWS[0])
        missing = [f for f in must_publish if f not in staged]
        self.assertEqual(missing, [], f"these page files are not published: {missing}")

    def test_data_directory_is_published(self):
        for workflow in self.WORKFLOWS:
            self.assertIn("cp -r data _site/data", read(*workflow.split("/")))


class ServiceWorkerTest(unittest.TestCase):
    def test_precached_shell_files_exist(self):
        sw = read("sw.js")
        shell = re.findall(r"'\./([^']*)'", sw)
        missing = [s for s in shell if s and not os.path.exists(os.path.join(ROOT, s))]
        self.assertEqual(missing, [], f"sw.js precaches files that do not exist: {missing}")

    def test_data_files_are_matched_by_the_worker(self):
        sw = read("sw.js")
        self.assertIn(r"\/data\/[^/]+\.(json|jsonl)$", sw)


class DataFilesTest(unittest.TestCase):
    def test_latest_json_is_valid_and_flagged_as_demo(self):
        latest = json.loads(read("data", "latest.json"))
        self.assertTrue(latest["demo"], "the committed snapshot must be marked demo")
        self.assertIn("sources", latest)
        self.assertIn("source_to_limit", latest["sources"])

    def test_history_rows_are_valid_and_ordered(self):
        stamps = []
        for line in read("data", "history.jsonl").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            stamps.append(datetime.fromisoformat(row["t"].replace("Z", "+00:00")))
        self.assertGreater(len(stamps), 10, "history should have enough points to chart")
        self.assertEqual(stamps, sorted(stamps), "history must be oldest-first")
        self.assertLessEqual(stamps[-1], datetime.now(timezone.utc) + _skew())

    def test_history_and_latest_agree_on_the_last_point(self):
        rows = [json.loads(l) for l in read("data", "history.jsonl").splitlines() if l.strip()]
        latest = json.loads(read("data", "latest.json"))
        self.assertEqual(rows[-1]["pro"], latest["remaining_pro"])


def _skew():
    from datetime import timedelta

    return timedelta(minutes=5)


if __name__ == "__main__":
    unittest.main()
