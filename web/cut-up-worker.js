const POS = [
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
];

const POS_INDEX = Object.fromEntries(POS.map((name, index) => [name, index]));
const CONTENT_MASK =
  (1 << POS_INDEX.noun) |
  (1 << POS_INDEX.verb) |
  (1 << POS_INDEX.adjective) |
  (1 << POS_INDEX.adverb);
const NOUN_ADJ_MASK = (1 << POS_INDEX.noun) | (1 << POS_INDEX.adjective);

const WORD_PATTERN = /[\p{L}\p{M}]+(?:['\u2019\-][\p{L}\p{M}]+)*/gu;
const TOKEN_PATTERN =
  /[\p{L}\p{M}]+(?:['\u2019\-][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu;

const FUNCTION_WORD_INDEX = new Map([
  ...["a", "an", "the"].map((word) => [word, "article"]),
  ...[
    "i",
    "me",
    "my",
    "mine",
    "myself",
    "you",
    "your",
    "yours",
    "yourself",
    "he",
    "him",
    "his",
    "himself",
    "she",
    "her",
    "hers",
    "herself",
    "it",
    "its",
    "itself",
    "we",
    "us",
    "our",
    "ours",
    "ourselves",
    "they",
    "them",
    "their",
    "theirs",
    "themselves",
    "who",
    "whom",
    "whose",
    "which",
    "that",
    "this",
    "these",
    "those",
  ].map((word) => [word, "pronoun"]),
  ...[
    "about",
    "above",
    "across",
    "after",
    "against",
    "along",
    "among",
    "around",
    "at",
    "before",
    "behind",
    "below",
    "beneath",
    "beside",
    "between",
    "beyond",
    "by",
    "despite",
    "down",
    "during",
    "except",
    "for",
    "from",
    "in",
    "inside",
    "into",
    "near",
    "of",
    "off",
    "on",
    "onto",
    "out",
    "outside",
    "over",
    "past",
    "through",
    "to",
    "toward",
    "under",
    "until",
    "up",
    "upon",
    "with",
    "within",
    "without",
  ].map((word) => [word, "preposition"]),
  ...[
    "and",
    "but",
    "or",
    "nor",
    "for",
    "yet",
    "so",
    "although",
    "because",
    "if",
    "since",
    "unless",
    "until",
    "when",
    "where",
    "while",
  ].map((word) => [word, "conjunction"]),
  ...["ah", "alas", "hey", "oh", "ouch", "wow"].map((word) => [
    word,
    "interjection",
  ]),
  ...[
    "all",
    "another",
    "any",
    "both",
    "each",
    "either",
    "every",
    "few",
    "many",
    "more",
    "most",
    "much",
    "neither",
    "no",
    "other",
    "several",
    "some",
    "such",
  ].map((word) => [word, "determiner"]),
]);

const NEXT_PREFERRED = {
  start: ["pronoun", "article", "noun", "adjective", "adverb", "interjection"],
  article: ["adjective", "noun", "adverb"],
  pronoun: ["verb", "noun", "adjective", "adverb"],
  adjective: ["noun", "adjective"],
  noun: ["noun", "verb", "preposition", "conjunction", "adverb"],
  verb: ["adverb", "article", "noun", "adjective", "preposition", "pronoun"],
  adverb: ["verb", "adjective", "adverb", "preposition"],
  preposition: ["article", "pronoun", "adjective", "noun"],
  conjunction: ["pronoun", "article", "verb", "noun", "adjective", "adverb"],
  interjection: ["pronoun", "article", "noun"],
};

const POSSESSIVE_PREFERRED = ["noun", "adjective", "pronoun", "adverb"];
const AUXILIARY_PREFERRED = ["adjective", "adverb", "verb", "noun"];

const POSSESSIVE_PRONOUNS = new Set([
  "my",
  "your",
  "yours",
  "his",
  "her",
  "hers",
  "its",
  "our",
  "ours",
  "their",
  "theirs",
]);

const AUXILIARY_VERBS = new Set([
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "may",
  "might",
  "must",
  "can",
  "could",
]);

const CATEGORY_OVERRIDES = new Map([
  ["family", 1 << POS_INDEX.noun],
  ["people", 1 << POS_INDEX.noun],
  ["police", 1 << POS_INDEX.noun],
  ["data", 1 << POS_INDEX.noun],
  ["news", 1 << POS_INDEX.noun],
  ["works", 1 << POS_INDEX.noun],
  ["means", 1 << POS_INDEX.noun],
  ["series", 1 << POS_INDEX.noun],
  ["species", 1 << POS_INDEX.noun],
  ["clothes", 1 << POS_INDEX.noun],
  ["thanks", 1 << POS_INDEX.noun],
  ["goods", 1 << POS_INDEX.noun],
  ["walk", 1 << POS_INDEX.verb],
  ["open", 1 << POS_INDEX.verb],
  ["find", 1 << POS_INDEX.verb],
  ["finds", 1 << POS_INDEX.verb],
  ["found", 1 << POS_INDEX.verb],
  ["light", 1 << POS_INDEX.noun],
  ["turn", 1 << POS_INDEX.noun],
  ["empty", 1 << POS_INDEX.adjective],
  ["narrow", 1 << POS_INDEX.adjective],
  ["silent", 1 << POS_INDEX.adjective],
  ["tired", 1 << POS_INDEX.adjective],
  ["distant", 1 << POS_INDEX.adjective],
  ["old", 1 << POS_INDEX.adjective],
  ["blue", 1 << POS_INDEX.adjective],
  ["moves", 1 << POS_INDEX.verb],
  ["finds", 1 << POS_INDEX.verb],
  ["hums", 1 << POS_INDEX.verb],
  ["washes", 1 << POS_INDEX.verb],
]);

const COMMON_VERBS = new Set([
  "be", "have", "do", "say", "go", "get", "make", "know", "think", "take",
  "see", "come", "want", "look", "use", "find", "give", "tell", "work", "call",
  "try", "ask", "need", "feel", "become", "leave", "put", "mean", "keep",
  "let", "begin", "seem", "help", "talk", "turn", "start", "show", "hear",
  "play", "run", "move", "live", "believe", "hold", "bring", "happen", "write",
  "sit", "stand", "lose", "pay", "meet", "include", "continue", "set", "learn",
  "change", "lead", "understand", "watch", "follow", "stop", "create", "speak",
  "read", "allow", "add", "spend", "grow", "open", "walk", "win", "offer",
  "remember", "love", "consider", "appear", "buy", "wait", "serve", "die",
  "send", "expect", "build", "stay", "fall", "cut", "reach", "kill", "remain",
  "carry", "hum", "wash", "sleep", "wake",
]);

const SLOT_MASK = Object.fromEntries(
  POS.map((name) => [name, 1 << POS_INDEX[name]]),
);

const SLOT_FALLBACK = {
  noun: ["noun"],
  adjective: ["adjective"],
  verb: ["verb"],
  adverb: ["adverb"],
};

const KEEP_FUNCTION_KINDS = new Set(["article", "determiner"]);
const VOWEL_SOUND = /^(?:[aeiou]|honest|hour|heir|honor)/;

let dictionary = null;
const wordInfoCache = new Map();

function normalizeWord(word) {
  return word.toLowerCase().replaceAll("\u2019", "'");
}

function maskToCategories(mask) {
  const categories = [];
  for (let index = 0; index < POS.length; index += 1) {
    if (mask & (1 << index)) {
      categories.push(POS[index]);
    }
  }
  return categories;
}

function getWordInfo(word) {
  const normalized = normalizeWord(word);
  const cached = wordInfoCache.get(normalized);
  if (cached) {
    return cached;
  }

  let mask;
  const functionKind = FUNCTION_WORD_INDEX.get(normalized) || null;
  if (functionKind) {
    const slot = functionKind === "determiner" ? "adjective" : functionKind;
    mask = 1 << POS_INDEX[slot];
  } else {
    const override = CATEGORY_OVERRIDES.get(normalized);
    if (override !== undefined) {
      mask = override;
    } else {
      const known = dictionary.get(normalized);
      if (known !== undefined) {
        mask = narrowNoisyMask(normalized, known);
      } else {
        mask = guessUnknownMask(normalized);
      }
    }
  }

  const info = {
    normalized,
    mask,
    categories: maskToCategories(mask),
    functionWord: functionKind !== null,
    functionKind,
  };
  wordInfoCache.set(normalized, info);
  return info;
}

function guessUnknownMask(normalized) {
  if (normalized.endsWith("ly")) return 1 << POS_INDEX.adverb;
  if (/(ing|ed|en|ize|ise|ify)$/.test(normalized)) return 1 << POS_INDEX.verb;
  if (/(ous|ful|less|able|ible|ive|al|ic|ish|ary)$/.test(normalized)) {
    return 1 << POS_INDEX.adjective;
  }

  if (normalized.length > 3 && normalized.endsWith("s") && !normalized.endsWith("ss")) {
    const stem = normalized.endsWith("es")
      ? normalized.slice(0, -2)
      : normalized.slice(0, -1);
    if (COMMON_VERBS.has(stem) || CATEGORY_OVERRIDES.get(stem) === SLOT_MASK.verb) {
      return 1 << POS_INDEX.verb;
    }
  }

  return 1 << POS_INDEX.noun;
}

function narrowNoisyMask(normalized, mask) {
  const noun = mask & SLOT_MASK.noun;
  const verb = mask & SLOT_MASK.verb;
  const adjective = mask & SLOT_MASK.adjective;
  const contentCount = Number(Boolean(noun)) + Number(Boolean(verb)) + Number(Boolean(adjective));

  if (/(ing|ed|en|ize|ise|ify)$/.test(normalized) && verb) {
    return SLOT_MASK.verb;
  }
  if (/(ous|ful|less|able|ible|ive|al|ic|ish|ary)$/.test(normalized) && adjective) {
    return SLOT_MASK.adjective;
  }
  if (contentCount >= 3) {
    if (COMMON_VERBS.has(normalized)) return SLOT_MASK.verb;
    return noun || SLOT_MASK.noun;
  }
  if (noun && adjective && !verb) {
    return SLOT_MASK.adjective;
  }
  if (noun && verb && !adjective && !COMMON_VERBS.has(normalized)) {
    return SLOT_MASK.noun;
  }
  return mask;
}

function looksLikeVerb(item) {
  if (!(item.mask & SLOT_MASK.verb)) return false;
  if (COMMON_VERBS.has(item.normalized)) return true;
  if (/(ing|ed|en|ize|ise|ify)$/.test(item.normalized)) return true;
  if (!(item.mask & (SLOT_MASK.noun | SLOT_MASK.adjective))) return true;
  return false;
}

function isProperNoun(word, info) {
  if (info.functionWord) {
    return false;
  }
  const first = word.charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

function slotPreferences(previousSlot, sentenceStart, previousWord) {
  if (sentenceStart) {
    return NEXT_PREFERRED.start;
  }
  const previous = normalizeWord(previousWord);
  if (POSSESSIVE_PRONOUNS.has(previous)) {
    return POSSESSIVE_PREFERRED;
  }
  if (AUXILIARY_VERBS.has(previous)) {
    return AUXILIARY_PREFERRED;
  }
  return NEXT_PREFERRED[previousSlot] || NEXT_PREFERRED.start;
}

function chooseSlot(info, previousSlot, sentenceStart, previousWord) {
  if (info.functionKind) {
    return info.functionKind === "determiner" ? "adjective" : info.functionKind;
  }

  const preferences = slotPreferences(
    previousSlot,
    sentenceStart,
    previousWord,
  );
  for (let index = 0; index < preferences.length; index += 1) {
    const preferred = preferences[index];
    if (info.mask & SLOT_MASK[preferred]) {
      return preferred;
    }
  }

  for (let index = 0; index < POS.length; index += 1) {
    const bit = 1 << index;
    if (info.mask & bit && CONTENT_MASK & bit) {
      return POS[index];
    }
  }

  for (let index = 0; index < POS.length; index += 1) {
    if (info.mask & (1 << index)) {
      return POS[index];
    }
  }

  return "noun";
}

function normalizeInput(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function polishOutput(text) {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])([^\s"'”’)\]])/g, "$1 $2")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/"\s+/g, '"')
    .replace(/\s+"/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isWord(token) {
  WORD_PATTERN.lastIndex = 0;
  return WORD_PATTERN.test(token);
}

function tokenize(text) {
  return text.match(TOKEN_PATTERN) || [];
}

function analyzeReference(text) {
  const tokens = tokenize(text);
  const analyzed = new Array(tokens.length);
  let previousSlot = "start";
  let previousWord = "";
  let sentenceStart = true;

  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index];
    if (!isWord(value)) {
      if (/[.!?]/.test(value)) {
        sentenceStart = true;
        previousSlot = "start";
        previousWord = "";
      }
      analyzed[index] = { type: "separator", value };
      continue;
    }

    const info = getWordInfo(value);
    const slot = chooseSlot(info, previousSlot, sentenceStart, previousWord);
    const properNoun = !sentenceStart && isProperNoun(value, info);

    previousSlot = slot;
    previousWord = value;
    sentenceStart = false;

    analyzed[index] = {
      type: "word",
      value,
      categories: info.categories,
      category: slot,
      slot,
      mask: info.mask,
      functionWord: info.functionWord,
      properNoun,
    };
  }

  return analyzed;
}

function buildScramblePool(text) {
  const words = tokenize(text);
  const pool = [];
  for (let index = 0; index < words.length; index += 1) {
    const value = words[index];
    if (!isWord(value)) continue;
    const info = getWordInfo(value);
    pool.push({
      id: pool.length,
      value,
      normalized: info.normalized,
      mask: info.mask,
      categories: info.categories,
      functionWord: info.functionWord,
      properNoun: isProperNoun(value, info),
    });
  }
  return pool;
}

function buildPoolIndex(pool) {
  const buckets = {
    function: [],
    proper: [],
    noun: [],
    verb: [],
    adjective: [],
    adverb: [],
    nounAdj: [],
  };

  for (let index = 0; index < pool.length; index += 1) {
    const item = pool[index];
    if (item.functionWord) {
      buckets.function.push(index);
      continue;
    }
    if (item.properNoun) {
      buckets.proper.push(index);
      continue;
    }

    const { mask } = item;
    if (mask & SLOT_MASK.noun) buckets.noun.push(index);
    if (mask & SLOT_MASK.verb) buckets.verb.push(index);
    if (mask & SLOT_MASK.adjective) buckets.adjective.push(index);
    if (mask & SLOT_MASK.adverb) buckets.adverb.push(index);
    if (mask & NOUN_ADJ_MASK) buckets.nounAdj.push(index);
  }

  return buckets;
}

function pickFromBucket(bucket, pool, state, accept) {
  const size = bucket.length;
  if (!size) return null;

  const { used, allowReuse, recent } = state;
  const attempts = size < 16 ? size : 16;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const item = pool[bucket[(Math.random() * size) | 0]];
    if (accept && !accept(item)) continue;
    if (!allowReuse && used.has(item.id)) continue;
    if (item.normalized === state.lastWord) continue;
    if (recent.has(item.normalized)) continue;
    return item;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const item = pool[bucket[(Math.random() * size) | 0]];
    if (accept && !accept(item)) continue;
    if (!allowReuse && used.has(item.id)) continue;
    return item;
  }

  return null;
}

function matchCase(word, model) {
  if (model === model.toUpperCase() && model.length > 1) {
    return word.toUpperCase();
  }
  const first = model.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return word.toLowerCase();
}

function articleFor(nextWord) {
  return VOWEL_SOUND.test(normalizeWord(nextWord || "")) ? "an" : "a";
}

function contentBucketNames(slot) {
  const names = [slot];
  const fallback = SLOT_FALLBACK[slot];
  if (fallback) {
    for (let index = 0; index < fallback.length; index += 1) {
      const name = fallback[index];
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

function generate({ scrambleText, referenceText, preserveLines, allowReuse }) {
  const reference = analyzeReference(normalizeInput(referenceText));
  const pool = buildScramblePool(normalizeInput(scrambleText));
  const buckets = buildPoolIndex(pool);
  const used = new Set();
  const recent = new Set();
  const recentQueue = [];

  const state = { used, allowReuse, lastWord: null, recent };

  function remember(word) {
    const normalized = normalizeWord(word);
    state.lastWord = normalized;
    if (recent.has(normalized)) {
      return;
    }
    recent.add(normalized);
    recentQueue.push(normalized);
    if (recentQueue.length > 4) {
      recent.delete(recentQueue.shift());
    }
  }

  function pickItem(item, refToken) {
    if (!allowReuse) {
      used.add(item.id);
    }
    remember(item.value);
    return matchCase(item.value, refToken.value);
  }

  function pickFromBuckets(names, refToken) {
    const accept = refToken.slot === "verb" ? looksLikeVerb : null;
    for (let index = 0; index < names.length; index += 1) {
      const item = pickFromBucket(buckets[names[index]], pool, state, accept);
      if (item) {
        return pickItem(item, refToken);
      }
    }
    return null;
  }

  function takeWord(refToken) {
    if (refToken.functionWord) {
      if (KEEP_FUNCTION_KINDS.has(getWordInfo(refToken.value).functionKind)) {
        remember(refToken.value);
        return refToken.value;
      }
      const bucket = buckets.function;
      const size = bucket.length;
      if (size) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const item = pool[bucket[(Math.random() * size) | 0]];
          if (!(item.mask & refToken.mask)) continue;
          if (!allowReuse && used.has(item.id)) continue;
          return pickItem(item, refToken);
        }
      }
      remember(refToken.value);
      return refToken.value;
    }

    if (refToken.properNoun) {
      const item = pickFromBucket(buckets.proper, pool, state, null);
      if (item) {
        return pickItem(item, refToken);
      }
      remember(refToken.value);
      return refToken.value;
    }

    const picked = pickFromBuckets(contentBucketNames(refToken.slot), refToken);
    if (picked) {
      return picked;
    }

    remember(refToken.value);
    return refToken.value;
  }

  const outputTokens = new Array(reference.length);
  const parts = new Array(reference.length);

  for (let index = 0; index < reference.length; index += 1) {
    const token = reference[index];
    if (token.type === "separator") {
      const value = preserveLines
        ? token.value
        : token.value.replace(/\s+/g, " ");
      outputTokens[index] = { type: "separator", value };
      parts[index] = value;
      continue;
    }

    const value = takeWord(token);
    outputTokens[index] = { type: "word", value, category: token.category };
    parts[index] = value;
  }

  for (let index = 0; index < outputTokens.length; index += 1) {
    const token = outputTokens[index];
    if (token.type !== "word") continue;
    const article = normalizeWord(token.value);
    if (article !== "a" && article !== "an") continue;

    let nextWord = "";
    for (let look = index + 1; look < outputTokens.length; look += 1) {
      if (outputTokens[look].type === "word") {
        nextWord = outputTokens[look].value;
        break;
      }
    }

    const agreed = matchCase(articleFor(nextWord), token.value);
    token.value = agreed;
    parts[index] = agreed;
  }

  return {
    output: polishOutput(parts.join("")),
    outputTokens,
  };
}

async function loadDictionary() {
  const response = await fetch("dictionary.compact.json", {
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`Dictionary request failed (${response.status})`);
  }
  const packed = await response.json();
  const words = packed.w;
  dictionary = new Map();
  for (let index = 0; index < words.length; index += 2) {
    dictionary.set(words[index], words[index + 1]);
  }
  postMessage({ type: "ready", entries: dictionary.size });
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "generate" || !dictionary) return;
  try {
    postMessage({
      type: "result",
      requestId: event.data.requestId,
      ...generate(event.data),
    });
  } catch (error) {
    postMessage({
      type: "error",
      requestId: event.data.requestId,
      message: error.message,
    });
  }
});

loadDictionary().catch((error) => {
  postMessage({ type: "load-error", message: error.message });
});
