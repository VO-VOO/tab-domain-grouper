# Tab Domain Grouper

A Manifest V3 Chrome extension that groups tabs by domain with stable colors.

## Features

- Group tabs by `hostname` in the current window.
- Create a tab group only when a domain has at least 2 tabs.
- Auto-attach a newly created tab to an existing same-domain group when available.
- Prefer distinct colors across groups in the same window (reuse only after palette is exhausted).
- Use a compact group marker with locale preference: mainland China sites prefer first Han character, overseas sites prefer domain initial.
- Support manual actions from popup:
  - Group current window
  - Ungroup current window
  - Toggle auto group
- Support keyboard trigger: press `Ctrl+G` (`Command+G` on macOS) to regroup the focused window immediately.
- Persist behavior options via `chrome.storage.sync`.
- Debounce tab events per window to avoid jitter during frequent updates.

## Project Files

- `manifest.json`
- `service-worker.js`
- `popup.html`
- `popup.js`
- `options.html`
- `options.js`
- `docs/DEVELOPMENT.md`

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder.

## Usage

1. Open some regular web tabs in one window.
2. Click the extension icon.
3. Use one of the popup actions:
   - **Group current window**
   - **Ungroup current window**
   - **Toggle auto**
4. Open options page to change behavior defaults.

### Keyboard Shortcut

- Press `Ctrl+G` (`Command+G` on macOS) to trigger an immediate regroup for the focused browser window.
- If Chrome reports a shortcut conflict, set it manually at `chrome://extensions/shortcuts` for **Tab Domain Grouper**.

## Options

Default values:

```json
{
  "autoGroup": true,
  "includePinned": false,
  "ignoreGrouped": true,
  "collapseGroups": false
}
```

- `autoGroup`: auto regroup on tab updates/creation/removal.
- `includePinned`: include pinned tabs in grouping.
- `ignoreGrouped`: skip tabs already in a group.
- `collapseGroups`: collapse groups after regroup.

## Ignored URL Prefixes

These tabs are skipped:

- `chrome://`
- `edge://`
- `about:`
- `file://`
- `chrome-extension://`
- `view-source:`

## Manual Verification Checklist

- Grouping creates domain-based groups.
- Single-tab domains are not grouped.
- Groups in the same window use different colors whenever possible.
- Group title follows locale preference (mainland: Han first, overseas: domain initial first).
- Manual group and ungroup actions work from popup.
- Option toggles persist and take effect.
- Already grouped tabs are unchanged when `ignoreGrouped = true`.
- Special URL prefixes are ignored.
- Frequent tab updates do not cause obvious jitter.
