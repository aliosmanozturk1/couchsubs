# SPDX-License-Identifier: AGPL-3.0-only
"""Offline tests for the GTA VI text dump path: extract.py gta6 → validate.py → build.py. No API calls."""
import gzip
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gta6dump
import gta6glossary_md
import validate

HEADER = "id\tpack\ttable\tidx\thash\tcategory\tgroup\tkeep\tukey\ten\n"
DUMP = [
    # Out of order on purpose: rows must come back in table order.
    ("C0100_B", "Core", "C0100", 1, "dialogue", "", "Did I just get... bitch slapped?"),
    ("C0100_A", "Core", "C0100", 0, "dialogue", "", "Don't worry, Lucia's got this."),
    ("C0000_S", "Core", "C0000", 3, "subtitle", "",
     "~sl:0:2.41~That's the hotel over there. Triple homicide...~sl:0.66~They never found the ear."),
    ("C0000_U", "Core", "C0000", 4, "ui", "", "Go through a ~o~checkpoint~s~ to make another attempt"),
    ("C0000_P", "Core", "C0000", 5, "tutorial", "", "Hold ~INPUT_AIM~ to aim."),
    ("C0000_K", "Core", "C0000", 6, "", "1", "12345"),
    ("C0000_T", "Core", "C0000", 7, "dialogue", "", "~tone~ [laughs] ~tone~"),
]


def write_dump(folder):
    lines = [HEADER] + [f"{i}\t{p}\t{t}\t{n}\tH\t{cat}\tg\t{keep}\tu\t{en}\n" for i, p, t, n, cat, keep, en in DUMP]
    (Path(folder) / "all_rows.tsv").write_text("".join(lines), encoding="utf-8")


class SegmentTests(unittest.TestCase):
    def test_timing_segments_become_separate_lines_without_tags(self):
        self.assertEqual(gta6dump.segments(DUMP[2][6]),
                         ["That's the hotel over there. Triple homicide...", "They never found the ear."])

    def test_format_tags_and_stage_notes_are_removed_placeholders_stay(self):
        self.assertEqual(gta6dump.segments("Go through a ~o~checkpoint~s~ now~n~please"),
                         ["Go through a checkpoint now please"])
        self.assertEqual(gta6dump.segments("~e~~1~~s~ Eliminated!"), ["~1~ Eliminated!"])
        self.assertEqual(gta6dump.segments("~tone~ [laughs] ~tone~"), [])
        self.assertEqual(gta6dump.placeholders("Hold ~INPUT_AIM|UrgentPulse~ for ~1$~"),
                         ["~1$~", "~INPUT_AIM|UrgentPulse~"])


class ExtractTests(unittest.TestCase):
    def extract(self, *options):
        with tempfile.TemporaryDirectory() as temp:
            write_dump(temp)
            out = Path(temp) / "rows.jsonl"
            result = subprocess.run([sys.executable, "-B", str(HERE / "extract.py"), "gta6", temp, str(out), *options],
                                    capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]

    def test_rows_follow_table_order_and_skip_codes_and_empty_lines(self):
        rows = self.extract()
        self.assertEqual([r["id"] for r in rows],
                         ["C0000_S#0", "C0000_S#1", "C0000_U", "C0000_P", "C0100_A", "C0100_B"])
        self.assertEqual(rows[0]["scene"], "Core C0000")
        self.assertEqual(rows[0]["sents"], ["That's the hotel over there.", "Triple homicide..."])
        self.assertNotIn("raw", rows[0])  # build.py reads "raw" as an OCR variant; the dump has none

    def test_table_and_category_filters(self):
        self.assertEqual([r["id"] for r in self.extract("--table", "C0100")], ["C0100_A", "C0100_B"])
        self.assertEqual([r["id"] for r in self.extract("--category", "ui,tutorial")], ["C0000_U", "C0000_P"])


class ValidateTests(unittest.TestCase):
    ROW = {"id": "x", "category": "dialogue", "text": "Hold ~INPUT_AIM~, Lucia.", "sents": ["Hold ~INPUT_AIM~, Lucia."]}

    def errors(self, tr, row=None):
        return validate.check(row or self.ROW, tr, validate.keep_names(HERE / "glossary/gta6.json"))

    def test_good_translation_passes(self):
        self.assertEqual(self.errors(["~INPUT_AIM~ basılı tut, Lucia."]), ([], []))

    def test_changed_placeholder_lost_name_and_wrong_count_are_errors(self):
        self.assertTrue(self.errors(["~INPUT_ATTACK~ basılı tut, Lucia."])[0])
        self.assertTrue(self.errors(["~INPUT_AIM~ basılı tut, kızım."])[0])
        self.assertTrue(self.errors(["Bir.", "İki."])[0])
        self.assertTrue(self.errors(None)[0])
        self.assertTrue(self.errors([" "])[0])

    def test_english_left_and_long_interface_text_are_warnings(self):
        row = {"id": "u", "category": "ui", "text": "Open the map", "sents": ["Open the map"]}
        self.assertEqual(self.errors(["Open the map"], row)[0], [])
        self.assertTrue(self.errors(["Open the map"], row)[1])
        self.assertTrue(self.errors(["Haritayı açmak için lütfen şimdi buraya dokun"], row)[1])

    def test_validated_lines_build_a_pack(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            rows = [{"id": "a", "speaker": "", "scene": "Core C0100", "category": "dialogue",
                     "text": "Don't worry. I got this.", "sents": ["Don't worry.", "I got this."]},
                    {"id": "b", "speaker": "", "scene": "Core C0100", "category": "dialogue",
                     "text": "Stop your vehicle!", "sents": ["Stop your vehicle!"]}]
            (root / "rows.jsonl").write_text("\n".join(json.dumps(r) for r in rows), encoding="utf-8")
            (root / "tr.jsonl").write_text("\n".join(json.dumps(t, ensure_ascii=False) for t in [
                {"id": "a", "tr": ["Merak etme.", "Ben hallederim."]},
                {"id": "b", "tr": ["Arabaya bin."]}]), encoding="utf-8")
            code = validate.main([str(root / "rows.jsonl"), str(root / "tr.jsonl"), "--write", str(root / "lines.json")])
            self.assertEqual(code, 0)
            result = subprocess.run([sys.executable, "-B", str(HERE / "build.py"), str(root / "lines.json"),
                                     str(root / "gta-6.json.gz"), "gta-6", "Grand Theft Auto VI", "test"],
                                    capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with gzip.open(root / "gta-6.json.gz", "rt", encoding="utf-8") as f:
                pack = json.load(f)
            self.assertIn("Merak etme. Ben hallederim.", pack["entries"].values())


class GlossaryMarkdownTests(unittest.TestCase):
    def test_glossary_markdown_matches_json(self):
        glossary = json.loads((HERE / "glossary/gta6.json").read_text(encoding="utf-8"))
        self.assertEqual((HERE / "gta6/GLOSSARY.md").read_text(encoding="utf-8"), gta6glossary_md.render(glossary),
                         "run python3 -I tools/packs/gta6glossary_md.py")

    def test_translate_rules_know_gta6(self):
        from translate_rules import GLOSSARY
        self.assertIn("Lucia", GLOSSARY["gta6"])
        self.assertIn("placeholder", GLOSSARY["gta6"])


if __name__ == "__main__":
    unittest.main()
