if (typeof importScripts === "function") {
  importScripts("vendor/compromise.js");
} else if (typeof require === "function" && typeof globalThis.nlp !== "function") {
  globalThis.nlp = require("./vendor/compromise.js");
}

// Compromise tags a handful of function words as content words ("beneath" and
// "over" as Adjective, "my" as Noun). Patching its lexicon fixes them for every
// downstream step - slots, agreement, and the match-based scoring - instead of
// filtering them out again in each place.
nlp.plugin({
  tags: {
    ObjectPronoun: { isA: "Pronoun" },
    PossessivePronoun: { isA: "Pronoun" },
    Quantifier: { isA: "Determiner" },
  },
  words: {
    above: "Preposition", below: "Preposition", under: "Preposition",
    over: "Preposition", against: "Preposition", behind: "Preposition",
    beyond: "Preposition", beside: "Preposition", besides: "Preposition",
    beneath: "Preposition", underneath: "Preposition", inside: "Preposition",
    outside: "Preposition", atop: "Preposition", amid: "Preposition",
    amongst: "Preposition", unlike: "Preposition", despite: "Preposition",

    all: "Quantifier", no: "Quantifier", more: "Quantifier", less: "Quantifier",
    most: "Quantifier", many: "Quantifier", much: "Quantifier", few: "Quantifier",
    several: "Quantifier", such: "Quantifier",

    me: "ObjectPronoun", him: "ObjectPronoun", them: "ObjectPronoun",
    us: "ObjectPronoun",

    my: "PossessivePronoun", your: "PossessivePronoun", his: "PossessivePronoun",
    her: "PossessivePronoun", its: "PossessivePronoun", our: "PossessivePronoun",
    their: "PossessivePronoun", mine: "PossessivePronoun", yours: "PossessivePronoun",
    hers: "PossessivePronoun", ours: "PossessivePronoun", theirs: "PossessivePronoun",

    be: "Copula", been: "Copula", being: "Copula",
    have: "Auxiliary", has: "Auxiliary", had: "Auxiliary", having: "Auxiliary",
    do: "Auxiliary", does: "Auxiliary", did: "Auxiliary", doing: "Auxiliary",
    done: "Auxiliary",

    here: "There", there: "There", so: "Conjunction",
  },
});

const DRAFTS = 8;
const OPEN_SLOTS = new Set(["noun", "verb", "adjective", "adverb", "proper"]);
const SLOT_FALLBACKS = {
  verb: ["verb"],
  noun: ["noun", "proper"],
  proper: ["proper", "noun"],
  adjective: ["adjective"],
  adverb: ["adverb"],
};
const BE_FORMS = /^(?:am|is|are|was|were|be|been|being)$/i;
const HAVE_FORMS = /^(?:have|has|had|having)$/i;
const DO_FORMS = /^(?:do|does|did|doing)$/i;
const BE_TABLE = {
  present: { I: "am", singular: "is", plural: "are" },
  past: { I: "was", singular: "was", plural: "were" },
};
const PLURAL_PRONOUNS = new Set(["we", "they", "you", "these", "those"]);
const isolatedCache = new Map();
const verbLemmaCache = new Map();
const conjugateCache = new Map();
const nounLemmaCache = new Map();
const inflectNounCache = new Map();
const inflectAdjectiveCache = new Map();
let analyzeCache = { scramble: "", reference: "", preserveLines: false, tokens: null, buckets: null };

function normalizeInput(text, preserveLines) {
  let cleaned = text.replace(/\r\n?/g, "\n");
  if (preserveLines) {
    return cleaned.replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  return cleaned
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasTag(tags, name) {
  return tags.has(name);
}

function slotFromTags(tags) {
  if (hasTag(tags, "Value") || hasTag(tags, "NumericValue") || hasTag(tags, "Year")) {
    return "value";
  }
  if (hasTag(tags, "Reflexive")) return "reflexive";
  if (hasTag(tags, "PossessivePronoun")) return "possessive";
  if (hasTag(tags, "Possessive") && hasTag(tags, "Pronoun")) return "possessive";
  if (hasTag(tags, "Pronoun")) return "pronoun";
  if (hasTag(tags, "Determiner")) return "determiner";
  if (hasTag(tags, "QuestionWord")) return "question";
  if (hasTag(tags, "There")) return "there";
  if (hasTag(tags, "Conjunction") || hasTag(tags, "Condition")) return "conjunction";
  if (hasTag(tags, "Preposition")) return "preposition";
  if (hasTag(tags, "Negative")) return "negative";
  if (hasTag(tags, "Modal")) return "modal";
  if (hasTag(tags, "Auxiliary")) return "auxiliary";
  if (hasTag(tags, "Copula")) return "copula";
  if (hasTag(tags, "Particle")) return "particle";
  if (hasTag(tags, "Adverb")) return "adverb";
  if (hasTag(tags, "Adjective")) return "adjective";
  if (hasTag(tags, "Verb") || hasTag(tags, "Gerund")) return "verb";
  if (hasTag(tags, "ProperNoun") || hasTag(tags, "Person")) return "proper";
  return "noun";
}

function verbFormFromTags(tags) {
  if (hasTag(tags, "Gerund")) return "gerund";
  if (hasTag(tags, "Participle")) return "participle";
  if (hasTag(tags, "PastTense")) return "past";
  if (hasTag(tags, "FutureTense")) return "future";
  return "present";
}

function isOpenSlot(slot) {
  return OPEN_SLOTS.has(slot);
}

function analyze(text) {
  const tokens = [];

  for (const sentence of nlp(text).document) {
    for (const term of sentence) {
      if (term.pre) tokens.push({ type: "separator", value: term.pre });
      const slot = slotFromTags(term.tags);
      tokens.push({
        type: "word",
        value: term.text,
        normal: term.normal,
        slot,
        closed: !isOpenSlot(slot),
        plural: term.tags.has("Plural"),
        possessive: term.tags.has("Possessive") && !term.tags.has("Pronoun"),
        comparative: term.tags.has("Comparative"),
        superlative: term.tags.has("Superlative"),
        verbForm: verbFormFromTags(term.tags),
        acronym: term.tags.has("Acronym"),
        proper: term.tags.has("ProperNoun") || term.tags.has("Person"),
        abbreviation: term.tags.has("Abbreviation"),
      });
      if (term.post) tokens.push({ type: "separator", value: term.post });
    }
  }

  retagMislabelledVerbs(tokens);
  retagAttributiveGerunds(tokens);
  return tokens;
}

function retagMislabelledVerbs(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word" || token.slot !== "noun" || token.closed) continue;
    const previous = previousWord(tokens, index);
    if (!previous || (previous.slot !== "noun" && previous.slot !== "pronoun" && previous.slot !== "proper")) {
      continue;
    }
    const isolated = isolatedTerm(token.normal);
    if (!isolated?.tags.has("Verb") || isolated.tags.has("Noun")) continue;
    token.slot = "verb";
    token.verbForm = verbFormFromTags(isolated.tags);
  }
}

function retagAttributiveGerunds(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word" || token.closed) continue;
    const previous = previousWord(tokens, index);
    const next = nextWord(tokens, index);
    if (!previous || (previous.slot !== "determiner" && previous.slot !== "adjective")) continue;
    if (!next || (next.slot !== "noun" && next.slot !== "proper" && next.slot !== "adjective")) continue;
    const isolated = isolatedTerm(token.normal);
    if (token.verbForm !== "gerund" && !isolated?.tags.has("Gerund")) continue;
    token.slot = "adjective";
  }
}

// Compromise only conjugates words it already reads as verbs. Asking it to
// conjugate an inflected surface form invents junk ("developed" -> "developeds",
// "left" -> "lefting"), so resolve a real infinitive first: read the word in a
// frame where a verb belongs, then confirm that infinitive is a verb on its own.
function isolatedTerm(word) {
  const key = word.toLowerCase();
  if (isolatedCache.has(key)) return isolatedCache.get(key);
  const term = nlp(key).document[0]?.[0] || null;
  isolatedCache.set(key, term);
  return term;
}

function verbLemma(word) {
  const key = word.toLowerCase();
  if (verbLemmaCache.has(key)) return verbLemmaCache.get(key);

  let lemma = null;
  const framed = nlp(`they ${key} it`);
  if (framed.document[0]?.[1]?.tags.has("Verb")) {
    framed.verbs().toInfinitive();
    const candidate = framed.document[0]?.[1]?.normal || "";
    if (candidate && isolatedTerm(candidate)?.tags.has("Verb")) {
      lemma = candidate;
    }
  }

  verbLemmaCache.set(key, lemma);
  return lemma;
}

function conjugateVerb(lemma) {
  if (!lemma) return null;
  const key = lemma.toLowerCase();
  if (conjugateCache.has(key)) return conjugateCache.get(key);

  const forms = nlp(key).verbs().conjugate()[0] || null;
  conjugateCache.set(key, forms);
  return forms;
}

function nounLemma(word) {
  const key = word.toLowerCase();
  if (nounLemmaCache.has(key)) return nounLemmaCache.get(key);
  const doc = nlp(key);
  if (!doc.nouns().found) doc.tag("Noun");
  doc.nouns().toSingular();
  const lemma = (doc.text().trim() || key).replace(/['’]s$/i, "");
  nounLemmaCache.set(key, lemma);
  return lemma;
}

// Source excerpts carry fragments from citations and abbreviations ("sq",
// "lgm"). Shape plus compromise's own #Abbreviation tag keeps them out.
function isPoolWorthy(token) {
  const normal = token.normal || "";
  if (token.abbreviation) return false;
  if (/\d/.test(normal)) return false;
  if (normal.length < 3) return false;
  if (!/[aeiouy]/.test(normal)) return false;
  return true;
}

function buildPool(text) {
  const buckets = {};

  for (const token of analyze(text)) {
    if (token.type !== "word" || token.closed) continue;
    if (!isPoolWorthy(token)) continue;

    let slot = token.slot;
    let lemma = null;

    if (slot === "verb") {
      lemma = verbLemma(token.normal);
      if (!lemma) {
        // Tagged as a verb by position only ("proposals"); it is really a noun.
        slot = "noun";
      }
    }
    if (slot !== "verb") {
      lemma = slot === "noun" || slot === "proper" ? nounLemma(token.value) : token.normal;
    }

    (buckets[slot] ||= []).push({
      value: token.value,
      normal: token.normal,
      lemma,
      slot,
      plural: token.plural,
      acronym: token.acronym,
      proper: token.proper,
    });
  }

  return buckets;
}

function randomItem(items) {
  return items[(Math.random() * items.length) | 0];
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// The replacement's own identity decides its shape - an acronym stays upper, a
// proper noun stays capitalised - while position decides sentence-initial caps.
// Copying the reference token's case instead turned "wall" into "GULF".
function recase(tokens) {
  let sentenceStart = true;

  for (const token of tokens) {
    if (token.type === "separator") {
      if (/[.!?]/.test(token.value)) sentenceStart = true;
      continue;
    }

    if (token.normal === "i" || /^i['’]/.test(token.normal)) {
      token.value = capitalize(token.normal);
    } else if (token.acronym) {
      token.value = token.normal.toUpperCase();
    } else if (token.proper) {
      token.value = capitalize(token.normal);
    } else {
      token.value = sentenceStart ? capitalize(token.normal) : token.normal;
    }

    sentenceStart = false;
  }

  return tokens;
}

function pickFromBucket(bucket, recent, allowReuse, used) {
  if (!bucket?.length) return null;

  const attempts = Math.min(bucket.length, 16);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const item = randomItem(bucket);
    if (!allowReuse && used.has(item)) continue;
    if (recent.has(item.lemma || item.normal)) continue;
    return item;
  }

  const leftover = bucket.filter((item) => allowReuse || !used.has(item));
  return leftover.length ? randomItem(leftover) : null;
}

function pickForSlot(slot, buckets, recent, allowReuse, used) {
  for (const name of SLOT_FALLBACKS[slot] || [slot]) {
    const item = pickFromBucket(buckets[name], recent, allowReuse, used);
    if (item) return item;
  }
  return null;
}

function inflectNoun(lemma, plural, possessive) {
  const key = `${lemma.toLowerCase()}|${plural ? "p" : "s"}|${possessive ? "poss" : ""}`;
  if (inflectNounCache.has(key)) return inflectNounCache.get(key);
  const doc = nlp(lemma);
  if (!doc.nouns().found) doc.tag("Noun");
  if (plural) doc.nouns().toPlural();
  else doc.nouns().toSingular();
  let text = (doc.text().trim() || lemma).replace(/['’]s$/i, "");
  if (possessive) {
    text = /s$/i.test(text) ? `${text}'` : `${text}'s`;
  }
  inflectNounCache.set(key, text);
  return text;
}

function inflectAdjective(word, comparative, superlative) {
  if (!comparative && !superlative) return word;
  const key = `${word.toLowerCase()}|${superlative ? "sup" : "comp"}`;
  if (inflectAdjectiveCache.has(key)) return inflectAdjectiveCache.get(key);
  const doc = nlp(word);
  if (!doc.adjectives().found) doc.tag("Adjective");
  if (superlative) doc.adjectives().toSuperlative();
  else doc.adjectives().toComparative();
  const text = doc.text().trim() || word;
  inflectAdjectiveCache.set(key, text);
  return text;
}

function inflectVerb(lemma, form, person) {
  const forms = conjugateVerb(lemma);
  if (!forms) return lemma;

  if (form === "gerund") return forms.Gerund || lemma;
  if (form === "participle") return forms.Participle || forms.PastTense || lemma;
  if (form === "past") return forms.PastTense || lemma;
  if (form === "infinitive" || form === "future") return forms.Infinitive || lemma;
  return person === "singular"
    ? forms.PresentTense || forms.Infinitive || lemma
    : forms.Infinitive || lemma;
}

function previousWord(tokens, index) {
  for (let look = index - 1; look >= 0; look -= 1) {
    if (tokens[look].type === "word") return tokens[look];
  }
  return null;
}

function nextWord(tokens, index) {
  for (let look = index + 1; look < tokens.length; look += 1) {
    const token = tokens[look];
    if (token.type === "word") return token;
    if (/[.!?]/.test(token.value)) return null;
  }
  return null;
}

function nextHeadNoun(tokens, index) {
  for (let look = index + 1; look < tokens.length; look += 1) {
    const token = tokens[look];
    if (token.type !== "word") {
      if (/[.!?]/.test(token.value)) return null;
      continue;
    }
    if (token.slot === "noun" || token.slot === "proper") return token;
    if (token.slot === "verb" || token.slot === "copula" || token.slot === "preposition") {
      return null;
    }
  }
  return null;
}

// A verb's shape depends on what precedes it: "to spread", "can spread",
// "is spread", "has spread", "of spreading".
function contextualVerbForm(tokens, index, fallbackForm) {
  const previous = previousWord(tokens, index);
  if (!previous) return fallbackForm;
  if (previous.normal === "to" || previous.slot === "modal") return "infinitive";
  if (previous.slot === "copula" && !/^(?:be|being)$/i.test(previous.normal)) {
    return "participle";
  }
  if (previous.slot === "auxiliary") {
    if (HAVE_FORMS.test(previous.normal)) return "participle";
    if (DO_FORMS.test(previous.normal)) return "infinitive";
  }
  if (previous.slot === "preposition") return "gerund";
  return fallbackForm;
}

function sentenceStartIndex(tokens, index) {
  for (let look = index - 1; look >= 0; look -= 1) {
    if (tokens[look].type !== "word" && /[.!?]/.test(tokens[look].value)) {
      return look + 1;
    }
  }
  return 0;
}

// Read the subject from our own tokens rather than re-parsing the draft as
// text: compromise reads a sentence-initial "Transports" as a verb, which used
// to leave the agreement code with no subject at all.
function subjectToken(tokens, verbIndex) {
  const start = sentenceStartIndex(tokens, verbIndex);
  let candidate = null;

  for (let index = start; index < verbIndex; index += 1) {
    const token = tokens[index];
    if (token.type !== "word") continue;
    if (token.slot === "pronoun" || token.slot === "noun" || token.slot === "proper") {
      return token;
    }
    if (token.slot === "preposition" || token.slot === "conjunction") {
      candidate = null;
      continue;
    }
    if (!candidate && !token.closed) candidate = token;
  }

  return candidate;
}

function personOf(token) {
  if (!token) return "singular";
  if (token.normal === "i") return "I";
  if (PLURAL_PRONOUNS.has(token.normal)) return "plural";
  return token.plural ? "plural" : "singular";
}

function startsWithVowelSound(normal) {
  const word = (normal || "").toLowerCase();
  if (!word) return false;
  if (/^(?:uni|use|eu|ewe|one|once|u(?:ni|[bcdfgjklmnpqrstvwxyz]))/.test(word)) {
    return false;
  }
  if (/^(?:honest|hour|heir|honor|honour)/.test(word)) return true;
  if (/^u[aeiou]/.test(word)) return true;
  return /^[aeiou]/.test(word);
}

function fillDraft(reference, buckets, allowReuse) {
  const used = new Set();
  const recent = new Set();
  const recentQueue = [];
  const output = [];

  function remember(key) {
    if (!key || recent.has(key)) return;
    recent.add(key);
    recentQueue.push(key);
    if (recentQueue.length > 4) recent.delete(recentQueue.shift());
  }

  for (let index = 0; index < reference.length; index += 1) {
    const token = reference[index];
    if (token.type === "separator" || token.closed) {
      output.push({ ...token });
      continue;
    }

    const item = pickForSlot(token.slot, buckets, recent, allowReuse, used);
    if (!item) {
      remember(token.normal);
      output.push({ ...token });
      continue;
    }

    if (!allowReuse) used.add(item);
    remember(item.lemma || item.normal);

    let filled = item.lemma || item.value;
    if (token.slot === "noun" || (token.slot === "proper" && token.plural)) {
      filled = inflectNoun(item.lemma || item.value, token.plural, token.possessive);
    } else if (token.slot === "adjective") {
      filled = inflectAdjective(item.value, token.comparative, token.superlative);
    }
    // Verbs are inflected in repairTokens, once the surrounding tokens exist.

    output.push({
      ...token,
      value: filled,
      normal: filled.toLowerCase(),
      lemma: item.lemma,
      acronym: item.acronym,
      proper: item.proper && token.slot !== "noun",
    });
  }

  return output;
}

function setWord(token, next) {
  if (!next) return;
  token.value = next;
  token.normal = next.toLowerCase();
}

function repairTokens(tokens) {
  const repaired = tokens.map((token) => ({ ...token }));

  for (let index = 0; index < repaired.length; index += 1) {
    const token = repaired[index];
    if (token.type !== "word") continue;

    if (token.slot === "verb") {
      const form = contextualVerbForm(repaired, index, token.verbForm);
      const person = personOf(subjectToken(repaired, index));
      const lemma = token.lemma || verbLemma(token.normal);
      if (lemma) setWord(token, inflectVerb(lemma, form, person));
      token.verbForm = form;
      continue;
    }

    if (token.slot === "copula" || token.slot === "auxiliary") {
      const previous = previousWord(repaired, index);
      const finite = !previous || (previous.normal !== "to" && previous.slot !== "modal");

      if (!finite) {
        if (BE_FORMS.test(token.normal)) setWord(token, "be");
        else if (HAVE_FORMS.test(token.normal)) setWord(token, "have");
        else if (DO_FORMS.test(token.normal)) setWord(token, "do");
        continue;
      }

      if (/^(?:been|being|having|doing|done)$/i.test(token.normal)) continue;

      const person = personOf(subjectToken(repaired, index));
      const tense = token.verbForm === "past" ? "past" : "present";
      if (BE_FORMS.test(token.normal)) {
        setWord(token, BE_TABLE[tense][person] || BE_TABLE[tense].singular);
      } else if (HAVE_FORMS.test(token.normal)) {
        setWord(token, tense === "past" ? "had" : person === "singular" ? "has" : "have");
      } else if (DO_FORMS.test(token.normal)) {
        setWord(token, tense === "past" ? "did" : person === "singular" ? "does" : "do");
      }
    }
  }

  for (let index = 0; index < repaired.length; index += 1) {
    const token = repaired[index];
    if (token.type !== "word") continue;
    if (token.normal !== "a" && token.normal !== "an") continue;

    const next = nextWord(repaired, index);
    if (!next) continue;
    const head = nextHeadNoun(repaired, index);
    setWord(token, head?.plural
      ? "the"
      : startsWithVowelSound(next.normal) ? "an" : "a");
  }

  return recase(repaired);
}

function polish(text) {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])([^\s"'”’)\]])/g, "$1 $2")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function joinTokens(tokens, preserveLines) {
  return tokens.map((token) => {
    if (token.type === "separator") {
      return preserveLines ? token.value : token.value.replace(/\s+/g, " ");
    }
    return token.value;
  }).join("");
}

function tokensToText(tokens, preserveLines) {
  return polish(joinTokens(tokens, preserveLines));
}

function matchCount(doc, pattern) {
  const hits = doc.match(pattern);
  return hits.found ? hits.json().length : 0;
}

function scoreTokens(tokens, preserveLines) {
  let score = 0;
  let last = null;

  for (const token of tokens) {
    if (token.type !== "word") continue;

    if (last) {
      if (token.lemma && token.lemma === last.lemma) score -= 6;
      else if (token.normal === last.normal) score -= 6;

      if (last.slot === "determiner" && (token.slot === "noun" || token.slot === "adjective" || token.slot === "proper")) {
        score += 2;
      }
      if (last.slot === "adjective" && (token.slot === "noun" || token.slot === "proper")) {
        score += 3;
      }
      if (last.slot === "pronoun" && (token.slot === "verb" || token.slot === "copula" || token.slot === "auxiliary")) {
        score += 3;
      }
      if (last.slot === "noun" && (token.slot === "verb" || token.slot === "copula" || token.slot === "auxiliary")) {
        score += 2;
      }
      if (last.slot === "noun" && token.slot === "noun" && !last.possessive) score -= 3;
    }

    last = token;
  }

  const doc = nlp(tokensToText(tokens, preserveLines));
  score += matchCount(doc, "#Determiner (#Adjective|#Adverb)? #Noun") * 2;
  score += matchCount(doc, "#Adjective #Noun") * 2;
  score += matchCount(doc, "#Pronoun #Verb") * 2;
  score -= matchCount(doc, "#Preposition #Preposition") * 8;
  score -= matchCount(doc, "to #Copula") * 8;
  score -= matchCount(doc, "#ObjectPronoun (#Verb|#Copula)") * 8;
  score -= matchCount(doc, "#Modal #Copula") * 8;
  score -= matchCount(doc, "(this|that) #Plural") * 6;
  score -= matchCount(doc, "(these|those) #Singular") * 6;
  score -= matchCount(doc, "(a|an) (#Adjective|#Adverb)? #Plural") * 6;

  return score;
}

function generate({ scrambleText, referenceText, preserveLines, allowReuse }) {
  const scramble = normalizeInput(scrambleText, false);
  const referenceSource = normalizeInput(referenceText, preserveLines);

  if (
    analyzeCache.scramble !== scramble
    || analyzeCache.reference !== referenceSource
    || analyzeCache.preserveLines !== Boolean(preserveLines)
  ) {
    analyzeCache = {
      scramble,
      reference: referenceSource,
      preserveLines: Boolean(preserveLines),
      tokens: analyze(referenceSource),
      buckets: buildPool(scramble),
    };
  }

  const { tokens: reference, buckets } = analyzeCache;

  let best = null;
  let bestScore = -Infinity;

  for (let draft = 0; draft < DRAFTS; draft += 1) {
    const tokens = repairTokens(fillDraft(reference, buckets, allowReuse));
    const score = scoreTokens(tokens, preserveLines);
    if (score > bestScore) {
      bestScore = score;
      best = tokens;
    }
  }

  return {
    output: tokensToText(best, preserveLines),
    outputTokens: best.map((token) => {
      if (token.type === "separator") {
        return {
          type: "separator",
          value: preserveLines ? token.value : token.value.replace(/\s+/g, " "),
        };
      }
      return { type: "word", value: token.value, category: token.slot };
    }),
  };
}

if (typeof importScripts === "function") {
  self.addEventListener("message", (event) => {
    if (event.data?.type !== "generate") return;
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

  postMessage({ type: "ready" });
}

if (typeof module === "object" && module.exports) {
  module.exports = { generate, verbLemma, conjugateVerb, buildPool, analyze, normalizeInput };
}
