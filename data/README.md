# Dictionary data

This folder converts `English-Dictionary-Database/english Dictionary.csv` into a
clean, lowercase word to parts-of-speech (POS) lookup:

```json
{
  "example": ["noun", "verb"]
}
```

Run from this folder:

```bash
python3 main.py
python3 extract_pos_identifiers.py
```

## Files

- `English-Dictionary-Database/` — original dictionary source and CSV data.
- `main.py` — cleans words, normalizes POS labels, removes affixes, and builds
  the lookup and quality report.
- `extract_pos_identifiers.py` — lists every source POS label, its frequency,
  examples, and normalized value. It fails if a label is unhandled.
- `english_words_lookup.json` — final word-to-POS lookup used by the project.
- `english_words_quality_report.json` — suspicious words, unknown labels, and
  summary statistics from the cleanup.
- `pos_identifiers_report.json` — audit of all unique source POS labels.
