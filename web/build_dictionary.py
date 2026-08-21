"""Pack the cleaned dictionary into the compact format used by the web worker."""

import json
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
SOURCE_FILE = WEB_DIR.parent / "data" / "english_words_lookup.json"
OUTPUT_FILE = WEB_DIR / "dictionary.compact.json"

PARTS_OF_SPEECH = (
    "noun",
    "verb",
    "adjective",
    "adverb",
    "preposition",
    "interjection",
    "pronoun",
    "conjunction",
    "prefix",
    "article",
)
POS_BITS = {name: 1 << index for index, name in enumerate(PARTS_OF_SPEECH)}


def main() -> None:
    """Convert verbose POS arrays into alternating word and bitmask values."""
    with SOURCE_FILE.open(encoding="utf-8") as source:
        lookup: dict[str, list[str]] = json.load(source)

    packed_words: list[str | int] = []
    for word, categories in lookup.items():
        unknown = set(categories).difference(POS_BITS)
        if unknown:
            labels = ", ".join(sorted(unknown))
            raise ValueError(f"{word!r} has unsupported POS labels: {labels}")
        mask = sum(POS_BITS[category] for category in categories)
        packed_words.extend((word, mask))

    payload = {"p": PARTS_OF_SPEECH, "w": packed_words}
    with OUTPUT_FILE.open("w", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False, separators=(",", ":"))

    source_size = SOURCE_FILE.stat().st_size
    output_size = OUTPUT_FILE.stat().st_size
    reduction = 100 * (1 - output_size / source_size)
    print(
        f"Packed {len(lookup):,} words into {OUTPUT_FILE.name} "
        f"({output_size / 1_000_000:.2f} MB, {reduction:.0f}% smaller)"
    )


if __name__ == "__main__":
    main()
