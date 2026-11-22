# SPDX-License-Identifier: AGPL-3.0-only
"""Check a Turkish translation of extracted rows before it goes into a pack.

Usage: python3 -I validate.py <rows.jsonl> <translation> [--write <lines.json>] [--glossary <gta6.json>] [--strict]

<rows.jsonl> is what extract.py wrote. <translation> is either
  - an agent's output (.jsonl): one {"id": <row id>, "tr": [one Turkish string per row sentence], "notes": ""} per row,
  - or translate.py's output (.json), matched to the rows by English text.

Errors (exit 1): a row without a translation, a wrong number of sentences, an empty sentence, a placeholder that was
changed, added or dropped, a glossary "keep" name that disappeared. Warnings (exit 0 unless --strict): interface text
much longer than the English, a sentence left in English.
--write saves the rows without errors in the format build.py reads.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import common as c
from gta6dump import placeholders

SHORT = {"ui", "item"}   # categories shown in tight interface boxes


def option(args, name, default=None):
    return args[args.index(name) + 1] if name in args else default


def load_translation(path, rows):
    """id -> list of Turkish sentences."""
    if path.suffix == ".jsonl":
        out = {}
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                item = json.loads(line)
                tr = item.get("tr")
                out[item["id"]] = [tr] if isinstance(tr, str) else tr
        return out
    by_key = {}
    for line in json.loads(path.read_text(encoding="utf-8")):
        by_key.setdefault(c.key(line["text"]), line.get("tr"))
    return {r["id"]: by_key[c.key(r["text"])] for r in rows if c.key(r["text"]) in by_key}


def keep_names(glossary):
    if not glossary or not Path(glossary).is_file():
        return []
    names = json.loads(Path(glossary).read_text(encoding="utf-8")).get("keep", [])
    return [(n, re.compile(r"(?<![\w])" + re.escape(n) + r"(?![\w])")) for n in names]


def check(row, tr, names):
    """(errors, warnings) for one row."""
    errors, warnings = [], []
    sents = row["sents"]
    if tr is None:
        return ["no translation"], []
    if not isinstance(tr, list) or len(tr) != len(sents):
        return [f"expected {len(sents)} sentences, got {len(tr) if isinstance(tr, list) else 'no list'}"], []
    for j, (en, t) in enumerate(zip(sents, tr)):
        if not t or not t.strip():
            errors.append(f"sentence {j} is empty")
            continue
        if placeholders(en) != placeholders(t):
            errors.append(f"sentence {j} placeholders {placeholders(en)} became {placeholders(t)}")
        for name, pattern in names:
            if pattern.search(en) and name not in t:
                errors.append(f"sentence {j} lost the name {name!r}")
        plain = c.canon(re.sub(r"~[^~]*~", " ", en))
        # Single words (Hmm, Ah, a name) may stay; longer English left as is is almost always a miss.
        if len(plain.split()) >= 2 and plain == c.canon(re.sub(r"~[^~]*~", " ", t)) \
                and plain not in {c.canon(n) for n, _ in names}:
            warnings.append(f"sentence {j} is still English")
    whole_en, whole_tr = " ".join(sents), " ".join(tr)
    if row.get("category") in SHORT and len(whole_tr) > 1.3 * len(whole_en) + 4:
        warnings.append(f"interface text grew from {len(whole_en)} to {len(whole_tr)} characters")
    return errors, warnings


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    rows_path, tr_path, args = Path(argv[0]), Path(argv[1]), argv[2:]
    rows = [json.loads(l) for l in rows_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    translation = load_translation(tr_path, rows)
    names = keep_names(option(args, "--glossary", str(HERE / "glossary/gta6.json")))
    good, n_errors, n_warnings = [], 0, 0
    for row in rows:
        errors, warnings = check(row, translation.get(row["id"]), names)
        for message in errors:
            print(f"ERROR {row['id']}: {message}")
        for message in warnings:
            print(f"WARN  {row['id']}: {message}")
        n_errors += len(errors)
        n_warnings += len(warnings)
        if not errors:
            good.append({"key": c.key(row["text"]), "speaker": row.get("speaker", ""), "scene": row.get("scene", ""),
                         "text": row["text"], "sents": row["sents"], "tr": translation[row["id"]], "raw": None})
    print(f"{len(rows)} rows, {len(good)} ok, {n_errors} errors, {n_warnings} warnings")
    out = option(args, "--write")
    if out:
        Path(out).write_text(json.dumps(good, ensure_ascii=False, indent=0), encoding="utf-8")
    return 1 if n_errors or ("--strict" in args and n_warnings) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
