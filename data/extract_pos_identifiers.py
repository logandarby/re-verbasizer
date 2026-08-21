"""Report every unique source POS identifier and its normalization."""

import argparse
from collections import defaultdict
from pathlib import Path
from typing import Any

from main import BASE_DIR, INPUT_FILE, normalize_pos, read_source, write_json

DEFAULT_OUTPUT = BASE_DIR / "pos_identifiers_report.json"


def extract_identifiers(input_path: Path) -> list[dict[str, Any]]:
    """Return sorted POS identifiers, counts, examples, and normalized values."""
    identifiers: defaultdict[str, list[str]] = defaultdict(list)
    for word, identifier in read_source(input_path):
        identifiers[identifier].append(word)

    return [
        {
            "identifier": identifier,
            "count": len(words),
            "example_words": sorted(set(words))[:10],
            "normalized_pos": normalize_pos(identifier),
        }
        for identifier, words in sorted(
            identifiers.items(), key=lambda item: item[0].lower()
        )
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        default=INPUT_FILE,
        help=f"source CSV (default: {INPUT_FILE})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"JSON report path (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    identifiers = extract_identifiers(args.input)
    write_json(args.output, identifiers)

    unknown = [item for item in identifiers if not item["normalized_pos"]]
    print(f"Wrote {len(identifiers):,} unique POS identifiers to {args.output}")
    print(f"Unrecognized identifiers: {len(unknown):,}")
    for item in unknown:
        print(f"  {item['identifier']!r}: {', '.join(item['example_words'])}")
    if unknown:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
