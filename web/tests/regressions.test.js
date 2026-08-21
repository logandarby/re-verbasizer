const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  worker, words, tagged, analyze, repair, values, verbAt, fillAndRepair,
} = require("./helpers");

function slotOf(source, normal) {
  const token = tagged(source).find((item) => item.normal === normal);
  assert.ok(token, `missing "${normal}" in: ${source}`);
  return token;
}

describe("lexicon patch keeps function words closed", () => {
  const closed = [
    ["beneath the wall", "beneath", "preposition"],
    ["over the wall", "over", "preposition"],
    ["round the room", "round", "preposition"],
    ["my moth", "my", "possessive"],
    ["their lives", "their", "possessive"],
    ["here we are", "here", "there"],
    ["so they went", "so", "conjunction"],
    ["Give me that", "me", "pronoun"],
    ["Tell them this", "them", "pronoun"],
    ["it can never forget", "never", "negative"],
    ["we can not dedicate", "not", "negative"],
  ];

  for (const [source, word, slot] of closed) {
    it(`tags "${word}" as a closed ${slot}`, () => {
      const token = slotOf(source, word);
      assert.equal(token.slot, slot);
      assert.equal(token.closed, true);
    });
  }
});

describe("retagging", () => {
  it("reads possessed and determined nouns as nouns, not verbs", () => {
    assert.equal(slotOf("their lives", "lives").slot, "noun");
    assert.equal(slotOf("their lives", "lives").plural, true);
    assert.equal(slotOf("the note", "note").slot, "noun");
    assert.equal(slotOf("the proposals", "proposals").slot, "noun");
  });

  it("restores 'round' as a preposition between a verb and an NP", () => {
    const round = slotOf("leaping round the room", "round");
    assert.equal(round.slot, "preposition");
    assert.equal(round.closed, true);
  });

  it("treats attributive gerunds as adjectives", () => {
    assert.equal(slotOf("a resting place", "resting").slot, "adjective");
    assert.equal(slotOf("the running water", "running").slot, "adjective");
    assert.equal(slotOf("living and dead men", "living").slot, "adjective");
  });

  it("retags mid-position adverbs after modals, to, and nor", () => {
    assert.equal(slotOf("They can always remember", "always").slot, "adverb");
    assert.equal(slotOf("to quickly dedicate", "quickly").slot, "adverb");
    assert.equal(verbAt("They can always remember", "remember").form, "infinitive");
    assert.equal(verbAt("to quickly dedicate", "dedicate").form, "infinitive");
  });

  it("treats never as a negative, not the verb governor", () => {
    assert.equal(slotOf("it can never forget", "never").slot, "negative");
    assert.equal(verbAt("it can never forget", "forget").form, "infinitive");
  });
});

describe("subjects that used to go missing or attach to the wrong noun", () => {
  it("skips a prepositional object so the head noun agrees", () => {
    const copula = verbAt("A portion of that field is ready", "is");
    assert.equal(copula.subject.normal, "portion");
    assert.equal(copula.person, "singular");
  });

  it("skips relative who/which and agrees with the antecedent", () => {
    const have = verbAt("The men who struggled here have won", "have");
    assert.equal(have.subject.normal, "men");
    assert.equal(have.person, "plural");
  });

  it("agrees with we in 'what we say', not with what", () => {
    const say = verbAt("what we say", "say");
    assert.equal(say.subject.normal, "we");
    assert.equal(say.person, "plural");
    assert.equal(values(repair("what we say")).join(" "), "What we say");
  });
});

describe("verb forms that used to copy the wrong governor", () => {
  it("does not copy past tense onto a gerund complement", () => {
    assert.equal(verbAt("They went laughing home", "laughing").form, "gerund");
    assert.equal(values(repair("They went laughing home")).join(" "), "They went laughing home");
  });

  it("shares a modal across or as well as and", () => {
    assert.equal(verbAt("we can not dedicate or consecrate this", "consecrate").form, "infinitive");
  });

  it("keeps to be from forcing a participle on the following verb", () => {
    assert.equal(values(repair("to be dedicated")).join(" "), "To be dedicated");
  });
});

describe("lemmas that used to invent junk conjugations", () => {
  it("resolves developed and left to real infinitives, not developeds/lefting", () => {
    assert.equal(worker.verbLemma("developed"), "develop");
    assert.equal(worker.inflectVerb("develop", "gerund"), "developing");
    assert.equal(worker.verbLemma("left"), "leave");
    assert.equal(worker.inflectVerb("leave", "gerund"), "leaving");
    assert.doesNotMatch(worker.inflectVerb("develop", "present", "singular"), /eds$/);
  });

  it("treats positional 'verbs' like proposals as nouns in the pool", () => {
    assert.equal(worker.verbLemma("proposals"), null);
    assert.equal(worker.verbLemma("lives"), null);
    const buckets = worker.buildPool("The proposals surprised us.");
    const verbs = (buckets.verb || []).map((item) => item.lemma);
    const nouns = (buckets.noun || []).map((item) => item.lemma);
    assert.ok(!verbs.includes("proposals"));
    assert.ok(nouns.includes("proposal"));
  });

  it("does not put digits, short scraps, or vowelless abbreviations in the pool", () => {
    const buckets = worker.buildPool("Dr sq lgm 42 wings NASA.");
    const all = Object.values(buckets).flat().map((item) => item.normal);
    assert.ok(!all.includes("sq"));
    assert.ok(!all.includes("lgm"));
    assert.ok(!all.includes("42"));
    assert.ok(!all.includes("dr"));
  });
});

describe("recase uses the replacement's identity, not the reference's", () => {
  it("keeps I and I'll as I, even mid-sentence", () => {
    assert.match(values(repair("we think i am here")).join(" "), / I am /);
    const ill = values(repair("i'll go"));
    assert.match(ill[0], /^I/i);
  });

  it("keeps an acronym replacement in all caps", () => {
    const tokens = fillAndRepair("NASA flies tonight.", "John went home.", true);
    const proper = words(tokens).find((token) => token.slot === "proper");
    assert.equal(proper.value, "NASA");
  });

  it("does not copy an acronym's ALL CAPS onto a plain noun", () => {
    const tokens = fillAndRepair("the wall collapsed yesterday.", "NASA fell down.", true);
    const filled = words(tokens)[0];
    assert.notEqual(filled.value, "NASA");
    assert.notEqual(filled.value, filled.value.toUpperCase());
    assert.match(filled.value, /^[A-Z][a-z]/);
  });
});

describe("fill inflects the hole, not the scramble's original shape", () => {
  it("pluralizes a singular scramble noun into a plural slot", () => {
    const tokens = fillAndRepair("A moth sits.", "The cats sat.", true);
    const noun = words(tokens).find((token) => token.slot === "noun");
    assert.equal(noun.plural, true);
    assert.match(noun.normal, /s$/);
  });

  it("adds a possessive marker when the mold noun is possessive", () => {
    const tokens = fillAndRepair("A moth sits.", "The nation's flag waved.", true);
    const noun = words(tokens).find((token) => token.possessive);
    assert.ok(noun);
    assert.match(noun.normal, /'s$/);
  });
});

describe("normalizeInput", () => {
  it("collapses newlines unless preserveLines is on", () => {
    assert.equal(worker.normalizeInput("a\r\n\r\nb  c", false), "a b c");
    assert.equal(worker.normalizeInput("a\n\n\nb", true), "a\n\nb");
  });
});
