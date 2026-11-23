# SPDX-License-Identifier: AGPL-3.0-only
"""Shared game glossaries and translation rules for offline pack tooling."""

GLOSSARY = {
    "ds": """Game: DEATH STRANDING (Director's Cut), Kojima Productions. Keep these Turkish terms (same as our Death Stranding 2 pack):
Timefall = zaman yağmuru; the Beach = Sahil; chiral = kiral; chiralium = kiralyum; Chiral Network = Kiral Ağ;
BT / BTs = BT / BT'ler; BB = BB; Bridges, UCA, DOOMS, Homo Demens, Death Stranding, Odradek, MULE(s), Fragile Express,
Knot City names (Capital Knot City, Port Knot City, Lake Knot City, Edge Knot City), Q-pid stay as is;
cryptobiote = kriptobiyot; porter = taşıyıcı; voidout = boşluk patlaması; repatriate = geri dönen;
Extinction Entity = Yok Oluş Varlığı; Last Stranding = Son Stranding; hologram = hologram; terminal = terminal;
delivery = teslimat; cargo = kargo. Character names stay as is (Sam, Lou, Bridget, Amelie, Die-Hardman, Deadman,
Heartman, Mama, Lockne, Higgs, Cliff/Clifford Unger, Fragile, Igor)."""
    ,
    "sm2": """Game: Marvel's Spider-Man 2 (Insomniac Games). Keep names as is (Peter, Miles, MJ, Harry, Ganke, Hailey,
Rio, Yuri, Kraven, Venom, Scream, Wraith, Spider-Man, Spidey, J. Jonah Jameson, Danika, Martin Li, Dr. Connors).
Terms: symbiote = simbiyot; Hunters = Avcılar; Lizard = Kertenkele; Sandman = Kum Adam; Mister Negative = Bay Negatif;
Black Cat = Kara Kedi; Flame = Alev; the suit = kostüm; web/webs = ağ; web-shooters = ağ atıcılar; Spider-Sense = Örümcek Hissi;
Brooklyn Visions (Academy), Emily-May Foundation (EMF), F.E.A.S.T., Oscorp, Daily Bugle, Harlem, Queens, Manhattan stay as is."""
}



def _gta6():
    """GTA VI: the glossary file plus the rules for lines extracted from the text dump (gta6dump.py)."""
    import sys
    from pathlib import Path
    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    import gta6glossary
    return gta6glossary.prompt_block(here / "glossary/gta6.json") + """
Lines come from the game's own text tables in game order; one table is usually one scene, phone call or a pool of
ambient lines. Speakers are not known: infer them from the neighbouring lines and keep one form of address per scene.
Keep every placeholder exactly as written and the same number of times: ~1~, ~2~, ~1$~, ~1b~, ~INPUT_...~,
~INPUTGROUP_...~, ~BLIP_...~. Build the sentence so no Turkish suffix is attached to a placeholder.
"In Spanish:" / "Unknown Language:" prefixes become "İspanyolca:" / "Bilinmeyen dil:".
Profanity, insults and slurs (racist and sexist ones included) are never censored or softened: translate each one at
the same strength, even when a milder Turkish word would also fit. Never add one that is not in the English."""


# Optional: a copy of this file without gta6glossary.py / glossary/gta6.json (tests that run translate.py from a
# temporary folder) keeps working for the other games; asking for "gta6" there fails with KeyError.
try:
    GLOSSARY["gta6"] = _gta6()
except (ImportError, FileNotFoundError):
    pass

RULES = """Rules:
- Natural spoken Turkish, the way a professional Turkish subtitle translator would write it; match the tone and register
  (casual banter stays casual; use "sen" between friends, family and enemies; "siz" only for formal/respectful address).
- Translate every sentence separately: each numbered sentence gets its own Turkish sentence that stands on its own,
  because the game may show it alone on screen. Never move meaning between sentences; never merge or skip one.
- Keep profanity and insults at the same strength (fuck = siktir/amına koyayım etc., shit = siktir/bok, damn = lanet olsun/kahretsin).
  Do not soften and do not intensify.
- Keep punctuation style (…, ?!, quotes, em dashes). Keep numbers. No English words left unless they are names or listed terms.
- Interjections and sounds (Ugh, Huh, Hmm, Ah) get a Turkish equivalent or stay as a sound (Ah, Hı, Hmm).
- Output only the requested JSON."""
