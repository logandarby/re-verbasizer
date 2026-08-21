# The Verbasizer

A dependency-free static page that rebuilds a scramble text using the
part-of-speech structure of a reference text.

## Run locally

From the project root, start any static HTTP server:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/web/>. The page cannot be opened directly with
a `file://` URL because browsers do not allow web workers to fetch local files.

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
