# The Re-verbasizer

Write a speech that sounds like the Gettysburg Address, but with all the
words from a Robert Frost poem.

The Re-verbasizer is a cut-up writing tool inspired by David Bowie's
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

From `web/`:

```bash
python3 -m http.server 8000
```

Then open <http://127.0.0.1:8000/>. The page cannot be opened as a
`file://` URL; the worker and catalog fetch need HTTP.

Wikipedia and Wikisource load through their public APIs with MediaWiki
CORS (`origin=*`). Gutenberg texts are stored under `web/texts/gutenberg/`
so the browser can read them same-origin; gutenberg.org does not send
CORS headers.

## Source library

The **Load text excerpts** panel fills the scramble and reference fields
from a curated catalog (`web/text-catalog.json`). It loads excerpts only,
never a whole book. You can load scramble, reference, or both, or use
**Surprise me** to pick a random work in the current category.

Excerpts are trimmed to about 120 reference words or 3,500 scramble
words. Each load picks a fresh slice, so repeating the same title still
varies.

- **Wikipedia** — article extracts, grouped as Nature, Space, Places, Art,
  and Machines. CC BY-SA 4.0.
- **Project Gutenberg** — public-domain books, grouped by genre
  (novels, mystery, horror, science fiction, adventure, poetry, essays).
  Joyce, Stein, Toomer, Machen, Du Bois, and others. Served from
  `web/texts/gutenberg/`. After adding a Gutenberg id to the catalog,
  run `python3 scripts/fetch_gutenberg_texts.py`.
- **Wikisource** — longer poems (*The Raven*, *Goblin Market*, Prufrock),
  speeches, and well-known essays (Self-Reliance, Civil Disobedience,
  A Modest Proposal). License chrome is stripped from the page text.

Turn on **Preserve line breaks** if you are cutting poetry.

To add a title, append a work in `web/text-catalog.json` and make sure
its `category` exists under that library. Wikipedia and Wikisource use a
page title; Gutenberg uses an ebook id:

```json
{
  "id": "wp-cutup",
  "library": "wikipedia",
  "category": "culture",
  "page": "Cut-up technique",
  "title": "Cut-up technique",
  "author": "Wikipedia"
}
```

```json
{
  "id": "g-15396",
  "library": "gutenberg",
  "category": "novels",
  "gutenbergId": 15396,
  "title": "Tender Buttons",
  "author": "Gertrude Stein"
}
```

## GitHub Pages

Push to `gh-pages` to deploy `web/` at
<https://logandarby.github.io/re-verbasizer/>.
