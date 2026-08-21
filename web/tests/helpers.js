const path = require("path");
const worker = require(path.join(__dirname, "..", "cut-up-worker.js"));

function words(tokens) {
  return tokens.filter((token) => token.type === "word");
}

function normals(tokens) {
  return words(tokens).map((token) => token.normal);
}

function values(tokens) {
  return words(tokens).map((token) => token.value);
}

function closedNormals(tokens) {
  return words(tokens).filter((token) => token.closed).map((token) => token.normal);
}

function text(tokens, preserveLines) {
  return worker.tokensToText(tokens, Boolean(preserveLines));
}

function analyze(source, preserveLines) {
  return worker.analyze(worker.normalizeInput(source, preserveLines));
}

function repair(source, preserveLines) {
  return worker.repairTokens(analyze(source, preserveLines));
}

function repairedText(source, preserveLines) {
  return text(repair(source, preserveLines), preserveLines);
}

function tagged(source) {
  return words(analyze(source)).map((token) => ({
    value: token.value,
    normal: token.normal,
    slot: token.slot,
    plural: Boolean(token.plural),
    verbForm: token.verbForm,
    closed: Boolean(token.closed),
    comparative: Boolean(token.comparative),
    superlative: Boolean(token.superlative),
  }));
}

function verbAt(source, normal) {
  const tokens = analyze(source);
  const index = tokens.findIndex((token) => token.type === "word" && token.normal === normal);
  if (index === -1) {
    throw new Error(`No word "${normal}" in: ${source}`);
  }
  return {
    tokens,
    index,
    token: tokens[index],
    subject: worker.subjectToken(tokens, index),
    person: worker.personOf(worker.subjectToken(tokens, index)),
    form: worker.contextualVerbForm(tokens, index, tokens[index].verbForm),
  };
}

function fillAndRepair(scrambleText, referenceText, allowReuse) {
  const reference = analyze(referenceText);
  const buckets = worker.buildPool(scrambleText);
  return worker.repairTokens(worker.fillDraft(reference, buckets, allowReuse !== false));
}

module.exports = {
  worker,
  words,
  normals,
  values,
  closedNormals,
  text,
  analyze,
  repair,
  repairedText,
  tagged,
  verbAt,
  fillAndRepair,
};
