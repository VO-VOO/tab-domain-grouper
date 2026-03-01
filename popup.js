const groupButton = document.getElementById("group-btn");
const ungroupButton = document.getElementById("ungroup-btn");
const toggleButton = document.getElementById("toggle-btn");
const optionsButton = document.getElementById("options-btn");
const statusElement = document.getElementById("status");
const autoStateElement = document.getElementById("auto-state");

function toErrorMessage(error) {
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function setStatus(message) {
  statusElement.textContent = message;
}

function setBusy(isBusy) {
  groupButton.disabled = isBusy;
  ungroupButton.disabled = isBusy;
  toggleButton.disabled = isBusy;
}

function setAutoBadge(autoGroup) {
  autoStateElement.textContent = autoGroup ? "Enabled" : "Disabled";
  autoStateElement.className = autoGroup ? "badge ok" : "badge off";
}

function getCurrentWindowId() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const activeTab = tabs && tabs[0];
      if (!activeTab || typeof activeTab.windowId !== "number") {
        reject(new Error("Cannot detect current window."));
        return;
      }

      resolve(activeTab.windowId);
    });
  });
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error("No response from service worker."));
        return;
      }

      if (!response.ok) {
        reject(new Error(response.error || "Unknown service worker error."));
        return;
      }

      resolve(response);
    });
  });
}

async function loadOptions() {
  const response = await sendMessage({ action: "GET_OPTIONS" });
  const options = response.options || {};
  setAutoBadge(Boolean(options.autoGroup));
}

async function handleGroup() {
  setBusy(true);
  setStatus("Grouping current window...");
  try {
    const windowId = await getCurrentWindowId();
    const response = await sendMessage({ action: "GROUP_WINDOW", windowId });
    const updatedGroups = response.result ? response.result.updatedGroups : 0;
    setStatus(`Done. Updated groups: ${updatedGroups}.`);
  } catch (error) {
    setStatus(`Group failed: ${toErrorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleUngroup() {
  setBusy(true);
  setStatus("Ungrouping current window...");
  try {
    const windowId = await getCurrentWindowId();
    const response = await sendMessage({ action: "UNGROUP_WINDOW", windowId });
    const ungrouped = response.result ? response.result.ungrouped : 0;
    setStatus(`Done. Ungrouped tabs: ${ungrouped}.`);
  } catch (error) {
    setStatus(`Ungroup failed: ${toErrorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

async function handleToggleAuto() {
  setBusy(true);
  setStatus("Toggling auto group...");
  try {
    const response = await sendMessage({ action: "TOGGLE_AUTO" });
    const autoGroup = Boolean(response.autoGroup);
    setAutoBadge(autoGroup);
    setStatus(autoGroup ? "Auto group enabled." : "Auto group disabled.");
  } catch (error) {
    setStatus(`Toggle failed: ${toErrorMessage(error)}`);
  } finally {
    setBusy(false);
  }
}

function openOptionsPage() {
  chrome.runtime.openOptionsPage(() => {
    if (chrome.runtime.lastError) {
      setStatus(`Cannot open options: ${chrome.runtime.lastError.message}`);
      return;
    }
    window.close();
  });
}

groupButton.addEventListener("click", () => {
  handleGroup();
});

ungroupButton.addEventListener("click", () => {
  handleUngroup();
});

toggleButton.addEventListener("click", () => {
  handleToggleAuto();
});

optionsButton.addEventListener("click", () => {
  openOptionsPage();
});

loadOptions().catch((error) => {
  setStatus(`Load options failed: ${toErrorMessage(error)}`);
  setAutoBadge(false);
});
