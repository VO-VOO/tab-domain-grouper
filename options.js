const DEFAULT_OPTIONS = {
  autoGroup: true,
  includePinned: false,
  ignoreGrouped: true,
  collapseGroups: false
};

const form = document.getElementById("options-form");
const resetButton = document.getElementById("reset-btn");
const statusElement = document.getElementById("status");

function toErrorMessage(error) {
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function readStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items || {});
    });
  });
}

function writeStorage(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function setStatus(message) {
  statusElement.textContent = message;
}

function renderOptions(options) {
  Object.keys(DEFAULT_OPTIONS).forEach((key) => {
    const element = document.getElementById(key);
    if (element && element.type === "checkbox") {
      element.checked = Boolean(options[key]);
    }
  });
}

function collectOptionsFromForm() {
  const nextOptions = { ...DEFAULT_OPTIONS };

  Object.keys(DEFAULT_OPTIONS).forEach((key) => {
    const element = document.getElementById(key);
    nextOptions[key] = Boolean(element && element.checked);
  });

  return nextOptions;
}

async function loadAndRenderOptions() {
  const stored = await readStorage(DEFAULT_OPTIONS);
  const merged = {
    ...DEFAULT_OPTIONS,
    ...stored
  };
  renderOptions(merged);
}

async function saveFromForm() {
  const nextOptions = collectOptionsFromForm();
  await writeStorage(nextOptions);
  setStatus("Saved.");
}

async function resetToDefaults() {
  renderOptions(DEFAULT_OPTIONS);
  await writeStorage(DEFAULT_OPTIONS);
  setStatus("Reset to defaults.");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  setStatus("Saving...");
  saveFromForm().catch((error) => {
    setStatus(`Save failed: ${toErrorMessage(error)}`);
  });
});

resetButton.addEventListener("click", () => {
  setStatus("Resetting...");
  resetToDefaults().catch((error) => {
    setStatus(`Reset failed: ${toErrorMessage(error)}`);
  });
});

loadAndRenderOptions()
  .then(() => {
    setStatus("Loaded current options.");
  })
  .catch((error) => {
    setStatus(`Load failed: ${toErrorMessage(error)}`);
  });
