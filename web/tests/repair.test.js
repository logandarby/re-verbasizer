const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { GETTYSBURG } = require("./fixtures");
const {
  words, normals, values, analyze, repair, repairedText, verbAt,
} = require("./helpers");

describe("Gettysburg identity", () => {
  it("does not rewrite well-formed Gettysburg verb and auxiliary forms", () => {
    const original = analyze(GETTYSBURG);
    const repaired = repair(GETTYSBURG);
    assert.deepEqual(normals(repaired), normals(original));
  });

  it("keeps the mold's auxiliaries, modals, and do-support", () => {
    const tokens = words(repair(GETTYSBURG));
    const bySlot = (slot) => tokens.filter((token) => token.slot === slot).map((token) => token.normal);

    assert.deepEqual(bySlot("auxiliary").concat(tokens.filter((t) => t.slot === "copula").map((t) => t.normal)), [
      "have", "is", "do", "have", "did",
    ]);
    assert.deepEqual(bySlot("modal"), ["might", "should", "can", "can", "can", "will", "can"]);
  });

  it("keeps infinitives after to, modals, not, never, little, and long", () => {
    const text = repairedText(GETTYSBURG);
    assert.match(text, /to dedicate/i);
    assert.match(text, /might live/i);
    assert.match(text, /should do this/i);
    assert.match(text, /can not dedicate/i);
    assert.match(text, /can not consecrate/i);
    assert.match(text, /can not hallow/i);
    assert.match(text, /will little note/i);
    assert.match(text, /nor long remember/i);
    assert.match(text, /can never forget/i);
    assert.doesNotMatch(text, /can not \w+s\b/i);
    assert.doesNotMatch(text, /they does/i);
    assert.doesNotMatch(text, /we says/i);
  });

  it("reads subjects from the verb, not the first noun in the sentence", () => {
    const dedicate = verbAt(GETTYSBURG, "dedicate");
    assert.equal(dedicate.subject.normal, "we");
    assert.equal(dedicate.person, "plural");
    assert.equal(dedicate.form, "infinitive");

    const say = verbAt(GETTYSBURG, "say");
    assert.equal(say.subject.normal, "we");
    assert.equal(say.person, "plural");

    const did = verbAt(GETTYSBURG, "did");
    assert.equal(did.subject.normal, "they");
    assert.equal(did.person, "plural");
  });

  it("tags mid-position adverbs and possessed nouns instead of verbs", () => {
    const tags = new Map(words(analyze(GETTYSBURG)).map((token) => [token.normal, token]));
    assert.equal(tags.get("little").slot, "adverb");
    assert.equal(tags.get("long").slot, "adverb");
    assert.equal(tags.get("lives").slot, "noun");
    assert.equal(tags.get("lives").plural, true);
    assert.equal(tags.get("fitting").slot, "adjective");
    assert.equal(tags.get("living").slot, "adjective");
    assert.equal(tags.get("resting").slot, "adjective");
    assert.equal(tags.get("larger").comparative, true);
  });
});

describe("subject–verb agreement", () => {
  const cases = [
    ["I is here", "I am here"],
    ["We is here", "We are here"],
    ["You is here", "You are here"],
    ["He are here", "He is here"],
    ["They is here", "They are here"],
    ["These is ready", "These are ready"],
    ["Those was ready", "Those were ready"],
    ["I was here", "I was here"],
    ["We was here", "We were here"],
    ["You was here", "You were here"],
    ["He were here", "He was here"],
    ["They was here", "They were here"],
    ["The men is here", "The men are here"],
    ["He have come", "He has come"],
    ["They has come", "They have come"],
    ["I have come", "I have come"],
    ["We have come", "We have come"],
    ["He do think", "He does think"],
    ["We does think", "We do think"],
    ["They does think", "They do think"],
    ["He did go", "He did go"],
    ["They did go", "They did go"],
    ["We did go", "We did go"],
    ["He had gone", "He had gone"],
    ["They had gone", "They had gone"],
  ];

  for (const [input, expected] of cases) {
    it(`repairs "${input}" to "${expected}"`, () => {
      assert.equal(values(repair(input)).join(" "), expected);
    });
  }

  it("reduces be/have/do to infinitive after to and modals", () => {
    assert.equal(values(repair("We can is free")).join(" "), "We can be free");
    assert.equal(values(repair("He will has gone")).join(" "), "He will have gone");
    assert.equal(values(repair("They should does this")).join(" "), "They should do this");
    assert.equal(values(repair("to been dedicated")).join(" "), "To be dedicated");
    assert.equal(values(repair("to having seen")).join(" "), "To have seen");
  });

  it("leaves non-finite been/being/having/doing/done alone", () => {
    assert.equal(values(repair("I am being seen")).join(" "), "I am being seen");
    assert.equal(values(repair("They have been seen")).join(" "), "They have been seen");
    assert.equal(values(repair("She is doing work")).join(" "), "She is doing work");
    assert.equal(values(repair("We are having lunch")).join(" "), "We are having lunch");
    assert.equal(values(repair("It is done")).join(" "), "It is done");
  });
});

describe("contextual verb form", () => {
  it("uses a participle after have and a finite copula", () => {
    assert.equal(verbAt("They have come", "come").form, "participle");
    assert.equal(verbAt("It is dedicated", "dedicated").form, "participle");
  });

  it("uses an infinitive after do-support, to, and modals, skipping not/never/adverbs", () => {
    assert.equal(verbAt("They did go", "go").form, "infinitive");
    assert.equal(verbAt("We can not dedicate", "dedicate").form, "infinitive");
    assert.equal(verbAt("It can never forget", "forget").form, "infinitive");
    assert.equal(verbAt("The world will little note", "note").form, "infinitive");
    assert.equal(
      verbAt("The world will little note, nor long remember", "remember").form,
      "infinitive",
    );
  });

  it("uses a gerund after a preposition", () => {
    assert.equal(verbAt("of spreading light", "spreading").form, "gerund");
  });

  it("shares a governor across and/or/nor", () => {
    const put = verbAt("They walked across the room, and put the book down", "put");
    assert.equal(put.form, "past");
  });
});

describe("personOf", () => {
  it("treats I as first person and we/they/you/these/those as plural", () => {
    assert.equal(verbAt("I walk", "walk").person, "I");
    assert.equal(verbAt("We walk", "walk").person, "plural");
    assert.equal(verbAt("They walk", "walk").person, "plural");
    assert.equal(verbAt("You walk", "walk").person, "plural");
    assert.equal(verbAt("He walks", "walks").person, "singular");
    assert.equal(verbAt("These are ready", "are").person, "plural");
    assert.equal(verbAt("Those were ready", "were").person, "plural");
    assert.equal(verbAt("The men walk", "walk").person, "plural");
    assert.equal(verbAt("The cat walks", "walks").person, "singular");
  });

  it("keeps plural-agreeing pronouns and demonstratives closed", () => {
    for (const word of ["we", "they", "you", "these", "those"]) {
      const token = words(analyze(word))[0];
      assert.equal(token.closed, true, word);
      assert.equal(token.plural, true, word);
    }
    const i = words(analyze("I"))[0];
    assert.equal(i.slot, "pronoun");
    assert.equal(i.plural, false);
  });
});
