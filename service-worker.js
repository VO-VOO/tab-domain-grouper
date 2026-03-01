const DEFAULT_OPTIONS = {
  autoGroup: true,
  includePinned: false,
  ignoreGrouped: true,
  collapseGroups: false
};

const AUTO_GROUP_DEBOUNCE_MS = 700;
const MIN_TABS_PER_GROUP = 2;
const GROUP_RENDER_FIX_DELAY_MS = 60;
const COLOR_PALETTE = [
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange"
];

const IGNORED_URL_PREFIXES = [
  "chrome://",
  "edge://",
  "about:",
  "file://",
  "chrome-extension://",
  "view-source:"
];

const debounceTimersByWindow = new Map();
const inFlightWindows = new Set();

let cachedOptions = { ...DEFAULT_OPTIONS };
let optionsReady = false;

function storageGetSync(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (items) => {
      resolve(items || {});
    });
  });
}

function storageSetSync(items) {
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

function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs || []);
    });
  });
}

function tabsGroup(groupOptions) {
  return new Promise((resolve, reject) => {
    chrome.tabs.group(groupOptions, (groupId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(groupId);
    });
  });
}

function tabsUngroup(tabIds) {
  return new Promise((resolve, reject) => {
    chrome.tabs.ungroup(tabIds, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function tabGroupsUpdate(groupId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabGroups.update(groupId, updateProperties, (group) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(group);
    });
  });
}

async function loadOptions() {
  const stored = await storageGetSync(DEFAULT_OPTIONS);
  cachedOptions = {
    ...DEFAULT_OPTIONS,
    ...stored
  };
  optionsReady = true;
  return cachedOptions;
}

async function getOptions() {
  if (!optionsReady) {
    await loadOptions();
  }
  return { ...cachedOptions };
}

function toErrorMessage(error) {
  if (error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}

function hashDomain(domain) {
  let hash = 0;
  for (let index = 0; index < domain.length; index += 1) {
    hash = (hash << 5) - hash + domain.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getColorForDomain(domain) {
  const hash = hashDomain(domain);
  const colorIndex = hash % COLOR_PALETTE.length;
  return COLOR_PALETTE[colorIndex];
}

function shouldIgnoreUrl(url) {
  if (!url || typeof url !== "string") {
    return true;
  }

  const normalized = url.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  for (let i = 0; i < IGNORED_URL_PREFIXES.length; i += 1) {
    if (normalized.startsWith(IGNORED_URL_PREFIXES[i])) {
      return true;
    }
  }

  return false;
}

function getDomainFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) {
      return "";
    }
    return parsed.hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldIncludeTab(tab, options) {
  if (!tab || typeof tab.id !== "number") {
    return false;
  }

  if (!options.includePinned && tab.pinned) {
    return false;
  }

  if (options.ignoreGrouped && tab.groupId !== -1) {
    return false;
  }

  if (shouldIgnoreUrl(tab.url)) {
    return false;
  }

  const domain = getDomainFromUrl(tab.url);
  if (!domain) {
    return false;
  }

  return true;
}

async function forceRefreshGroupRendering(groupId, groupProperties, collapseGroups) {
  await sleep(GROUP_RENDER_FIX_DELAY_MS);
  await tabGroupsUpdate(groupId, { collapsed: true });
  await sleep(GROUP_RENDER_FIX_DELAY_MS);
  await tabGroupsUpdate(groupId, { collapsed: false });
  await sleep(GROUP_RENDER_FIX_DELAY_MS);

  await tabGroupsUpdate(groupId, groupProperties);

  if (collapseGroups) {
    await sleep(GROUP_RENDER_FIX_DELAY_MS);
    await tabGroupsUpdate(groupId, { collapsed: true });
  }
}

function groupTabsByDomain(tabs, options) {
  const buckets = new Map();

  for (let i = 0; i < tabs.length; i += 1) {
    const tab = tabs[i];
    if (!shouldIncludeTab(tab, options)) {
      continue;
    }

    const domain = getDomainFromUrl(tab.url);
    if (!buckets.has(domain)) {
      buckets.set(domain, []);
    }

    buckets.get(domain).push(tab.id);
  }

  return buckets;
}

async function regroupWindowByDomain(windowId, forceRun) {
  if (typeof windowId !== "number" || windowId < 0) {
    return { updatedGroups: 0, skipped: true, reason: "invalid-window" };
  }

  if (inFlightWindows.has(windowId)) {
    return { updatedGroups: 0, skipped: true, reason: "in-flight" };
  }

  const options = await getOptions();
  if (!forceRun && !options.autoGroup) {
    return { updatedGroups: 0, skipped: true, reason: "auto-disabled" };
  }

  inFlightWindows.add(windowId);
  try {
    const tabs = await tabsQuery({ windowId });
    const domainBuckets = groupTabsByDomain(tabs, options);
    const domainEntries = Array.from(domainBuckets.entries());

    let updatedGroups = 0;
    for (let i = 0; i < domainEntries.length; i += 1) {
      const domain = domainEntries[i][0];
      const tabIds = domainEntries[i][1];
      if (!tabIds || tabIds.length < MIN_TABS_PER_GROUP) {
        continue;
      }

      try {
        const groupId = await tabsGroup({ tabIds });
        const color = getColorForDomain(domain);
        const groupProperties = {
          title: domain,
          color
        };

        await tabGroupsUpdate(groupId, groupProperties);

        await forceRefreshGroupRendering(groupId, groupProperties, options.collapseGroups);
        updatedGroups += 1;
      } catch (_error) {
        // Ignore individual group failures so other domains still process.
      }
    }

    return { updatedGroups, skipped: false };
  } finally {
    inFlightWindows.delete(windowId);
  }
}

async function ungroupWindow(windowId) {
  if (typeof windowId !== "number" || windowId < 0) {
    return { ungrouped: 0, skipped: true, reason: "invalid-window" };
  }

  const tabs = await tabsQuery({ windowId });
  const groupedTabIds = [];

  for (let i = 0; i < tabs.length; i += 1) {
    if (tabs[i].groupId !== -1 && typeof tabs[i].id === "number") {
      groupedTabIds.push(tabs[i].id);
    }
  }

  if (groupedTabIds.length === 0) {
    return { ungrouped: 0, skipped: false };
  }

  await tabsUngroup(groupedTabIds);
  return { ungrouped: groupedTabIds.length, skipped: false };
}

function clearDebounce(windowId) {
  const timerId = debounceTimersByWindow.get(windowId);
  if (timerId) {
    clearTimeout(timerId);
    debounceTimersByWindow.delete(windowId);
  }
}

async function scheduleAutoRegroup(windowId) {
  if (typeof windowId !== "number" || windowId < 0) {
    return;
  }

  const options = await getOptions();
  if (!options.autoGroup) {
    return;
  }

  clearDebounce(windowId);
  const timerId = setTimeout(() => {
    debounceTimersByWindow.delete(windowId);
    regroupWindowByDomain(windowId, false).catch(() => {
      // Silent fail to avoid crashing event loop.
    });
  }, AUTO_GROUP_DEBOUNCE_MS);

  debounceTimersByWindow.set(windowId, timerId);
}

function shouldHandleOnUpdated(changeInfo) {
  if (!changeInfo || typeof changeInfo !== "object") {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(changeInfo, "url")) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(changeInfo, "status")) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(changeInfo, "pinned")) {
    return true;
  }

  return false;
}

async function toggleAutoGroup() {
  const options = await getOptions();
  const nextValue = !options.autoGroup;

  cachedOptions = {
    ...options,
    autoGroup: nextValue
  };

  await storageSetSync({ autoGroup: nextValue });
  return nextValue;
}

chrome.runtime.onInstalled.addListener(() => {
  loadOptions()
    .then((options) => storageSetSync(options))
    .catch(() => {
      // Ignore initialization errors; extension can still run with defaults.
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  let hasRelevantChange = false;
  const nextOptions = { ...cachedOptions };

  Object.keys(DEFAULT_OPTIONS).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      nextOptions[key] = changes[key].newValue;
      hasRelevantChange = true;
    }
  });

  if (hasRelevantChange) {
    cachedOptions = {
      ...DEFAULT_OPTIONS,
      ...nextOptions
    };
    optionsReady = true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!shouldHandleOnUpdated(changeInfo)) {
    return;
  }
  if (!tab || typeof tab.windowId !== "number" || tab.windowId < 0) {
    return;
  }

  scheduleAutoRegroup(tab.windowId).catch(() => {
    // Ignore schedule failure.
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab || typeof tab.windowId !== "number" || tab.windowId < 0) {
    return;
  }

  scheduleAutoRegroup(tab.windowId).catch(() => {
    // Ignore schedule failure.
  });
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (!removeInfo || removeInfo.isWindowClosing) {
    return;
  }
  if (typeof removeInfo.windowId !== "number" || removeInfo.windowId < 0) {
    return;
  }

  scheduleAutoRegroup(removeInfo.windowId).catch(() => {
    // Ignore schedule failure.
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message && message.action;

  if (action === "GROUP_WINDOW") {
    const targetWindowId =
      typeof message.windowId === "number"
        ? message.windowId
        : sender && sender.tab
          ? sender.tab.windowId
          : -1;

    clearDebounce(targetWindowId);
    regroupWindowByDomain(targetWindowId, true)
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  if (action === "UNGROUP_WINDOW") {
    const targetWindowId =
      typeof message.windowId === "number"
        ? message.windowId
        : sender && sender.tab
          ? sender.tab.windowId
          : -1;

    clearDebounce(targetWindowId);
    ungroupWindow(targetWindowId)
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  if (action === "TOGGLE_AUTO") {
    toggleAutoGroup()
      .then((autoGroup) => {
        sendResponse({ ok: true, autoGroup });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  if (action === "GET_OPTIONS") {
    getOptions()
      .then((options) => {
        sendResponse({ ok: true, options });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: toErrorMessage(error) });
      });
    return true;
  }

  return false;
});

loadOptions().catch(() => {
  cachedOptions = { ...DEFAULT_OPTIONS };
  optionsReady = true;
});
