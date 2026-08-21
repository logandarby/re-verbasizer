const elements = {
  status: document.querySelector("#dictionary-status"),
  statusText: document.querySelector("#status-text"),
  scramble: document.querySelector("#scramble-text"),
  reference: document.querySelector("#reference-text"),
  scrambleCount: document.querySelector("#scramble-count"),
  referenceCount: document.querySelector("#reference-count"),
  preserveLines: document.querySelector("#preserve-lines"),
  showStructure: document.querySelector("#show-structure"),
  generate: document.querySelector("#generate-button"),
  again: document.querySelector("#again-button"),
  copy: document.querySelector("#copy-button"),
  placeholder: document.querySelector("#result-placeholder"),
  output: document.querySelector("#output"),
};

const worker = new Worker("cut-up-worker.js");
const WORD_PATTERN = /[\p{L}\p{M}]+(?:['\u2019\-][\p{L}\p{M}]+)*/gu;
let dictionaryReady = false;
let requestId = 0;
let latestOutput = "";

function wordCount(text) {
  return text.match(WORD_PATTERN)?.length || 0;
}

function formatCount(count) {
  return `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;
}

function updateInputs() {
  const scrambleWords = wordCount(elements.scramble.value);
  const referenceWords = wordCount(elements.reference.value);
  elements.scrambleCount.textContent = formatCount(scrambleWords);
  elements.referenceCount.textContent = formatCount(referenceWords);
  elements.generate.disabled = !dictionaryReady || !scrambleWords || !referenceWords;
}

function setLoading(isLoading) {
  elements.generate.querySelector("span").textContent = isLoading
    ? "Generating..."
    : "Generate";
  elements.generate.disabled = isLoading;
  elements.again.disabled = isLoading;
}

function requestCut() {
  if (!dictionaryReady || !wordCount(elements.scramble.value)
    || !wordCount(elements.reference.value)) return;

  setLoading(true);
  requestId += 1;
  worker.postMessage({
    type: "generate",
    requestId,
    scrambleText: elements.scramble.value,
    referenceText: elements.reference.value,
    preserveLines: elements.preserveLines.checked,
  });
}

function showResult(message) {
  latestOutput = message.output;
  elements.output.replaceChildren(
    ...message.outputTokens.map((token) => {
      if (token.type === "separator") {
        return document.createTextNode(token.value);
      }

      const unit = document.createElement("span");
      unit.className = "word-unit";

      const tag = document.createElement("span");
      tag.className = "word-tag";
      tag.textContent = token.category;
      tag.setAttribute("aria-hidden", "true");

      const word = document.createElement("span");
      word.textContent = token.value;
      unit.append(tag, word);
      return unit;
    }),
  );
  elements.output.classList.toggle("reveal", elements.showStructure.checked);
  elements.placeholder.hidden = true;
  elements.output.hidden = false;
  elements.again.disabled = false;
  elements.copy.disabled = false;
  setLoading(false);
  elements.output.scrollIntoView({ behavior: "smooth", block: "center" });
}

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "ready") {
    dictionaryReady = true;
    elements.status.classList.add("ready");
    elements.statusText.textContent = `${message.entries.toLocaleString()} words ready`;
    updateInputs();
    return;
  }

  if (message.type === "result" && message.requestId === requestId) {
    showResult(message);
    return;
  }

  if (message.type === "load-error") {
    elements.status.classList.add("error");
    elements.statusText.textContent = "Dictionary unavailable";
    elements.placeholder.textContent =
      "The dictionary could not load. Serve the project over HTTP instead of opening the file directly.";
    return;
  }

  if (message.type === "error" && message.requestId === requestId) {
    setLoading(false);
    elements.placeholder.hidden = false;
    elements.placeholder.textContent = `The cut failed: ${message.message}`;
  }
});

worker.addEventListener("error", () => {
  elements.status.classList.add("error");
  elements.statusText.textContent = "Worker unavailable";
  elements.generate.disabled = true;
});

[elements.scramble, elements.reference].forEach((input) => {
  input.addEventListener("input", updateInputs);
});

elements.generate.addEventListener("click", requestCut);
elements.again.addEventListener("click", requestCut);

elements.showStructure.addEventListener("change", () => {
  elements.output.classList.toggle("reveal", elements.showStructure.checked);
});

elements.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(latestOutput);
    elements.copy.textContent = "Copied";
    window.setTimeout(() => {
      elements.copy.textContent = "Copy";
    }, 1400);
  } catch {
    elements.copy.textContent = "Copy failed";
  }
});

updateInputs();
