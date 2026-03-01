const DEFAULT_OPTIONS = {
  autoGroup: true,
  includePinned: false,
  ignoreGrouped: true,
  collapseGroups: false
};

const AUTO_GROUP_DEBOUNCE_MS = 700;
const MIN_TABS_PER_GROUP = 2;
const GROUP_RENDER_FIX_TOGGLE_DELAY_MS = 45;
const GROUP_RENDER_FIX_RETRY_DELAYS_MS = [180, 700, 1800];
const FALLBACK_GROUP_TITLE = "\u200B";
const MAINLAND_CHINA_ROOT_DOMAINS = new Set([
  "baidu.com",
  "bilibili.com",
  "douyin.com",
  "iqiyi.com",
  "jd.com",
  "kuaishou.com",
  "qq.com",
  "sina.com",
  "sohu.com",
  "taobao.com",
  "tmall.com",
  "weibo.com",
  "youku.com",
  "zhihu.com"
]);
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

function windowsGetLastFocused(getInfo) {
  return new Promise((resolve, reject) => {
    chrome.windows.getLastFocused(getInfo, (windowInfo) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(windowInfo || null);
    });
  });
}

function tabsGet(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab || null);
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

function extractFirstHanCharacter(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  const match = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/u);
  return match ? match[0] : "";
}

function extractFirstLatinOrDigit(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  const match = text.match(/[A-Za-z0-9]/);
  return match ? match[0].toUpperCase() : "";
}

function getPrimaryDomainLabel(domain) {
  if (!domain || typeof domain !== "string") {
    return "";
  }

  const labels = domain.split(".").filter(Boolean);
  if (labels.length === 0) {
    return "";
  }

  const skippedPrefixes = new Set(["www", "m", "amp"]);
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i].toLowerCase();
    if (skippedPrefixes.has(label)) {
      continue;
    }
    return labels[i];
  }

  return labels[0];
}

function matchesDomainOrSubdomain(domain, rootDomain) {
  if (!domain || !rootDomain) {
    return false;
  }

  return domain === rootDomain || domain.endsWith(`.${rootDomain}`);
}

function isMainlandChinaDomain(domain) {
  if (!domain || typeof domain !== "string") {
    return false;
  }

  if (domain.endsWith(".cn") || domain.endsWith(".xn--fiqs8s")) {
    return true;
  }

  for (const rootDomain of MAINLAND_CHINA_ROOT_DOMAINS) {
    if (matchesDomainOrSubdomain(domain, rootDomain)) {
      return true;
    }
  }

  return false;
}

function buildGroupTitle(domain, tabTitle) {
  const mainlandChinaDomain = isMainlandChinaDomain(domain);
  const primaryDomainLabel = getPrimaryDomainLabel(domain);
  const domainMarker = extractFirstLatinOrDigit(primaryDomainLabel);
  const hanMarker = extractFirstHanCharacter(tabTitle);
  const titleMarker = extractFirstLatinOrDigit(tabTitle);

  if (mainlandChinaDomain) {
    if (hanMarker) {
      return hanMarker;
    }
    if (domainMarker) {
      return domainMarker;
    }
    if (titleMarker) {
      return titleMarker;
    }
    return FALLBACK_GROUP_TITLE;
  }

  if (domainMarker) {
    return domainMarker;
  }
  if (hanMarker) {
    return hanMarker;
  }
  if (titleMarker) {
    return titleMarker;
  }

  return FALLBACK_GROUP_TITLE;
}

function buildDistinctColorsByDomain(domains) {
  const sortedDomains = [...domains].sort();
  const colorByDomain = new Map();
  const usedColors = new Set();

  for (let i = 0; i < sortedDomains.length; i += 1) {
    const domain = sortedDomains[i];
    const baseIndex = hashDomain(domain) % COLOR_PALETTE.length;
    let selectedColor = COLOR_PALETTE[baseIndex];

    if (usedColors.size < COLOR_PALETTE.length) {
      for (let step = 0; step < COLOR_PALETTE.length; step += 1) {
        const candidate = COLOR_PALETTE[(baseIndex + step) % COLOR_PALETTE.length];
        if (!usedColors.has(candidate)) {
          selectedColor = candidate;
          break;
        }
      }
      usedColors.add(selectedColor);
    }

    colorByDomain.set(domain, selectedColor);
  }

  return colorByDomain;
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
  const runRenderFixPass = async () => {
    await tabGroupsUpdate(groupId, groupProperties);

    await sleep(GROUP_RENDER_FIX_TOGGLE_DELAY_MS);
    await tabGroupsUpdate(groupId, { collapsed: true });

    await sleep(GROUP_RENDER_FIX_TOGGLE_DELAY_MS);
    await tabGroupsUpdate(groupId, { collapsed: false });

    await sleep(GROUP_RENDER_FIX_TOGGLE_DELAY_MS);
    await tabGroupsUpdate(groupId, groupProperties);

    if (collapseGroups) {
      await sleep(GROUP_RENDER_FIX_TOGGLE_DELAY_MS);
      await tabGroupsUpdate(groupId, { collapsed: true });
    }
  };

  await runRenderFixPass();

  for (let i = 0; i < GROUP_RENDER_FIX_RETRY_DELAYS_MS.length; i += 1) {
    const delayMs = GROUP_RENDER_FIX_RETRY_DELAYS_MS[i];
    setTimeout(() => {
      runRenderFixPass().catch(() => {
        // Ignore delayed render-fix failure.
      });
    }, delayMs);
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

function findExistingGroupIdForDomain(tabs, domain, targetTabId) {
  const countsByGroupId = new Map();

  for (let i = 0; i < tabs.length; i += 1) {
    const tab = tabs[i];
    if (!tab || typeof tab.id !== "number" || tab.id === targetTabId) {
      continue;
    }
    if (typeof tab.groupId !== "number" || tab.groupId < 0) {
      continue;
    }

    if (shouldIgnoreUrl(tab.url)) {
      continue;
    }

    const tabDomain = getDomainFromUrl(tab.url);
    if (!tabDomain || tabDomain !== domain) {
      continue;
    }

    const nextCount = (countsByGroupId.get(tab.groupId) || 0) + 1;
    countsByGroupId.set(tab.groupId, nextCount);
  }

  let selectedGroupId = -1;
  let maxCount = 0;
  const entries = Array.from(countsByGroupId.entries());
  for (let i = 0; i < entries.length; i += 1) {
    const groupId = entries[i][0];
    const count = entries[i][1];
    if (count > maxCount) {
      maxCount = count;
      selectedGroupId = groupId;
    }
  }

  return selectedGroupId;
}

async function tryAttachTabToExistingDomainGroup(tabId, windowId) {
  if (typeof tabId !== "number" || tabId < 0) {
    return { attached: false, skipped: true, reason: "invalid-tab" };
  }
  if (typeof windowId !== "number" || windowId < 0) {
    return { attached: false, skipped: true, reason: "invalid-window" };
  }

  const options = await getOptions();
  if (!options.autoGroup) {
    return { attached: false, skipped: true, reason: "auto-disabled" };
  }

  const tab = await tabsGet(tabId);
  if (!tab) {
    return { attached: false, skipped: true, reason: "missing-tab" };
  }

  if (tab.groupId !== -1) {
    return { attached: false, skipped: true, reason: "already-grouped" };
  }
  if (!options.includePinned && tab.pinned) {
    return { attached: false, skipped: true, reason: "pinned-excluded" };
  }
  if (shouldIgnoreUrl(tab.url)) {
    return { attached: false, skipped: true, reason: "ignored-url" };
  }

  const domain = getDomainFromUrl(tab.url);
  if (!domain) {
    return { attached: false, skipped: true, reason: "invalid-domain" };
  }

  const windowTabs = await tabsQuery({ windowId });
  const existingGroupId = findExistingGroupIdForDomain(windowTabs, domain, tabId);
  if (existingGroupId < 0) {
    return { attached: false, skipped: true, reason: "no-existing-group" };
  }

  const groupTitle = buildGroupTitle(domain, tab.title);
  await tabsGroup({ groupId: existingGroupId, tabIds: [tabId] });
  await tabGroupsUpdate(existingGroupId, { title: groupTitle });
  return {
    attached: true,
    skipped: false,
    groupId: existingGroupId,
    domain
  };
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
    const tabsById = new Map();
    for (let i = 0; i < tabs.length; i += 1) {
      const tab = tabs[i];
      if (tab && typeof tab.id === "number") {
        tabsById.set(tab.id, tab);
      }
    }

    const domainBuckets = groupTabsByDomain(tabs, options);
    const domainEntries = Array.from(domainBuckets.entries());
    const distinctColorByDomain = buildDistinctColorsByDomain(domainBuckets.keys());

    let updatedGroups = 0;
    for (let i = 0; i < domainEntries.length; i += 1) {
      const domain = domainEntries[i][0];
      const tabIds = domainEntries[i][1];
      if (!tabIds || tabIds.length < MIN_TABS_PER_GROUP) {
        continue;
      }

      try {
        const groupId = await tabsGroup({ tabIds });
        const color = distinctColorByDomain.get(domain) || getColorForDomain(domain);
        const representativeTab = tabsById.get(tabIds[0]);
        const groupTitle = buildGroupTitle(domain, representativeTab ? representativeTab.title : "");
        const groupProperties = {
          title: groupTitle,
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

async function triggerGroupForLastFocusedWindow() {
  const focusedWindow = await windowsGetLastFocused({ populate: false });
  const targetWindowId = focusedWindow && typeof focusedWindow.id === "number" ? focusedWindow.id : -1;

  if (targetWindowId < 0) {
    return { updatedGroups: 0, skipped: true, reason: "invalid-window" };
  }

  clearDebounce(targetWindowId);
  return regroupWindowByDomain(targetWindowId, true);
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

  if (Object.prototype.hasOwnProperty.call(changeInfo, "url") || changeInfo.status === "complete") {
    tryAttachTabToExistingDomainGroup(tabId, tab.windowId).catch(() => {
      // Ignore fast-path classification failure.
    });
  }

  scheduleAutoRegroup(tab.windowId).catch(() => {
    // Ignore schedule failure.
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab || typeof tab.id !== "number" || tab.id < 0) {
    return;
  }
  if (typeof tab.windowId !== "number" || tab.windowId < 0) {
    return;
  }

  tryAttachTabToExistingDomainGroup(tab.id, tab.windowId).catch(() => {
    // Ignore fast-path classification failure.
  });

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

chrome.commands.onCommand.addListener((command) => {
  if (command !== "GROUP_NOW") {
    return;
  }

  triggerGroupForLastFocusedWindow().catch(() => {
    // Ignore command trigger failure.
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
