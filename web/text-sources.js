const WORD_PATTERN = /[\p{L}\p{M}]+(?:['\u2019\-][\p{L}\p{M}]+)*/gu;
const SENTENCE_BOUNDARY = /[.!?]["'”’]?(?:\s+|\n+)/g;

const LIMITS = {
  reference: 120,
  scramble: 3500,
};

const WIKISOURCE_API = "https://en.wikisource.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";

export async function loadCatalog() {
  const response = await fetch("text-catalog.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Could not load the text catalog.");
  }
  return response.json();
}

export function listCategories(catalog, library) {
  return catalog.categories[library] || [];
}

export function listWorks(catalog, library, categoryId) {
  return catalog.works.filter(
    (work) => work.library === library && work.category === categoryId,
  );
}

export function pickRandomWork(catalog, library, categoryId) {
  const works = listWorks(catalog, library, categoryId);
  if (!works.length) {
    throw new Error("No works available for this category.");
  }
  return works[Math.floor(Math.random() * works.length)];
}

export async function fetchExcerpts(work, parts) {
  const requested = normalizeParts(parts);
  if (work.library === "gutenberg") {
    return fetchGutenbergExcerpts(work, requested);
  }
  if (work.library === "wikisource") {
    return fetchWikisourceExcerpts(work, requested);
  }
  if (work.library === "wikipedia") {
    return fetchWikipediaExcerpts(work, requested);
  }
  throw new Error(`Unknown library: ${work.library}`);
}

function normalizeParts(parts) {
  if (parts === "both") {
    return new Set(["reference", "scramble"]);
  }
  return new Set([parts]);
}

async function fetchGutenbergExcerpts(work, parts) {
  const query = [...parts].join(",");
  const response = await fetch(
    `/api/gutenberg/${work.gutenbergId}?parts=${query}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(await readError(response, `Gutenberg excerpt failed (${response.status})`));
  }
  const payload = await response.json();
  return {
    reference: normalizeProse(payload.reference || ""),
    scramble: normalizeProse(payload.scramble || ""),
    meta: formatMeta(work),
  };
}

async function fetchWikisourceExcerpts(work, parts) {
  const plainText = await fetchWikisourcePlainText(work.page);
  return buildMediaWikiExcerpts(plainText, parts, work);
}

async function fetchWikipediaExcerpts(work, parts) {
  const plainText = await fetchWikipediaPlainText(work.page);
  return buildMediaWikiExcerpts(plainText, parts, work);
}

function buildMediaWikiExcerpts(plainText, parts, work) {
  const normalized = normalizeProse(plainText);
  const reference = parts.has("reference")
    ? pickRandomSentenceSlice(normalized, LIMITS.reference)
    : "";
  const scramble = parts.has("scramble")
    ? pickRandomWordSlice(normalized, LIMITS.scramble, reference)
    : "";

  return {
    reference: normalizeProse(reference),
    scramble: normalizeProse(scramble),
    meta: formatMeta(work),
  };
}

async function fetchWikisourcePlainText(pageTitle) {
  const proxyText = await fetchWikisourceViaProxy(pageTitle);
  if (proxyText !== null) {
    return proxyText;
  }
  return fetchWikisourceDirect(pageTitle);
}

async function fetchWikisourceViaProxy(pageTitle) {
  try {
    const response = await fetch(
      `/api/wikisource?title=${encodeURIComponent(pageTitle)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (typeof payload.extract !== "string" || !payload.extract.trim()) {
      return null;
    }
    return normalizeProse(payload.extract);
  } catch {
    return null;
  }
}

async function fetchWikisourceDirect(pageTitle) {
  const url = new URL(WIKISOURCE_API);
  url.searchParams.set("action", "parse");
  url.searchParams.set("page", pageTitle);
  url.searchParams.set("prop", "text");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("disabletoc", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Wikisource request failed.");
  }

  const payload = await response.json();
  if (payload.error) {
    throw new Error(
      payload.error.info || `Wikisource page not found: ${pageTitle}`,
    );
  }

  const html = payload.parse?.text?.["*"] || "";
  const plainText = htmlToPlainText(html);
  if (!plainText.trim()) {
    throw new Error(`Wikisource returned no text for: ${pageTitle}`);
  }
  return plainText;
}

async function fetchWikipediaPlainText(pageTitle) {
  const proxyText = await fetchWikipediaViaProxy(pageTitle);
  if (proxyText !== null) {
    return proxyText;
  }
  return fetchWikipediaDirect(pageTitle);
}

async function fetchWikipediaViaProxy(pageTitle) {
  try {
    const response = await fetch(
      `/api/wikipedia?title=${encodeURIComponent(pageTitle)}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (typeof payload.extract !== "string") {
      return null;
    }
    return cleanWikipediaExtract(payload.extract);
  } catch {
    return null;
  }
}

async function fetchWikipediaDirect(pageTitle) {
  const url = new URL(WIKIPEDIA_API);
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "extracts");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("exsectionformat", "plain");
  url.searchParams.set("redirects", "1");
  url.searchParams.set("titles", pageTitle);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Wikipedia request failed.");
  }

  const payload = await response.json();
  const page = Object.values(payload.query?.pages || {})[0];
  if (!page || page.missing !== undefined) {
    throw new Error(`Wikipedia page not found: ${pageTitle}`);
  }

  const extract = page.extract || "";
  if (!extract.trim()) {
    throw new Error(`Wikipedia returned no text for: ${pageTitle}`);
  }

  return cleanWikipediaExtract(extract);
}

function cleanWikipediaExtract(text) {
  return normalizeProse(text);
}

function normalizeProse(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const WIKISOURCE_DROP_SELECTOR = [
  "style",
  "script",
  "noscript",
  "figure",
  "audio",
  "video",
  ".ws-noexport",
  ".similar",
  ".licensetpl",
  ".mw-editsection",
  ".mw-empty-elt",
  ".ws-pagenum",
  ".wst-pagenum",
  ".pagenum",
  ".thumb",
  ".sister-projects",
  ".mediaContainer",
].join(", ");

function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(WIKISOURCE_DROP_SELECTOR).forEach((node) => node.remove());

  const preferred = [...doc.querySelectorAll(".prp-pages-output, .poem, .wst-poem")]
    .map((node) => normalizeProse(node.textContent || ""))
    .filter((text) => wordCount(text) >= 20)
    .sort((a, b) => b.length - a.length)[0];

  const text = preferred || normalizeProse(doc.body.textContent || "");
  if (wordCount(text) < 15) {
    throw new Error("Wikisource page had no usable text.");
  }
  return text;
}

function looksLikeSentenceStart(text) {
  let stripped = text.trimStart();
  if (!stripped) {
    return false;
  }
  if (/^["'“‘]/.test(stripped)) {
    stripped = stripped.slice(1).trimStart();
  }
  if (!stripped) {
    return false;
  }
  const first = stripped[0];
  return /[A-Z0-9("']/.test(first) || /\p{Lu}/u.test(first);
}

function findSentenceStarts(text) {
  const starts = [];
  if (looksLikeSentenceStart(text)) {
    starts.push(0);
  }

  SENTENCE_BOUNDARY.lastIndex = 0;
  let match = SENTENCE_BOUNDARY.exec(text);
  while (match) {
    const pos = match.index + match[0].length;
    if (looksLikeSentenceStart(text.slice(pos))) {
      starts.push(pos);
    }
    match = SENTENCE_BOUNDARY.exec(text);
  }

  return starts;
}

function pickRandomSentenceSlice(text, limit) {
  const starts = findSentenceStarts(text);
  if (!starts.length) {
    return normalizeProse(trimToWordLimit(text, limit));
  }

  const startPos = starts[Math.floor(Math.random() * starts.length)];
  return normalizeProse(trimToWordLimit(text.slice(startPos), limit));
}

function pickRandomWordSlice(text, limit, avoidText = "") {
  const wordMatches = [...text.matchAll(WORD_PATTERN)];
  if (wordMatches.length <= limit) {
    return text.trim();
  }

  const maxStart = wordMatches.length - limit;
  let startIndex = Math.floor(Math.random() * (maxStart + 1));

  if (avoidText) {
    const avoidStart = text.indexOf(avoidText.slice(0, 40));
    if (avoidStart >= 0) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = wordMatches[startIndex]?.index ?? 0;
        if (Math.abs(candidate - avoidStart) > avoidText.length) {
          break;
        }
        startIndex = Math.floor(Math.random() * (maxStart + 1));
      }
    }
  }

  const sliceStart = wordMatches[startIndex].index;
  const lastMatch = wordMatches[startIndex + limit - 1];
  const sliceEnd = lastMatch.index + lastMatch[0].length;
  const trimmed = normalizeProse(text.slice(sliceStart, sliceEnd));
  return /[.!?"']$/.test(trimmed) ? trimmed : `${trimmed}...`;
}

function trimToWordLimit(text, limit) {
  const words = text.match(WORD_PATTERN) || [];
  if (words.length <= limit) {
    return trimToSentenceEnd(normalizeProse(text));
  }

  let seen = 0;
  let cutIndex = text.length;
  WORD_PATTERN.lastIndex = 0;
  let match = WORD_PATTERN.exec(text);
  while (match) {
    seen += 1;
    if (seen === limit) {
      cutIndex = match.index + match[0].length;
      break;
    }
    match = WORD_PATTERN.exec(text);
  }

  const trimmed = normalizeProse(text.slice(0, cutIndex));
  return trimToSentenceEnd(trimmed);
}

function trimToSentenceEnd(text) {
  const trimmed = text.trim();
  if (!trimmed || /[.!?]"?$/.test(trimmed)) {
    return trimmed;
  }

  const boundaries = [...trimmed.matchAll(/[.!?]["'”’]?(?=\s|$)/g)];
  if (!boundaries.length) {
    return /[.!?"']$/.test(trimmed) ? trimmed : `${trimmed}...`;
  }

  const last = boundaries[boundaries.length - 1];
  const end = last.index + last[0].length;
  if (end >= trimmed.length * 0.55) {
    return trimmed.slice(0, end).trim();
  }

  return /[.!?"']$/.test(trimmed) ? trimmed : `${trimmed}...`;
}

function formatMeta(work) {
  return `${work.title} — ${work.author}`;
}

async function readError(response, fallback) {
  try {
    const payload = await response.json();
    if (payload?.error) {
      return payload.error;
    }
  } catch {
    // Ignore JSON parse failures.
  }
  return fallback;
}

export function wordCount(text) {
  return text.match(WORD_PATTERN)?.length || 0;
}
