# SPDX-License-Identifier: AGPL-3.0-only
"""Write tools/packs/gta6/GLOSSARY.md from glossary/gta6.json, so people and agents read the same terms the model gets.

Usage: python3 -I gta6glossary_md.py [<gta6.json> [<GLOSSARY.md>]]
The JSON stays the only source; test_gta6.py fails when the Markdown is out of date.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TITLES = {"address": "Hitaplar", "insults": "Küfür ve hakaret", "crime": "Suç ve sokak terimleri",
          "game_ui": "Oyun arayüzü", "phrases": "Kalıplar", "places": "Yerler"}


def cell(value):
    return (value or "—").replace("|", "\\|")


def render(glossary):
    out = ["# GTA VI sözlüğü", "",
           "Bu dosya `tools/packs/glossary/gta6.json`'dan `gta6glossary_md.py` ile üretilir; elle düzenlenmez.",
           "Değişiklik önerisi için `AGENT_WORKFLOW.md` → \"Sözlük değişikliği\".", "",
           f"Kaynak: {glossary['source']}.", "", "## Hitap kuralı", "", glossary["register"], "",
           "## Aynen kalanlar", "",
           "Bu isimler çevrilmez; Türkçe ekler kesme işaretiyle eklenir (Lucia'yı, Vice City'de).", "",
           ", ".join(f"`{name}`" for name in glossary["keep"]), ""]
    # Every term section, in file order: a section added to the JSON shows up here without a code change.
    sections = [k for k, v in glossary.items() if isinstance(v, list) and v and isinstance(v[0], dict) and "tr" in v[0]]
    for key in sections:
        title = TITLES.get(key, key)
        out += [f"## {title}", "", "| İngilizce | Türkçe | GTA V'te | Not |", "|---|---|---|---|"]
        out += [f"| {cell(e['en'])} | {cell(e['tr'])} | {cell(e.get('gta_v'))} | {cell(e.get('note'))} |"
                for e in glossary.get(key, [])]
        out.append("")
    return "\n".join(out)


if __name__ == "__main__":
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "glossary/gta6.json"
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "gta6/GLOSSARY.md"
    dst.write_text(render(json.loads(src.read_text(encoding="utf-8"))), encoding="utf-8")
    print("wrote", dst)
