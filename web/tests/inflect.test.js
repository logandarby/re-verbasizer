const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { worker, values, repair } = require("./helpers");

describe("infinitiveOf", () => {
  const { infinitiveOf } = worker;

  it("maps be/have/do surface forms onto their infinitives", () => {
    for (const word of ["am", "is", "are", "was", "were", "be", "been", "being"]) {
      assert.equal(infinitiveOf(word), "be", word);
    }
    for (const word of ["have", "has", "had", "having"]) {
      assert.equal(infinitiveOf(word), "have", word);
    }
    for (const word of ["do", "does", "did", "doing"]) {
      assert.equal(infinitiveOf(word), "do", word);
    }
  });
});

describe("inflectVerb", () => {
  const { inflectVerb } = worker;

  it("conjugates regular and irregular verbs", () => {
    assert.equal(inflectVerb("walk", "past"), "walked");
    assert.equal(inflectVerb("walk", "present", "singular"), "walks");
    assert.equal(inflectVerb("walk", "present", "plural"), "walk");
    assert.equal(inflectVerb("walk", "gerund"), "walking");
    assert.equal(inflectVerb("walk", "infinitive"), "walk");
    assert.equal(inflectVerb("give", "past"), "gave");
    assert.equal(inflectVerb("give", "participle"), "given");
    assert.equal(inflectVerb("come", "participle"), "come");
    assert.equal(inflectVerb("go", "participle"), "gone");
    assert.equal(inflectVerb("be", "participle"), "been");
    assert.equal(inflectVerb("become", "participle"), "become");
    assert.equal(inflectVerb("run", "participle"), "run");
    assert.equal(inflectVerb("see", "participle"), "seen");
    assert.equal(inflectVerb("walk", "future"), "walk");
  });
});

describe("inflectAdjective", () => {
  const { inflectAdjective } = worker;

  it("uses -er/-est for short and irregular adjectives", () => {
    assert.equal(inflectAdjective("large", true, false), "larger");
    assert.equal(inflectAdjective("large", false, true), "largest");
    assert.equal(inflectAdjective("good", true, false), "better");
    assert.equal(inflectAdjective("good", false, true), "best");
  });

  it("falls back to more/most instead of inventing significanter", () => {
    assert.equal(inflectAdjective("significant", true, false), "more significant");
    assert.equal(inflectAdjective("significant", false, true), "most significant");
    assert.equal(inflectAdjective("natural", true, false), "more natural");
    assert.equal(inflectAdjective("historical", true, false), "more historical");
  });

  it("strips more/most before inflecting again", () => {
    assert.equal(inflectAdjective("more significant", true, false), "more significant");
    assert.equal(inflectAdjective("most natural", false, true), "most natural");
  });
});

describe("inflectNoun", () => {
  const { inflectNoun } = worker;

  it("pluralizes and marks possessives", () => {
    assert.equal(inflectNoun("cat", true, false), "cats");
    assert.equal(inflectNoun("cat", false, true), "cat's");
    assert.equal(inflectNoun("cats", true, true), "cats'");
    assert.equal(inflectNoun("man", true, false), "men");
    assert.equal(inflectNoun("life", true, false), "lives");
  });
});

describe("a / an / the", () => {
  it("chooses an before a vowel sound and a before a consonant", () => {
    assert.equal(values(repair("a apple")).join(" "), "An apple");
    assert.equal(values(repair("an book")).join(" "), "A book");
    assert.equal(values(repair("an honest man")).join(" "), "An honest man");
    assert.equal(values(repair("a university")).join(" "), "A university");
    assert.equal(values(repair("a unique idea")).join(" "), "A unique idea");
    assert.equal(values(repair("a unicorn")).join(" "), "A unicorn");
    assert.equal(values(repair("an heir")).join(" "), "An heir");
    assert.equal(values(repair("an hour later")).join(" "), "An hour later");
  });

  it("switches a/an to the before a plural head noun", () => {
    assert.equal(values(repair("a books")).join(" "), "The books");
  });
});

describe("verbLemma", () => {
  const { verbLemma } = worker;

  it("resolves inflected verbs to a real infinitive", () => {
    assert.equal(verbLemma("walked"), "walk");
    assert.equal(verbLemma("gave"), "give");
    assert.equal(verbLemma("dedicated"), "dedicate");
  });
});
