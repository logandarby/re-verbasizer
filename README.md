# The Re-verbasizer

A cut-up writing tool inspired by William S. Burroughs and by David Bowie's
Verbasizer. Paste (or load) a scramble text and a reference text, then
Generate. The page keeps the reference's grammar and fills it with words
from the scramble.

Tagging and verb-form repair use
[compromise](https://github.com/spencermountain/compromise), vendored in
`web/vendor/`. Independent of [verbasizer.com](https://verbasizer.com).

## How it works

Generation runs in `web/cut-up-worker.js` so the page stays responsive.

The **reference** is the mold: its word order, punctuation, and function
words stay put. The **scramble** is the word bank. Compromise tags both
texts, with a small lexicon patch so words like *beneath*, *over*, and
*my* count as function words instead of content.

Closed-class tokens (determiners, prepositions, pronouns, auxiliaries,
conjunctions, and similar) are copied through unchanged. Open-class
tokens (nouns, verbs, adjectives, adverbs, proper names) become slots.
The scramble is bucketed by those same slots, lemmatized, and filtered
so abbreviations, digits, and vowelless fragments do not enter the pool.

Each slot is filled from a matching bucket, then inflected to fit the
hole: plural or possessive nouns, comparative adjectives, verb tense and
subject agreement, *a* / *an* / *the*. The worker tries eight drafts,
scores them for local grammar (rewarding determiner–adjective–noun
stretches, penalizing stacked prepositions and *a* before a plural), and
returns the highest-scoring one.

## Run locally

Python 3, from the project root:

```bash
python3 web/serve.py
```

Then open <http://127.0.0.1:8000/>. Pass a port if 8000 is taken
(`python3 web/serve.py 8080`). The page cannot be opened as a `file://`
URL; the worker and catalog fetch need HTTP.

`web/serve.py` is a static file server plus proxies for Project Gutenberg,
Wikipedia, and Wikisource. Gutenberg **requires** that proxy: it pulls
small byte ranges from the book instead of downloading the whole file.
Wikipedia and Wikisource use the proxy when it is up, and fall back to
the public APIs if you serve the page some other way.

## Source library

The **Load text excerpts** panel fills the scramble and reference fields
from a curated catalog (`web/text-catalog.json`). It loads excerpts only,
never a whole book. You can load scramble, reference, or both, or use
**Surprise me** to pick a random work in the current category.

Excerpts are trimmed to about 120 reference words or 3,500 scramble
words. Each load picks a fresh slice, so repeating the same title still
varies.

- **Wikipedia** — article extracts, grouped as Nature & Science, History
  & Places, Arts & Culture, and Technology. CC BY-SA 4.0.
- **Project Gutenberg** — public-domain books from the 1900–1930 window,
  grouped by genre (novels, mystery, horror, science fiction, adventure,
  poetry, essays). Joyce, Woolf, Christie, Lovecraft, Frost, Du Bois, and
  others. Needs `python3 web/serve.py`.
- **Wikisource** — poems, speeches, and essays. Short pieces may fill
  both fields from the same text.

Turn on **Preserve line breaks** if you are cutting poetry.

To add a title, append a work in `web/text-catalog.json` and make sure
its `category` exists under that library. Wikipedia and Wikisource use a
page title; Gutenberg uses an ebook id:

```json
{
  "id": "wp-jazz",
  "library": "wikipedia",
  "category": "culture",
  "page": "Jazz",
  "title": "Jazz",
  "author": "Wikipedia"
}
```

```json
{
  "id": "g-64317",
  "library": "gutenberg",
  "category": "novels",
  "gutenbergId": 64317,
  "title": "The Great Gatsby",
  "author": "F. Scott Fitzgerald"
}
```
