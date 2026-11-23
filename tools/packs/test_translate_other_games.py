# SPDX-License-Identifier: AGPL-3.0-only
"""The GTA VI additions to translate.py and translate_rules.py must not change how other games are translated.

Offline: a fake llm module records the prompts; no API call is made.
"""
import hashlib
import json
import os
import runpy
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from translate_rules import GLOSSARY, RULES

# sha256 of the prompts on main before the GTA VI change (4c00ba38). Update only for an intended change to these games.
BEFORE = {
    "ds": "d185a78f6cc2985fda6ac3bd4b028a2218c3a8928c0f98b2214d39d5f5641999",
    "sm2": "ee6582fb5ff4847ceb3d8092964df1902c392f1612725cd005c8b89be536dd5c",
    "rules": "fc3c4401b3c528fd6d257e9cb831527207330b70bc0245b9ee3f4fb653231150",
}
GTA6_ONLY = ("placeholder", "~INPUT_", "Lucia", "In Spanish")


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run_translate(game, n_lines, env):
    """Run translate.py for `game` on n distinct lines; return (SYSTEM, user prompts in call order)."""
    prompts = []
    fake = types.ModuleType("llm")
    fake.call = lambda system, user, schema, tag, **kw: prompts.append(user) or {"items": []}
    fake.spent = lambda: 0
    with tempfile.TemporaryDirectory() as temp:
        rows = Path(temp) / "rows.jsonl"
        rows.write_text("\n".join(json.dumps({"speaker": "A", "scene": "s", "text": f"Line number {i} here."})
                                  for i in range(n_lines)), encoding="utf-8")
        argv = ["translate.py", game, str(rows), str(Path(temp) / "out.json")]
        clean_env = {k: v for k, v in os.environ.items() if k != "TRANSLATE_CONTEXT"}
        with patch.dict(sys.modules, {"llm": fake}), patch.object(sys, "argv", argv), \
                patch.dict(os.environ, {**clean_env, **env}, clear=True):
            context = runpy.run_path(str(HERE / "translate.py"), run_name="__main__")
    return context["SYSTEM"], prompts


def context_lines(prompt):
    head = prompt.split("Scene:")[0]
    return [line for line in head.splitlines() if line.startswith("  ")]


class OtherGamesUnchangedTests(unittest.TestCase):
    def test_other_games_prompts_are_byte_identical_to_main(self):
        self.assertEqual(sha(GLOSSARY["ds"]), BEFORE["ds"])
        self.assertEqual(sha(GLOSSARY["sm2"]), BEFORE["sm2"])
        self.assertEqual(sha(RULES), BEFORE["rules"])

    def test_other_games_system_prompt_has_no_gta6_rules(self):
        for game in ("ds", "sm2"):
            system, _ = run_translate(game, 1, {})
            for marker in GTA6_ONLY:
                self.assertNotIn(marker, system, f"{game} system prompt picked up GTA VI text: {marker}")

    def test_default_context_stays_four_lines(self):
        _, prompts = run_translate("ds", 45, {})
        second_chunk = next(p for p in prompts if "Previous lines" in p)
        self.assertEqual(len(context_lines(second_chunk)), 4)

    def test_context_setting_is_opt_in(self):
        _, prompts = run_translate("gta6", 75, {"TRANSLATE_CONTEXT": "30"})
        second_chunk = next(p for p in prompts if "Previous lines" in p)
        self.assertEqual(len(context_lines(second_chunk)), 30)


if __name__ == "__main__":
    unittest.main()
