const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { GETTYSBURG, MOTH } = require("./fixtures");
const {
  worker, words, closedNormals, analyze, repair, fillAndRepair, text,
} = require("./helpers");

describe("Gettysburg × moth cut-up", () => {
  it("copies closed-class words from the Gettysburg mold", () => {
    const skip = new Set(["a", "an", "the"]);
    const closed = (tokens) => closedNormals(tokens).filter((word) => !skip.has(word));
    assert.deepEqual(closed(fillAndRepair(MOTH, GETTYSBURG, true)), closed(analyze(GETTYSBURG)));
  });

  it("does not invent the original moth-excerpt failures", () => {
    const output = text(fillAndRepair(MOTH, GETTYSBURG, true));
    assert.doesNotMatch(output, /significanter/i);
    assert.doesNotMatch(output, /can not \w+s(?:—|$|\s)/i);
    assert.doesNotMatch(output, /they does/i);
    assert.doesNotMatch(output, /we says/i);
    assert.doesNotMatch(output, /will little \w+s\b/i);
  });

  it("keeps infinitives after can not / will little, and past do-support", () => {
    const reference = words(analyze(GETTYSBURG));
    const filled = words(fillAndRepair(MOTH, GETTYSBURG, true));

    reference.forEach((token, index) => {
      if (token.normal !== "can") return;
      if (reference[index + 1]?.slot !== "negative") return;
      const verb = filled.slice(index + 1).find((item) => item.slot === "verb");
      assert.ok(verb, "verb after can not");
      assert.equal(verb.verbForm, "infinitive", verb.value);
    });

    const willIndex = reference.findIndex((token) => token.normal === "will");
    assert.equal(reference[willIndex + 1].normal, "little");
    assert.equal(filled[willIndex + 1].slot, "adverb");
    assert.equal(filled[willIndex + 2].slot, "verb");
    assert.equal(filled[willIndex + 2].verbForm, "infinitive");

    const did = filled.find((token) => token.normal === "did");
    assert.ok(did);
    assert.equal(did.slot, "auxiliary");
  });

  it("inflects the comparative slot without a fake -er", () => {
    const tokens = fillAndRepair(MOTH, GETTYSBURG, true);
    const largerSlot = words(analyze(GETTYSBURG)).findIndex((token) => token.comparative);
    const filled = words(tokens)[largerSlot];
    assert.ok(filled.comparative);
    assert.doesNotMatch(filled.normal, /anter$|enter$|icter$/);
    assert.ok(/^(?:more|most)\s/.test(filled.normal) || /(?:er|est)$/.test(filled.normal), filled.normal);
  });

  it("survives generate() and still looks like the Gettysburg mold", () => {
    const result = worker.generate({
      scrambleText: MOTH,
      referenceText: GETTYSBURG,
      preserveLines: false,
      allowReuse: true,
    });
    assert.equal(typeof result.output, "string");
    assert.ok(result.outputTokens.length > 20);
    assert.match(result.output, /We have /);
    assert.match(result.output, /can not /);
    assert.match(result.output, /they did /i);
    assert.match(result.output, /should do this/i);
    assert.doesNotMatch(result.output, /they does/i);
    assert.doesNotMatch(result.output, /significanter/i);
  });
});

describe("fillDraft pools", () => {
  it("buckets open-class scramble words and drops closed-class ones", () => {
    const buckets = worker.buildPool(MOTH);
    assert.ok(buckets.noun?.length);
    assert.ok(buckets.verb?.length);
    assert.ok(buckets.adjective?.length);
    assert.equal(buckets.preposition, undefined);
    assert.equal(buckets.pronoun, undefined);
    assert.equal(buckets.auxiliary, undefined);
  });

  it("does not put abbreviations or vowelless scraps in the pool", () => {
    const buckets = worker.buildPool("The sq lgm moths 42 wings.");
    const all = Object.values(buckets).flat().map((item) => item.normal);
    assert.ok(!all.includes("sq"));
    assert.ok(!all.includes("lgm"));
    assert.ok(!all.includes("42"));
    assert.ok(all.includes("moth") || all.includes("moths") || all.includes("wing") || all.includes("wings"));
  });
});

describe("recase and line breaks", () => {
  it("capitalizes sentence starts and keeps I as I", () => {
    const tokens = repair("we think. they know i am here.");
    const textOut = text(tokens);
    assert.match(textOut, /^We /);
    assert.match(textOut, /\. They /);
    assert.match(textOut, / I am /);
  });

  it("can preserve line breaks in the reference", () => {
    const poem = "We walk\nwe talk";
    const result = worker.generate({
      scrambleText: "Cats leap dogs bark",
      referenceText: poem,
      preserveLines: true,
      allowReuse: true,
    });
    assert.match(result.output, /\n/);
  });
});
