# Tab Domain Grouper

A Manifest V3 Chrome extension that groups tabs by domain with stable colors.

## Features

- Group tabs by `hostname` in the current window.
- Keep the same domain on the same color via deterministic hash mapping.
- Set group title to domain name.
- Support manual actions from popup:
  - Group current window
  - Ungroup current window
  - Toggle auto group
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
- Same domain gets stable color.
- Group title equals domain.
- Manual group and ungroup actions work from popup.
- Option toggles persist and take effect.
- Already grouped tabs are unchanged when `ignoreGrouped = true`.
- Special URL prefixes are ignored.
- Frequent tab updates do not cause obvious jitter.
