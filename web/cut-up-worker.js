if (typeof importScripts === "function") {
  importScripts("vendor/compromise.js");
} else if (typeof require === "function" && typeof globalThis.nlp !== "function") {
  globalThis.nlp = require("./vendor/compromise.js");
}
const nlp = globalThis.nlp;

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
    round: "Preposition", around: "Preposition",

    aloud: "Adverb", upstairs: "Adverb", downstairs: "Adverb",
    indoors: "Adverb", outdoors: "Adverb",

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
    what: "QuestionWord",
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
const adverbFrameCache = new Map();
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
  retagPossessedNouns(tokens);
  retagMidAdverbs(tokens);
  retagVerbAfterAuxiliary(tokens);
  retagAttributiveGerunds(tokens);
  retagContextualPrepositions(tokens);
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
    const isolated = isolatedTerm(token.normal);
    const gerundish = token.verbForm === "gerund" || isolated?.tags.has("Gerund");
    if (!gerundish) continue;

    const previous = previousWord(tokens, index);
    const nextIndex = nextWordIndex(tokens, index);
    const next = nextIndex === -1 ? null : tokens[nextIndex];
    if (next && /^(?:and|or)$/i.test(next.normal)) {
      const pairedIndex = nextWordIndex(tokens, nextIndex);
      const paired = pairedIndex === -1 ? null : tokens[pairedIndex];
      if (paired?.slot === "adjective") {
        token.slot = "adjective";
        continue;
      }
    }

    if (!previous || (previous.slot !== "determiner" && previous.slot !== "adjective")) continue;
    if (!next || (next.slot !== "noun" && next.slot !== "proper" && next.slot !== "adjective")) continue;
    token.slot = "adjective";
  }
}

// "their lives", "the note": compromise often reads the noun as a verb in isolation.
function retagPossessedNouns(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word" || token.slot !== "verb" || token.closed) continue;
    const previous = previousWord(tokens, index);
    if (!previous || (previous.slot !== "possessive" && previous.slot !== "determiner")) continue;
    const framed = nlp(`the ${token.normal}`);
    const term = framed.document[0]?.[1];
    if (!term?.tags.has("Noun")) continue;
    token.slot = "noun";
    token.plural = term.tags.has("Plural");
    token.closed = !isOpenSlot("noun");
  }
}

// "will little note", "nor long remember": mid-position adverbs get tagged as
// verbs or adjectives, which then steal the real verb's infinitive slot.
function retagMidAdverbs(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word" || token.slot === "adverb" || token.slot === "negative") continue;
    const previous = previousWord(tokens, index);
    const next = nextWord(tokens, index);
    if (!previous) continue;
    const afterAux = previous.slot === "modal" || previous.slot === "auxiliary"
      || previous.slot === "copula" || previous.normal === "to";
    const afterNor = previous.normal === "nor";
    if (!afterAux && !afterNor) continue;
    if (!isMidAdverb(token.normal, next)) continue;
    token.slot = "adverb";
    token.closed = !isOpenSlot("adverb");
  }
}

function isMidAdverb(word, next) {
  const isolated = isolatedTerm(word);
  if (isolated?.tags.has("Adverb")) return true;
  if (adverbFrameTerm(word)?.tags.has("Adverb")) return true;
  // Dual-class adjectives that compromise never lists as adverbs: "will little
  // note", "nor long remember". After a modal they modify the following verb.
  if (!isolated?.tags.has("Adjective") || isolated.tags.has("Verb")) return false;
  return Boolean(next && (next.slot === "verb" || isolatedTerm(next.normal)?.tags.has("Verb")));
}

function adverbFrameTerm(word) {
  const key = word.toLowerCase();
  if (adverbFrameCache.has(key)) return adverbFrameCache.get(key);
  const term = nlp(`they can ${key} go`).document[0]?.[1] || null;
  adverbFrameCache.set(key, term);
  return term;
}

function retagVerbAfterAuxiliary(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word") continue;
    if (token.slot !== "modal" && token.normal !== "to" && !DO_FORMS.test(token.normal)) continue;
    const nextIndex = nextContentIndex(tokens, index, ["negative", "adverb"]);
    if (nextIndex === -1) continue;
    const next = tokens[nextIndex];
    if (next.closed || next.slot === "verb") continue;
    const isolated = isolatedTerm(next.normal);
    if (!isolated?.tags.has("Verb")) continue;
    next.slot = "verb";
    next.verbForm = "infinitive";
    next.closed = !isOpenSlot("verb");
  }
}

// "leaping round the room": lexicon says Preposition, but the sentence
// tagger still reads "round" as a noun. After a verb, before an NP, restore it.
function retagContextualPrepositions(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word" || token.closed || token.slot === "preposition") continue;
    if (!isolatedTerm(token.normal)?.tags.has("Preposition")) continue;
    const previous = previousWord(tokens, index);
    const next = nextWord(tokens, index);
    if (!previous || (previous.slot !== "verb" && previous.slot !== "noun" && previous.slot !== "pronoun")) {
      continue;
    }
    if (!next || (next.slot !== "determiner" && next.slot !== "noun" && next.slot !== "proper"
      && next.slot !== "possessive" && next.slot !== "adjective")) {
      continue;
    }
    token.slot = "preposition";
    token.closed = true;
  }
}

// "leaping round the room": lexicon says Preposition, but the sentence
// tagger still reads "round" as a noun. After a verb, before an NP, restore it.
function retagContextualPrepositions(tokens) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "word" || token.closed || token.slot === "preposition") continue;
    if (!isolatedTerm(token.normal)?.tags.has("Preposition")) continue;
    const previous = previousWord(tokens, index);
    const next = nextWord(tokens, index);
    if (!previous || (previous.slot !== "verb" && previous.slot !== "noun" && previous.slot !== "pronoun")) {
      continue;
    }
    if (!next || (next.slot !== "determiner" && next.slot !== "noun" && next.slot !== "proper"
      && next.slot !== "possessive" && next.slot !== "adjective")) {
      continue;
    }
    token.slot = "preposition";
    token.closed = true;
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
  const lemma = adjectiveLemma(word);
  const key = `${lemma}|${superlative ? "sup" : "comp"}`;
  if (inflectAdjectiveCache.has(key)) return inflectAdjectiveCache.get(key);
  const doc = nlp(lemma);
  if (!doc.adjectives().found) doc.tag("Adjective");
  if (superlative) doc.adjectives().toSuperlative();
  else doc.adjectives().toComparative();
  let text = doc.text().trim() || lemma;
  // v14's conjugate only knows -er/-est. Junk like "significanter" does not
  // re-parse as #Comparative, so fall back to more/most.
  if (!isRealComparison(text, superlative, lemma)) {
    text = `${superlative ? "most" : "more"} ${lemma}`;
  }
  inflectAdjectiveCache.set(key, text);
  return text;
}

function adjectiveLemma(word) {
  const key = String(word || "").toLowerCase().replace(/^(?:more|most)\s+/, "");
  const doc = nlp(key);
  if (!doc.adjectives().found) doc.tag("Adjective");
  return doc.adjectives().conjugate()[0]?.Adjective || key;
}

function isRealComparison(text, superlative, lemma) {
  if (!text) return false;
  if (/^(?:more|most)\s/i.test(text)) return true;
  const doc = nlp(text);
  if (superlative ? doc.has("#Superlative") : doc.has("#Comparative")) return true;
  const models = nlp.model().two.models;
  const irregulars = superlative ? models.toSuperlative.ex : models.toComparative.ex;
  return irregulars?.[lemma.toLowerCase()] === text.toLowerCase();
}

function inflectVerb(lemma, form, person) {
  const forms = conjugateVerb(lemma);
  if (!forms) return lemma;

  if (form === "gerund") return forms.Gerund || lemma;
  if (form === "participle") return participleOf(forms, lemma);
  if (form === "past") return forms.PastTense || lemma;
  if (form === "infinitive" || form === "future") return forms.Infinitive || lemma;
  return person === "singular"
    ? forms.PresentTense || forms.Infinitive || lemma
    : forms.Infinitive || lemma;
}

function participleOf(forms, lemma) {
  if (forms.Participle) return forms.Participle;
  if (/^be$/i.test(lemma)) return "been";
  const past = forms.PastTense;
  const infinitive = forms.Infinitive || lemma;
  if (past && /(?:ed|en)$/i.test(past)) return past;
  if (/^(?:come|become|run)$/i.test(infinitive)) return infinitive;
  return past || infinitive;
}

function previousWord(tokens, index) {
  for (let look = index - 1; look >= 0; look -= 1) {
    if (tokens[look].type === "word") return tokens[look];
  }
  return null;
}

function nextWord(tokens, index) {
  const look = nextWordIndex(tokens, index);
  return look === -1 ? null : tokens[look];
}

function nextWordIndex(tokens, index) {
  for (let look = index + 1; look < tokens.length; look += 1) {
    const token = tokens[look];
    if (token.type === "word") return look;
    if (/[.!?]/.test(token.value)) return -1;
  }
  return -1;
}

function nextContentIndex(tokens, index, skipSlots) {
  const skip = skipSlots || [];
  for (let look = index + 1; look < tokens.length; look += 1) {
    const token = tokens[look];
    if (token.type !== "word") {
      if (/[.!?]/.test(token.value)) return -1;
      continue;
    }
    if (skip.includes(token.slot)) continue;
    return look;
  }
  return -1;
}

function previousGovernor(tokens, index) {
  for (let look = index - 1; look >= 0; look -= 1) {
    const token = tokens[look];
    if (token.type !== "word") {
      if (/[.!?]/.test(token.value)) return null;
      continue;
    }
    if (token.slot === "negative" || token.slot === "adverb") continue;
    return token;
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
// "is spread", "has spread", "of spreading". Negatives and mid-position
// adverbs sit between the governor and the verb: "can not dedicate",
// "can never forget", "will little note". Coordinated verbs share a
// governor across and/or/nor, even with a phrase in between: "walked
// across the room, and put". Do not copy tense onto a gerund complement
// ("went laughing", "said, arranging").
function contextualVerbForm(tokens, index, fallbackForm) {
  let sawCoordinator = false;

  for (let look = index - 1; look >= 0; look -= 1) {
    const token = tokens[look];
    if (token.type !== "word") {
      if (/[.!?]/.test(token.value)) break;
      continue;
    }
    if (token.normal === "to" || token.slot === "modal") return "infinitive";
    if (token.slot === "negative" || token.slot === "adverb") continue;
    if (token.slot === "copula" && !/^(?:be|being)$/i.test(token.normal)) {
      return "participle";
    }
    if (token.slot === "auxiliary") {
      if (HAVE_FORMS.test(token.normal)) return "participle";
      if (DO_FORMS.test(token.normal)) return "infinitive";
    }
    if (token.slot === "conjunction" && /^(?:and|or|nor)$/i.test(token.normal)) {
      sawCoordinator = true;
      continue;
    }
    if (token.slot === "preposition") {
      if (sawCoordinator) continue;
      return "gerund";
    }
    if (token.slot === "verb") {
      if (sawCoordinator) return contextualVerbForm(tokens, look, token.verbForm || fallbackForm);
      return fallbackForm;
    }
    if (sawCoordinator && isCoordSkip(token)) continue;
    return fallbackForm;
  }
  return fallbackForm;
}

function isCoordSkip(token) {
  return token.slot === "noun" || token.slot === "proper" || token.slot === "determiner"
    || token.slot === "adjective" || token.slot === "possessive" || token.slot === "particle"
    || token.slot === "pronoun" || token.slot === "there";
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
// to leave the agreement code with no subject at all. Walk backward from the
// verb so "what we say" agrees with "we", not the first noun in the sentence.
function subjectToken(tokens, verbIndex, seen) {
  const visiting = seen || new Set();
  if (visiting.has(verbIndex)) return null;
  visiting.add(verbIndex);
  const start = sentenceStartIndex(tokens, verbIndex);
  let skippedRelative = false;

  for (let index = verbIndex - 1; index >= start; index -= 1) {
    const token = tokens[index];
    if (token.type !== "word") continue;

    if (token.slot === "verb") {
      return subjectToken(tokens, index, visiting);
    }

    if (token.slot === "question" && /^(?:who|which)$/i.test(token.normal)) {
      skippedRelative = true;
      continue;
    }

    if (!isNominal(token)) continue;
    if (!skippedRelative && token.slot !== "pronoun" && governedByPreposition(tokens, index, start)) continue;
    return token;
  }

  return null;
}

function isNominal(token) {
  if (token.slot === "pronoun" || token.slot === "noun" || token.slot === "proper") return true;
  return token.slot === "determiner" && /^(?:these|those)$/i.test(token.normal);
}

function governedByPreposition(tokens, nounIndex, start) {
  for (let look = nounIndex - 1; look >= start; look -= 1) {
    const token = tokens[look];
    if (token.type !== "word") continue;
    if (token.slot === "adjective" || token.slot === "determiner"
      || token.slot === "possessive" || token.slot === "adverb") {
      continue;
    }
    return token.slot === "preposition";
  }
  return false;
}

function personOf(token) {
  if (!token) return "singular";
  if (token.normal === "i") return "I";
  if (PLURAL_PRONOUNS.has(token.normal)) return "plural";
  return token.plural ? "plural" : "singular";
}

function finiteTense(token) {
  if (/^(?:did|had|was|were)$/i.test(token.normal)) return "past";
  return token.verbForm === "past" ? "past" : "present";
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
      const previous = previousGovernor(repaired, index);
      const finite = !previous || (previous.normal !== "to" && previous.slot !== "modal");

      if (!finite) {
        if (BE_FORMS.test(token.normal)) setWord(token, "be");
        else if (HAVE_FORMS.test(token.normal)) setWord(token, "have");
        else if (DO_FORMS.test(token.normal)) setWord(token, "do");
        continue;
      }

      if (/^(?:been|being|having|doing|done)$/i.test(token.normal)) continue;

      const person = personOf(subjectToken(repaired, index));
      const tense = finiteTense(token);
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
  module.exports = {
    generate, verbLemma, conjugateVerb, buildPool, analyze, normalizeInput,
    repairTokens, inflectAdjective, inflectVerb, fillDraft, subjectToken,
    contextualVerbForm, personOf,
  };
}
