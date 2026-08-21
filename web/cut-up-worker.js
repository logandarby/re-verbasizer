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
const WORD_PATTERN = /[\p{L}\p{M}]+(?:['\u2019\-][\p{L}\p{M}]+)*/gu;
const TOKEN_PATTERN = /[\p{L}\p{M}]+(?:['\u2019\-][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu;

const FUNCTION_WORDS = {
  article: new Set(["a", "an", "the"]),
  adjective: new Set(["every"]),
  pronoun: new Set([
    "i", "me", "my", "mine", "myself", "you", "your", "yours", "yourself",
    "he", "him", "his", "himself", "she", "her", "hers", "herself", "it",
    "its", "itself", "we", "us", "our", "ours", "ourselves", "they", "them",
    "their", "theirs", "themselves", "who", "whom", "whose", "which", "that",
    "this", "these", "those", "someone", "something", "anyone", "anything",
  ]),
  preposition: new Set([
    "about", "above", "across", "after", "against", "along", "among", "around",
    "at", "before", "behind", "below", "beneath", "beside", "between", "beyond",
    "by", "despite", "down", "during", "except", "for", "from", "in", "inside",
    "into", "near", "of", "off", "on", "onto", "out", "outside", "over",
    "past", "through", "to", "toward", "under", "until", "up", "upon", "with",
    "within", "without",
  ]),
  conjunction: new Set([
    "and", "but", "or", "nor", "for", "yet", "so", "although", "because",
    "if", "since", "unless", "until", "when", "where", "while",
  ]),
  interjection: new Set(["ah", "alas", "hey", "oh", "ouch", "wow"]),
};

const PRONOUN_ROLES = {
  subject: new Set(["i", "you", "he", "she", "it", "we", "they", "who"]),
  object: new Set(["me", "you", "him", "her", "it", "us", "them", "whom"]),
  possessive: new Set([
    "my", "mine", "your", "yours", "his", "her", "hers", "its", "our", "ours",
    "their", "theirs", "whose",
  ]),
  reflexive: new Set([
    "myself", "yourself", "himself", "herself", "itself", "ourselves",
    "themselves",
  ]),
  demonstrative: new Set(["this", "that", "these", "those", "which"]),
  indefinite: new Set([
    "someone", "something", "anyone", "anything", "everybody", "everyone",
    "everything", "nobody", "nothing",
  ]),
};

const TRANSITION_SCORES = {
  start: {
    article: 7,
    pronoun: 7,
    adjective: 5,
    noun: 5,
    adverb: 4,
    interjection: 4,
  },
  article: { adjective: 9, noun: 8, adverb: 2 },
  pronoun: { verb: 10, adverb: 4, adjective: 2, noun: 1 },
  adjective: { noun: 10, adjective: 4, conjunction: 2 },
  noun: { verb: 8, preposition: 5, conjunction: 4, adverb: 2, noun: 1 },
  verb: {
    adverb: 6,
    article: 6,
    adjective: 5,
    noun: 5,
    preposition: 5,
    pronoun: 3,
  },
  adverb: { verb: 6, adjective: 5, adverb: 3, preposition: 2 },
  preposition: { article: 8, pronoun: 8, adjective: 6, noun: 6 },
  conjunction: { pronoun: 7, article: 7, adjective: 5, noun: 5, adverb: 3 },
  interjection: { pronoun: 4, article: 4, noun: 4, adverb: 3 },
};

let dictionary = null;

function normalizeWord(word) {
  return word.toLocaleLowerCase("en-US").replaceAll("\u2019", "'");
}

function categoryMask(word) {
  const normalized = normalizeWord(word);

  for (const [category, words] of Object.entries(FUNCTION_WORDS)) {
    if (words.has(normalized)) {
      return 1 << POS_INDEX[category];
    }
  }

  const known = dictionary.get(normalized);
  if (known !== undefined) {
    return known;
  }

  if (normalized.endsWith("ly")) return 1 << POS_INDEX.adverb;
  if (/(ing|ed|en|ize|ise|ify)$/.test(normalized)) return 1 << POS_INDEX.verb;
  if (/(ous|ful|less|able|ible|ive|al|ic|ish|ary)$/.test(normalized)) {
    return 1 << POS_INDEX.adjective;
  }
  return 1 << POS_INDEX.noun;
}

function categoriesFor(word) {
  const mask = categoryMask(word);
  return POS.filter((_, index) => mask & (1 << index));
}

function pronounRole(word) {
  const normalized = normalizeWord(word);
  for (const [role, words] of Object.entries(PRONOUN_ROLES)) {
    if (words.has(normalized)) return role;
  }
  return "other";
}

function chooseCategory(word, previousCategory, sentenceStart) {
  const choices = categoriesFor(word);
  if (choices.length === 1) return choices[0];

  const transition = TRANSITION_SCORES[sentenceStart ? "start" : previousCategory]
    || TRANSITION_SCORES.start;
  return choices.reduce((best, category) => {
    const score = transition[category] || 0;
    return score > best.score ? { category, score } : best;
  }, { category: choices[0], score: -1 }).category;
}

function isWord(token) {
  WORD_PATTERN.lastIndex = 0;
  return WORD_PATTERN.test(token);
}

function tokenize(text) {
  return text.match(TOKEN_PATTERN) || [];
}

function analyzeReference(text) {
  let previousCategory = "start";
  let sentenceStart = true;

  return tokenize(text).map((value) => {
    if (!isWord(value)) {
      if (/[.!?]/.test(value)) sentenceStart = true;
      return { type: "separator", value };
    }

    const category = chooseCategory(value, previousCategory, sentenceStart);
    previousCategory = category;
    sentenceStart = false;
    return {
      type: "word",
      value,
      category,
      role: category === "pronoun" ? pronounRole(value) : null,
    };
  });
}

function buildScramblePool(text) {
  return tokenize(text)
    .filter(isWord)
    .map((value, id) => ({
      id,
      value,
      categories: categoriesFor(value),
      pronounRole: pronounRole(value),
    }));
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function matchCase(word, model) {
  if (model === model.toLocaleUpperCase("en-US") && model.length > 1) {
    return word.toLocaleUpperCase("en-US");
  }
  const first = Array.from(model)[0];
  if (first && first === first.toLocaleUpperCase("en-US")) {
    return word.charAt(0).toLocaleUpperCase("en-US") + word.slice(1);
  }
  return word.toLocaleLowerCase("en-US");
}

function generate({ scrambleText, referenceText, preserveLines }) {
  const reference = analyzeReference(referenceText);
  const pool = buildScramblePool(scrambleText);
  const used = new Set();

  function takeWord(category, role) {
    let candidates = role && role !== "other"
      ? pool.filter(
        (item) => !used.has(item.id)
          && item.categories.includes(category)
          && item.pronounRole === role,
      )
      : [];
    if (!candidates.length) {
      candidates = pool.filter(
        (item) => !used.has(item.id) && item.categories.includes(category),
      );
    }
    if (!candidates.length) {
      candidates = pool.filter((item) => !used.has(item.id));
    }
    if (!candidates.length) {
      used.clear();
      candidates = pool.filter((item) => item.categories.includes(category));
    }
    if (!candidates.length) candidates = pool;

    const selected = randomItem(candidates);
    used.add(selected.id);
    return selected.value;
  }

  const outputTokens = reference.map((token) => {
    if (token.type === "separator") {
      return {
        type: "separator",
        value: preserveLines ? token.value : token.value.replace(/\s+/g, " "),
      };
    }
    return {
      type: "word",
      value: matchCase(takeWord(token.category, token.role), token.value),
      category: token.category,
    };
  });

  return {
    output: outputTokens.map((token) => token.value).join(""),
    outputTokens,
  };
}

async function loadDictionary() {
  const response = await fetch("dictionary.compact.json", { cache: "force-cache" });
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
