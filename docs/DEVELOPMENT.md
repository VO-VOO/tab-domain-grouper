# Tab Domain Grouper 开发文档

## 1. 项目目标

实现一个基于 Manifest V3 的 Chrome 扩展，使用 `chrome.tabs` + `chrome.tabGroups` 按域名自动分组，并提供手动重分组和可配置行为。

核心目标：

- 按域名自动分组
- 同域名同颜色（颜色可复现）
- 分组仅显示颜色（标题留空，节省空间）
- 可手动触发重新分组
- 可在 options 设置自动分组与分组细节
- 在 service worker 中实现去抖，避免 `tabs.onUpdated` 高频触发抖动

## 2. 文件结构

计划文件如下：

- `manifest.json`
- `service-worker.js`
- `popup.html`
- `popup.js`
- `options.html`
- `options.js`
- `README.md`
- `docs/DEVELOPMENT.md`

## 3. 权限与最小化策略

`manifest.json` 仅使用必要权限：

- `tabs`：读取 tab 信息（URL、标题、windowId、groupId、pinned）并执行分组
- `tabGroups`：更新组标题、颜色、折叠状态
- `storage`：保存 options

不引入额外权限：

- 不使用 `host_permissions`
- 不使用 `activeTab`
- 不使用 `scripting`
- 去抖优先用 `setTimeout`，不增加 `alarms` 权限

## 4. 配置项（Options）

默认配置：

```json
{
  "autoGroup": true,
  "includePinned": false,
  "ignoreGrouped": true,
  "collapseGroups": false
}
```

字段说明：

- `autoGroup`：是否自动分组
- `includePinned`：是否把 pinned 标签页纳入分组
- `ignoreGrouped`：是否忽略已在组内的标签页（默认 true）
- `collapseGroups`：分组完成后是否折叠

## 5. 分组规则

1. 仅处理当前窗口标签页。
2. 默认只处理 `groupId === -1`（未分组）以避免破坏用户已有分组。
3. 若 `includePinned` 为 false，跳过 `pinned === true`。
4. 解析 URL 获取 `hostname` 作为 domain。
5. 仅当同一 domain 的 tabs 数量 >= 2 时才创建分组。
6. 分组标题固定为空字符串，仅显示颜色。

## 6. URL 过滤规则

以下 URL 直接忽略：

- 空 URL
- `chrome://`
- `edge://`
- `about:`
- `file://`
- `chrome-extension://`
- `view-source:`

## 7. 颜色映射策略

使用 domain 的稳定 hash 映射到固定调色板，保证同域名同颜色。

可用颜色枚举：

- `grey`
- `blue`
- `red`
- `yellow`
- `green`
- `pink`
- `purple`
- `cyan`
- `orange`

默认映射策略中不使用 `grey` 作为常规目标色，以避免与 Chrome 145 灰色芯片表现混淆。

## 8. Chrome 145 渲染问题规避

在创建组并执行 `chrome.tabGroups.update(groupId, { title, color })` 后，执行一次程序化刷新：

1. `collapsed = true`
2. `collapsed = false`

如果 `collapseGroups = true`，在刷新完成后再设置最终 `collapsed = true`。

## 9. 事件与去抖策略（Service Worker）

监听事件：

- `chrome.tabs.onUpdated`
- `chrome.tabs.onCreated`
- `chrome.tabs.onRemoved`

去抖策略：

- 以 `windowId` 为粒度维护定时器
- 新事件到来时重置该窗口定时器
- 静默一段时间后执行一次分组
- 手动触发（popup 按钮）可直接执行，不走长延迟

## 10. Popup 交互

`popup` 提供三个操作：

- `Group current window`
- `Ungroup current window`
- `Toggle auto`

按钮通过消息发送给 service worker 执行。

## 11. 开发顺序

1. 完成 `manifest.json`
2. 实现 `service-worker.js`（配置加载、筛选、分组、颜色、去抖、消息处理）
3. 实现 `popup.html/js`
4. 实现 `options.html/js`
5. 编写 `README.md`（安装与调试步骤）
6. 本地手工验证关键场景

## 12. 验收清单

- 可按域名分组
- 同域名颜色一致且可复现
- 组标题为空，仅显示颜色
- 可手动重新分组
- Options 四个开关生效
- 默认不影响已分组 tabs
- 特殊 URL 被忽略
- 高频更新下无明显抖动
- Chrome 145 下颜色/标题刷新稳定
