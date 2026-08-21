import csv
import json
import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
INPUT_FILE = BASE_DIR / "English-Dictionary-Database/english Dictionary.csv"
OUTPUT_FILE = BASE_DIR / "english_words_lookup.json"
REPORT_FILE = BASE_DIR / "english_words_quality_report.json"

PartOfSpeech = tuple[str, ...]

# Labels whose meaning cannot be inferred reliably from a general pattern.
EXACT_POS: dict[str, PartOfSpeech] = {
    "/": ("adjective",),
    "/.": ("noun",),
    "2d person": ("verb",),
    "3d sing.": ("verb",),
    "3d sing. pr.": ("verb",),
    "3d sing.pr.": ("verb",),
    "a": ("adjective",),
    "a/": ("adjective",),
    "ae.": ("adjective",),
    "ambassade.": ("noun",),
    "an.": ("adjective",),
    "archaic": ("verb",),
    "b.": ("noun",),
    "b. t.": ("verb",),
    "comp.": ("adjective",),
    "dat. & obj.": ("pronoun",),
    "e. i.": ("verb",),
    "e. t.": ("verb",),
    "fem.": ("noun",),
    "i.": ("verb",),
    "indic. present": ("verb",),
    "l. catechunenus, gr. / instructed, from /. see": ("noun",),
    "m.": ("noun",),
    "mexcal.": ("noun",),
    "n": ("noun",),
    "obj.": ("pronoun",),
    "object.": ("pronoun",),
    "obs": ("verb",),
    "obs.": ("verb",),
    "p.": ("noun",),
    "p. pl.": ("noun",),
    "pref.": ("prefix",),
    "prefix.": ("prefix",),
    "a prefix.": ("prefix",),
    "q.": ("adjective",),
    "see": ("noun",),
    "sing.": ("noun",),
    "sing. & pl.": ("noun",),
    "sing. / pl.": ("noun",),
    "sing. or pl.": ("noun",),
    "subj. 3d pers. sing.": ("verb",),
    "suffix.": ("suffix",),
    "super.": ("adjective",),
    "supperl.": ("adjective",),
    "syntactically sing.": ("noun",),
    "variant": ("noun", "verb"),
}

# Source-specific corrections where the same malformed label has different meanings.
WORD_POS_OVERRIDES: dict[tuple[str, str], PartOfSpeech] = {
    ("by", "pref."): ("preposition",),
}

POS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "noun",
        re.compile(
            r"\bn(?:\.[a-z]+)*\.*(?=$|[\s,&/])|\bn\s+\.(?=$|[\s,&/])"
            r"|\bpl\.|\bsing\.|\bmasc\.|\bfem\."
        ),
    ),
    (
        "verb",
        re.compile(
            r"\bv(?:\.[a-z]+)*\.*(?=$|[\s,&/])"
            r"|\bvb[./]?|\bverb\b|\bimp\.|\bp[\].,]?\s*p\.?"
            r"|\bp[\].,]?\s*(?:a|pr)\.|\bpr\.p\.|\binf\.|\binfinitive\b"
            r"|\bparticiple\b|\bauxiliary\b|\bpres\.|\bimperative\b"
        ),
    ),
    (
        "adjective",
        re.compile(
            r"\ba(?:\.[a-z]+)*\.*(?=$|[\s,&/])|\badj\.|\bsuperl|\bcompar"
        ),
    ),
    ("adverb", re.compile(r"\badv\.|\bad\.|\bads\.|\bdv\.")),
    ("preposition", re.compile(r"\bprep\.")),
    ("conjunction", re.compile(r"\bconj\.")),
    ("pronoun", re.compile(r"\bpron\.|\bobj\.|\bobject\.")),
    ("interjection", re.compile(r"\binterj\.|\binerj\.")),
    ("article", re.compile(r"\barticle\b|\bart\.")),
    ("prefix", re.compile(r"\bprefix\.|\bpref\.")),
)


def normalize_pos(identifier: object, word: str = "") -> list[str]:
    """Return normalized parts of speech for one source identifier."""
    value = str(identifier).strip().lower()
    override = WORD_POS_OVERRIDES.get((word.lower(), value))
    if override is not None:
        return list(override)

    exact = EXACT_POS.get(value)
    if exact is not None:
        return list(exact)

    categories = [
        category for category, pattern in POS_PATTERNS if pattern.search(value)
    ]
    return list(dict.fromkeys(categories))


def suspicious_reasons(word: str) -> list[str]:
    """Return data-quality warnings for a cleaned word."""
    checks: tuple[tuple[str, bool], ...] = (
        ("contains_backslash", "\\" in word),
        ("contains_digit", bool(re.search(r"\d", word))),
        (
            "contains_control_character",
            any(ord(character) < 32 for character in word),
        ),
        ("unusual_punctuation", bool(re.search(r"[^\w\s'-]{2,}", word))),
        ("very_long", len(word) > 40),
        ("multiple_hyphens", "--" in word),
    )
    return [reason for reason, applies in checks if applies]


def read_source(path: Path) -> Iterable[tuple[str, str]]:
    """Yield cleaned word and POS values from the source CSV."""
    csv.field_size_limit(10_000_000)
    with path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        required_columns = {"word", "pos"}
        missing_columns = required_columns.difference(reader.fieldnames or ())
        if missing_columns:
            missing = ", ".join(sorted(missing_columns))
            raise ValueError(f"Missing required CSV columns: {missing}")

        for row in reader:
            word = (row["word"] or "").strip().lower()
            pos = (row["pos"] or "").strip()
            if word and pos:
                yield word, pos


def build_lookup(
    rows: Iterable[tuple[str, str]],
) -> tuple[dict[str, list[str]], dict[str, Any]]:
    """Build the lookup and its data-quality report in one pass."""
    word_categories: defaultdict[str, set[str]] = defaultdict(set)
    suspicious_words: list[dict[str, Any]] = []
    unknown_pos: list[dict[str, str]] = []
    removed_affixes = 0

    for word, original_pos in rows:
        if word.startswith("-"):
            removed_affixes += 1
            continue

        categories = normalize_pos(original_pos, word)
        reasons = suspicious_reasons(word)
        if reasons:
            suspicious_words.append(
                {
                    "word": word,
                    "reasons": reasons,
                    "original_pos": original_pos,
                    "normalized_pos": categories,
                }
            )

        if categories:
            word_categories[word].update(categories)
        else:
            unknown_pos.append({"word": word, "original_pos": original_pos})

    lookup = {
        word: sorted(categories)
        for word, categories in sorted(word_categories.items())
    }
    pos_counts = Counter(
        category for categories in lookup.values() for category in categories
    )
    report = {
        "suspicious_words": suspicious_words,
        "unknown_pos": unknown_pos,
        "statistics": {
            "unique_words": len(lookup),
            "removed_affixes": removed_affixes,
            "suspicious_words": len(suspicious_words),
            "unknown_pos": len(unknown_pos),
            "pos_counts": dict(pos_counts.most_common()),
        },
    }
    return lookup, report


def write_json(path: Path, data: Any) -> None:
    """Write JSON in a stable, human-readable format."""
    with path.open("w", encoding="utf-8") as output:
        json.dump(data, output, ensure_ascii=False, indent=2)
        output.write("\n")


def print_summary(
    lookup: dict[str, list[str]], report: dict[str, Any]
) -> None:
    """Print build statistics and a short lookup preview."""
    statistics = report["statistics"]
    print(
        "\n".join(
            (
                "Dictionary build complete",
                f"Unique words:     {statistics['unique_words']:,}",
                f"Removed affixes:  {statistics['removed_affixes']:,}",
                f"Suspicious words: {statistics['suspicious_words']:,}",
                f"Unknown POS:      {statistics['unknown_pos']:,}",
                f"Output file:      {OUTPUT_FILE}",
                f"Quality report:   {REPORT_FILE}",
                "",
                "Normalized POS counts:",
            )
        )
    )
    for category, count in statistics["pos_counts"].items():
        print(f"{category:20} {count:,}")

    print("\nFirst 20 entries:")
    for word, categories in list(lookup.items())[:20]:
        print(f"{word}: {categories}")


def main() -> None:
    """Generate the lookup and quality-report files."""
    lookup, report = build_lookup(read_source(INPUT_FILE))
    write_json(OUTPUT_FILE, lookup)
    write_json(REPORT_FILE, report)
    print_summary(lookup, report)


if __name__ == "__main__":
    main()
