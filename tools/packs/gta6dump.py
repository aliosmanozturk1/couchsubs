# SPDX-License-Identifier: AGPL-3.0-only
"""Read the GTA VI English text dump into translation rows.

The dump (https://github.com/psviethoa/gta6-text-en, all_rows.tsv) is not part of this repository: pass the folder
it was downloaded to. Rows keep the game's order inside each text table, so a table reads as one scene.

The game shows every ~sl:~ timing segment on its own, so each segment becomes its own row. Timing, colour and
formatting tags are removed because they never appear on screen. Placeholders (~1~, ~1$~, ~INPUT_AIM~, ~BLIP_...~)
stay in the text and must survive translation unchanged; validate.py checks them.
"""
import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c

TIMING = re.compile(r"~sl:[\d.:]*~")
INLINE_TIMING = re.compile(r"~lr:[\d.:]*~")
TONE = re.compile(r"~tone~.*?~tone~")
FORMAT = re.compile(r"~(?:[a-z]|rp|case_lower|case_end|COLOR_[A-Z0-9_]+)~|</?b>")
STAGE = re.compile(r"\[[^\]]*\]")
PLACEHOLDER = re.compile(r"~(?:\d+[a-z$]?|[A-Z][A-Z0-9_]*(?:\|[^~\s]*)?)~")


def placeholders(text):
    """Sorted placeholders of a text, for comparing English with Turkish."""
    return sorted(PLACEHOLDER.findall(text))


def segments(raw):
    """On-screen segments of one dump line, without timing or formatting tags."""
    t = TONE.sub(" ", raw)
    t = INLINE_TIMING.sub(" ", t)
    t = t.replace("~n~", " ")
    t = FORMAT.sub("", t)
    t = STAGE.sub(" ", t)
    out = []
    for part in TIMING.split(t):
        part = re.sub(r"\s+", " ", part).strip()
        if part and re.search(r"[A-Za-z]", PLACEHOLDER.sub("", part)):
            out.append(part)
    return out


def rows(dump_dir, tables=None, categories=None):
    """Translation rows in game order. tables/categories: optional sets to keep."""
    csv.field_size_limit(sys.maxsize)
    found = []
    with open(Path(dump_dir) / "all_rows.tsv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            if r.get("keep") == "1" or not (r.get("en") or "").strip():
                continue
            if tables and r["table"] not in tables:
                continue
            if categories and r["category"] not in categories:
                continue
            found.append((r["pack"], r["table"], int(r["idx"]), r["id"], r["category"], r["en"]))
    found.sort(key=lambda x: x[:3])
    out = []
    for pack, table, _, row_id, category, en in found:
        parts = segments(en)
        for n, text in enumerate(parts):
            out.append({
                "id": row_id if len(parts) == 1 else f"{row_id}#{n}",
                "speaker": "",
                "scene": f"{pack} {table}",
                "category": category,
                "text": text,
                "sents": [s for s in c.sentences(text) if s.strip()] or [text],
            })
    return out
