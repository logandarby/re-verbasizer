# The Verbasizer

A dependency-free static page that rebuilds a scramble text using the
part-of-speech structure of a reference text.

## Run locally

Use the bundled server so Gutenberg excerpts can be fetched efficiently via
range requests (plain `python3 -m http.server` does not include that proxy):

```bash
python3 web/serve.py
```

Then open <http://127.0.0.1:8000/>. The page cannot be opened directly with
a `file://` URL because browsers do not allow web workers to fetch local files.

### Public-domain library

The source panel loads **excerpts only**, not whole books:

- **Wikipedia** — plain-text article extracts via the local server proxy (or
  directly from Wikipedia when no proxy is available). CC BY-SA 4.0.
- **Project Gutenberg** — the local proxy requests small byte ranges (~20–50 KB
  total) and trims to about 500 reference words or 3,500 scramble words.
  Includes a **Modern Classics (1900–1930)** category (Fitzgerald, Hemingway,
  Joyce, Woolf, and others).
- **Wikisource** — the browser fetches one page directly (poems, speeches,
  essays). Works well for reference text; shorter pieces may reuse the same
  text for both fields.

Curated titles live in `web/text-catalog.json`. Add entries there to expand
the picker.

## Refresh the browser dictionary

After regenerating `data/english_words_lookup.json`, rebuild the compact copy:

```bash
python3 web/build_dictionary.py
```

The source dictionary represents parts of speech as repeated strings. The build
script replaces those arrays with bitmasks and removes formatting, reducing the
browser download from roughly 3.8 MB to 1.5 MB. A web worker downloads, parses,
and queries the data off the main thread, and normal browser caching avoids
downloading it again on later visits.
