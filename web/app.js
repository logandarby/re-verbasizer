import {
  fetchExcerpts,
  loadCatalog,
  listCategories,
  listWorks,
  pickRandomWork,
} from "./text-sources.js";

const elements = {
  status: document.querySelector("#dictionary-status"),
  statusText: document.querySelector("#status-text"),
  scramble: document.querySelector("#scramble-text"),
  reference: document.querySelector("#reference-text"),
  scrambleCount: document.querySelector("#scramble-count"),
  referenceCount: document.querySelector("#reference-count"),
  preserveLines: document.querySelector("#preserve-lines"),
  allowReuse: document.querySelector("#allow-reuse"),
  showStructure: document.querySelector("#show-structure"),
  showHistory: document.querySelector("#show-history"),
  generate: document.querySelector("#generate-button"),
  again: document.querySelector("#again-button"),
  history: document.querySelector("#history"),
  historyLabel: document.querySelector("#history-label"),
  historyList: document.querySelector("#history-list"),
  copy: document.querySelector("#copy-button"),
  placeholder: document.querySelector("#result-placeholder"),
  output: document.querySelector("#output"),
  sourceLibrary: document.querySelector("#source-library"),
  sourceCategory: document.querySelector("#source-category"),
  sourceWork: document.querySelector("#source-work"),
  loadButtons: document.querySelectorAll("[data-load-target]"),
  surpriseSource: document.querySelector("#surprise-source-button"),
  sourceStatus: document.querySelector("#source-status"),
};

const worker = new Worker("cut-up-worker.js");
const WORD_PATTERN = /[\p{L}\p{M}]+(?:['\u2019\-][\p{L}\p{M}]+)*/gu;
const MAX_HISTORY = 20;
const LOAD_LABELS = {
  scramble: "Load scramble",
  reference: "Load reference",
  both: "Load both",
};
let grammarReady = false;
let requestId = 0;
let latestOutput = "";
let latestTokens = [];
let outputHistory = [];
let textCatalog = null;
let sourceLoading = false;

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
  elements.generate.disabled =
    !grammarReady || !scrambleWords || !referenceWords;
}

function setLoading(isLoading) {
  elements.generate.querySelector("span").textContent = isLoading
    ? "Generating..."
    : "Generate";
  elements.generate.disabled = isLoading;
  elements.again.disabled = isLoading;
}

function requestCut() {
  if (
    !grammarReady ||
    !wordCount(elements.scramble.value) ||
    !wordCount(elements.reference.value)
  )
    return;

  setLoading(true);
  requestId += 1;
  worker.postMessage({
    type: "generate",
    requestId,
    scrambleText: elements.scramble.value,
    referenceText: elements.reference.value,
    preserveLines: elements.preserveLines.checked,
    allowReuse: elements.allowReuse.checked,
  });
}

function renderOutput(outputTokens) {
  elements.output.replaceChildren(
    ...outputTokens.map((token) => {
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
}

function rememberCurrentOutput() {
  if (!latestOutput) {
    return;
  }

  if (outputHistory[0]?.output === latestOutput) {
    return;
  }

  outputHistory.unshift({
    output: latestOutput,
    outputTokens: latestTokens,
  });
  if (outputHistory.length > MAX_HISTORY) {
    outputHistory.length = MAX_HISTORY;
  }
}

function renderHistory() {
  const count = outputHistory.length;
  elements.showHistory.disabled = count === 0;
  elements.historyLabel.textContent =
    count > 0 ? `History (${count})` : "History";

  if (count === 0) {
    elements.showHistory.checked = false;
    elements.history.hidden = true;
    elements.historyList.replaceChildren();
    return;
  }

  elements.historyList.replaceChildren(
    ...outputHistory.map((entry, index) => {
      const item = document.createElement("li");
      item.className = "history-item";

      const text = document.createElement("p");
      text.className = "history-text";
      text.textContent = entry.output;

      const actions = document.createElement("div");
      actions.className = "history-item-actions";

      const restore = document.createElement("button");
      restore.type = "button";
      restore.textContent = "Restore";
      restore.addEventListener("click", () => restoreHistory(index));

      const copy = document.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => copyText(entry.output, copy, "Copy"));

      actions.append(restore, copy);
      item.append(text, actions);
      return item;
    }),
  );
}

function restoreHistory(index) {
  const entry = outputHistory[index];
  if (!entry) {
    return;
  }

  outputHistory.splice(index, 1);
  rememberCurrentOutput();
  latestOutput = entry.output;
  latestTokens = entry.outputTokens;
  renderOutput(latestTokens);
  renderHistory();
}

async function copyText(text, button, idleLabel) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.textContent = idleLabel;
    }, 1400);
  } catch {
    button.textContent = "Copy failed";
  }
}

function showResult(message) {
  if (latestOutput !== message.output) {
    rememberCurrentOutput();
  }
  latestOutput = message.output;
  latestTokens = message.outputTokens;
  renderOutput(latestTokens);
  renderHistory();
  elements.placeholder.hidden = true;
  elements.output.hidden = false;
  elements.again.disabled = false;
  elements.copy.disabled = false;
  setLoading(false);
  elements.output.scrollIntoView({ behavior: "smooth", block: "center" });
}

function selectedWork() {
  const workId = elements.sourceWork.value;
  return textCatalog.works.find((work) => work.id === workId) || null;
}

function populateCategories() {
  if (!textCatalog) {
    return;
  }

  const library = elements.sourceLibrary.value;
  const categories = listCategories(textCatalog, library);
  elements.sourceCategory.replaceChildren(
    ...categories.map((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = category.label;
      return option;
    }),
  );
  populateWorks();
}

function populateWorks() {
  if (!textCatalog) {
    return;
  }

  const library = elements.sourceLibrary.value;
  const categoryId = elements.sourceCategory.value;
  const works = listWorks(textCatalog, library, categoryId);
  elements.sourceWork.replaceChildren(
    ...works.map((work) => {
      const option = document.createElement("option");
      option.value = work.id;
      option.textContent = `${work.title} — ${work.author}`;
      return option;
    }),
  );
  setSourceButtonsEnabled(works.length > 0);
}

function setSourceStatus(message, isError = false) {
  elements.sourceStatus.hidden = false;
  elements.sourceStatus.textContent = message;
  elements.sourceStatus.classList.toggle("error", isError);
}

function clearSourceStatus() {
  elements.sourceStatus.hidden = true;
  elements.sourceStatus.textContent = "";
  elements.sourceStatus.classList.remove("error");
}

function setSourceButtonsEnabled(enabled) {
  elements.loadButtons.forEach((button) => {
    button.disabled = !enabled || sourceLoading;
  });
  elements.surpriseSource.disabled = !enabled || sourceLoading;
}

function setSourceLoading(isLoading, activeTarget = null) {
  sourceLoading = isLoading;
  setSourceButtonsEnabled(elements.sourceWork.options.length > 0);
  elements.loadButtons.forEach((button) => {
    const target = button.dataset.loadTarget;
    if (isLoading && target === activeTarget) {
      button.textContent = "Loading...";
      return;
    }
    button.textContent = LOAD_LABELS[target];
  });
}

function setSourcePanelLoading(isLoading) {
  elements.sourceLibrary.disabled = isLoading;
  elements.sourceCategory.disabled = isLoading;
  elements.sourceWork.disabled = isLoading;
  if (isLoading) {
    setSourceButtonsEnabled(false);
  }
}

async function loadSelectedExcerpt(target, work = selectedWork()) {
  if (sourceLoading) {
    return;
  }

  if (!work) {
    setSourceStatus("Select a work from the list first.", true);
    return;
  }

  setSourceLoading(true, target);
  setSourceStatus(`Loading ${work.title}...`);

  try {
    const excerpts = await fetchExcerpts(work, target);

    if (target === "scramble" || target === "both") {
      elements.scramble.value = excerpts.scramble;
    }
    if (target === "reference" || target === "both") {
      elements.reference.value = excerpts.reference;
    }

    updateInputs();
    setSourceStatus(`Loaded ${excerpts.meta}.`);
  } catch (error) {
    setSourceStatus(error.message || "Could not load excerpt.", true);
  } finally {
    setSourceLoading(false);
  }
}

async function surpriseExcerpt() {
  if (sourceLoading) return;
  const work = pickRandomWork(
    textCatalog,
    elements.sourceLibrary.value,
    elements.sourceCategory.value,
  );
  elements.sourceWork.value = work.id;
  await loadSelectedExcerpt("both", work);
}

async function initSourcePanel() {
  setSourcePanelLoading(true);
  setSourceStatus("Loading library catalog...");

  try {
    textCatalog = await loadCatalog();
    populateCategories();

    if (!elements.sourceWork.options.length) {
      setSourceStatus(
        "Library catalog is empty. Hard-refresh the page (Ctrl+Shift+R).",
        true,
      );
    } else {
      clearSourceStatus();
    }
  } catch (error) {
    setSourceStatus(error.message || "Library catalog unavailable.", true);
    setSourceButtonsEnabled(false);
  } finally {
    setSourcePanelLoading(false);
    if (elements.sourceWork.options.length > 0) {
      setSourceButtonsEnabled(true);
    }
  }
}

worker.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "ready") {
    grammarReady = true;
    elements.status.classList.add("ready");
    elements.statusText.textContent = "ready";
    updateInputs();
    return;
  }

  if (message.type === "result" && message.requestId === requestId) {
    showResult(message);
    return;
  }

  if (message.type === "load-error") {
    elements.status.classList.add("error");
    elements.statusText.textContent = "Grammar unavailable";
    elements.placeholder.textContent =
      "Compromise could not load. Serve the project over HTTP instead of opening the file directly.";
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

elements.showHistory.addEventListener("change", () => {
  elements.history.hidden = !elements.showHistory.checked;
});

elements.copy.addEventListener("click", () => {
  copyText(latestOutput, elements.copy, "Copy");
});

elements.sourceLibrary.addEventListener("change", populateCategories);
elements.sourceCategory.addEventListener("change", populateWorks);
elements.loadButtons.forEach((button) => {
  button.addEventListener("click", () => {
    loadSelectedExcerpt(button.dataset.loadTarget);
  });
});
elements.surpriseSource.addEventListener("click", surpriseExcerpt);

updateInputs();
initSourcePanel();
