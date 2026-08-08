# 工作台嵌入框架 + 接入标准文档 Implementation Plan

> 历史实施计划，不是接入规范。当前唯一权威规范是 `docs/接入标准.md`；跨域与 iframe 鉴权按现行 handoff/分区会话方案执行。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 主站工作台支持本地/嵌入双视图（点击子项目在主区域 iframe 渲染，侧边栏保留），实现登录页 redirect 回跳协议，并产出面向第三方业务方的《接入标准》文档。

**Architecture:** `static/index.html` 增加 iframe 容器与返回按钮，`static/app.js` 用 `state.view` 切换本地/嵌入视图，`design-system/styles.css` 用 `.embed-view` class 控制显隐与布局，`worker.js` 在返回 `/login` 时注入 redirect 白名单（来源 `apps.json`），`static/login.html` 登录成功后校验并回跳。子项目本期不改。

**Tech Stack:** 零依赖原生 HTML/CSS/JS，Cloudflare Worker（wrangler），CDP headless Chrome 验证（项目无单元测试框架）。

## Global Constraints

- 前端仅用原生 HTML/CSS/JS，无框架、无构建步骤。
- 静态资源版本号统一递增：本期 `?v=2` → `?v=4`（index.html、login.html 中 `styles.css`/`components.js`/`app.js` 三处引用）。部署到 `www.kypher72.indevs.in`。
- 嵌入 URL 约定：`<子项目URL>?embed=1`（已有 query 则 `&embed=1`）。
- postMessage 协议固定：消息体 `{ source:'kypher-embed', type:'ready'|'title'|'exit', title? }`；接收方校验 `event.source` 与 `event.origin`。
- login redirect 白名单来源：`apps.json` 中 url 非 `/` 的条目 host（去端口）。占位符 `__REDIRECT_ALLOWLIST__`。
- 部署需走代理：`export http_proxy="http://127.0.0.1:10808" https_proxy="http://127.0.0.1:10808"`；命令 `npx wrangler deploy --domains www.kypher72.indevs.in`。
- 本地验证：`wrangler dev --port 8787`（注意 8787 可能已被占用，先 `pgrep -fl wrangler` 检查）；CDP 脚本在 `/var/folders/bw/qn56_rh528v26gdqp634rbk40000gn/T/opencode/`。
- 本地登录 cookie：使用仅存放在 `.dev.vars` 的临时测试密码请求 `/api/auth/login`，取 `Set-Cookie` 中 `calpher_auth=` 值；不要把真实密码写进计划、日志或仓库文件。
- 每次改静态资源后递增 `?v=`，防止用户浏览器缓存旧文件（`assets/styles.css` 缓存头 `public, max-age=3600`）。

---

### Task 1: index.html — 返回按钮 + iframe 容器骨架

**Files:**
- Modify: `static/index.html`

**Interfaces:**
- Produces: `#backBtn`（返回按钮）、`#pageTitleMain`（page-title h1，供 JS 改标题）、`#embedHost` 容器（含 `#embedTitle` / `#embedOpen` / `#embedLoading` / `#embedFrame`），后续任务据此驱动。
- Consumes: 现有 SVG sprite 的 `i-chevron` symbol。

- [ ] **Step 1: 给 page-title h1 加 id，并在 topbar 加返回按钮**

找到 `.topbar` 中 `<div class="page-title">` 那行，改为在它前面插入返回按钮、给 h1 加 id：

```html
<header class="topbar">
  <button id="backBtn" class="round-btn back-btn" aria-label="返回工作台" title="返回工作台" hidden><svg><use href="#i-chevron"/></svg></button>
  <div class="page-title"><h1 id="pageTitleMain">个人工作台</h1><p>统一接入 · 共享登录 · 独立部署</p></div>
```

注意：`#backBtn` 是 `.round-btn`，移动端 topbar 布局 `grid-template-columns: 44px minmax(0, 1fr) auto` 中它是第一个子元素（在 burger 之前）。回退策略：把 backBtn 放在 page-title 之前但隐藏时不影响布局——`.back-btn { display:none }`，仅在嵌入视图显示（Task 2 的 CSS 控制）。

- [ ] **Step 2: 在 `.core` 末尾（`.workspace-grid` 之后）加 embedHost 容器**

`.workspace-grid` 闭合 `</div>` 之后、`</section>` 之前插入：

```html
<div id="embedHost" class="embed-host" hidden>
  <div class="embed-bar">
    <span id="embedTitle" class="embed-title">加载中…</span>
    <a id="embedOpen" class="embed-open" href="#" target="_blank" rel="noopener">在新窗口打开</a>
  </div>
  <div class="embed-frame">
    <div id="embedLoading" class="embed-loading">正在加载子项目…</div>
    <iframe id="embedFrame" class="embed-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox" title="子项目"></iframe>
  </div>
</div>
```

- [ ] **Step 3: 本地确认 HTML 结构**

Run:
```bash
curl -s http://127.0.0.1:8787/ -H 'Cookie: calpher_auth=<cookie>' | grep -c 'embedHost\|embedFrame\|backBtn\|pageTitleMain'
```
Expected: 4（4 个 id 都存在）。若 wrangler dev 未运行，先 `npx wrangler dev --port 8787 > /tmp/wb-dev.log 2>&1 &`。

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: index.html 增加嵌入视图容器与返回按钮骨架"
```

---

### Task 2: styles.css — 嵌入视图布局与返回按钮样式

**Files:**
- Modify: `design-system/styles.css`

**Interfaces:**
- Produces: `.embed-view` 控制类（加在 `.app-shell` 上）、`.embed-host`/`.embed-bar`/`.embed-title`/`.embed-open`/`.embed-frame`/`.embed-iframe`/`.embed-loading`/`.back-btn` 样式、移动端嵌入适配。
- Consumes: Task 1 的 DOM id/class；现有 `:root` 变量 `--accent-*`、`var(--green)`、`var(--line-bright)`。

- [ ] **Step 1: 在 `.workspace-grid` 相关样式块后追加嵌入容器样式**

```css
/* 嵌入视图 */
.back-btn { display: none; }
.back-btn svg { transform: rotate(180deg); }
.embed-host { display: none; flex-direction: column; min-height: 0; }
.embed-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 2px 10px; }
.embed-title { font-size: 12px; color: #8f9894; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.embed-open { font-size: 11px; color: var(--accent-300); text-decoration: none; white-space: nowrap; }
.embed-open:hover { text-decoration: underline; }
.embed-frame { position: relative; flex: 1; min-height: 0; border-radius: 17px; overflow: hidden; border: 1px solid rgba(255,255,255,.1); background: #fff; }
.embed-iframe { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
.embed-loading { position: absolute; inset: 0; display: grid; place-items: center; color: #8f9894; font-size: 12px; background: rgba(5,9,7,.6); z-index: 2; }

/* 嵌入视图状态（app.js 在 .app-shell 上切换 class） */
.app-shell.embed-view .back-btn { display: grid; }
.app-shell.embed-view .metric-grid, .app-shell.embed-view .workspace-grid, .app-shell.embed-view .search-box { display: none; }
.app-shell.embed-view .embed-host { display: flex; }
.app-shell.embed-view .core { grid-template-rows: 70px minmax(0, 1fr); }
```

- [ ] **Step 2: 移动端适配（在 `@media (max-width: 1180px)` 块内追加）**

```css
  .app-shell.embed-view .core { grid-template-rows: auto minmax(0, 1fr); }
  .app-shell.embed-view .details-panel { display: none; }
  .app-shell.embed-view .topbar { grid-template-columns: 44px 44px minmax(0, 1fr) auto; }
  .embed-frame { border-radius: 14px; }
```

- [ ] **Step 3: `max-height: 820px` 覆盖**（在该 media query 内追加，避免 128px 概览行残留）

```css
  .app-shell.embed-view .core { grid-template-rows: 58px minmax(0, 1fr); }
```

- [ ] **Step 4: 浅色主题下 iframe 容器边框**

在 `html[data-theme="light"]` 区块末尾追加：

```css
html[data-theme="light"] .embed-frame { border-color: rgba(35,70,53,.14); background: #fff; }
html[data-theme="light"] .embed-title { color: #75827b; }
```

- [ ] **Step 5: 验证 CSS 语法与加载**

Run:
```bash
curl -s http://127.0.0.1:8787/assets/styles.css | grep -c 'embed-view\|embed-host\|back-btn'
```
Expected: ≥ 5（新规则都在）。wrangler dev 需已热重载。

- [ ] **Step 6: Commit**

```bash
git add design-system/styles.css
git commit -m "feat: 嵌入视图布局与返回按钮样式（含移动端适配）"
```

---

### Task 3: app.js — 本地/嵌入视图状态机与交互

**Files:**
- Modify: `static/app.js`

**Interfaces:**
- Consumes: Task 1 DOM（`#backBtn`/`#pageTitleMain`/`#embedHost`/`#embedFrame`/`#embedTitle`/`#embedOpen`/`#embedLoading`）；现有 `state.apps`、`$()`、`openApp()`、`selectDetail()`。
- Produces: `state.view`（`{mode:'local'}` 或 `{mode:'embed', id}`）、`enterEmbed(id)`、`exitEmbed()`、`embedUrl(app)`。`openApp` 保留（逃生用）。

- [ ] **Step 1: 新增嵌入 URL 构造与视图函数**

在 `openApp` 函数之后追加：

```js
function embedUrl(app) {
  return app.url + (app.url.includes('?') ? '&' : '?') + 'embed=1';
}

function enterEmbed(id) {
  const app = state.apps[id];
  if (!app || !app.url || app.url === '/') return;
  state.view = { mode: 'embed', id };
  $('embedOpen').href = app.url;
  $('embedTitle').textContent = app.name;
  $('pageTitleMain').textContent = app.name;
  $('embedLoading').style.display = 'grid';
  $('embedFrame').src = embedUrl(app);
  document.getElementById('appShell').classList.add('embed-view');
  selectDetail(id);
}

function exitEmbed() {
  state.view = { mode: 'local' };
  $('embedFrame').removeAttribute('src');
  $('embedTitle').textContent = '加载中…';
  document.getElementById('appShell').classList.remove('embed-view');
  $('pageTitleMain').textContent = '个人工作台';
}
```

注意：`state` 声明改为 `{ apps: {}, user: null, selected: 'workbench', view: { mode: 'local' } }`。

- [ ] **Step 2: 改造点击行为（导航/队列/项目卡）**

`renderNav` 中 nav-item click handler 改为：

```js
btn.addEventListener('click', () => {
  const id = btn.dataset.id;
  selectDetail(id);
  nav.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
  closeDrawer();
  const app = state.apps[id];
  if (app && app.url && app.url !== '/') { enterEmbed(id); } else { exitEmbed(); }
});
```

`renderProjectList` 中 queue-item click handler 改为（在 `openApp` 调用处替换）：

```js
list.querySelectorAll('.queue-item').forEach((btn) => btn.addEventListener('click', () => {
  const id = btn.dataset.id;
  const app = state.apps[id];
  selectDetail(id);
  closeDrawer();
  if (app && app.url && app.url !== '/') { enterEmbed(id); } else { exitEmbed(); }
}));
```

`renderProjectGrid` 中 project-card 渲染改为阻止默认跳转并进嵌入（保留 href 供逃生）：

```js
return `<a class="project-card" href="${app.url}" target="_blank" rel="noopener" data-id="${id}">
  <div><div class="pc-head"><span class="pc-icon">${icon}</span><h4>${app.name}</h4></div>
  <p>${app.description || ''}</p></div>
  <div class="pc-url">${app.url}</div>
</a>`;
```
并在绑定处改为：

```js
grid.querySelectorAll('.project-card').forEach((card) => card.addEventListener('click', (e) => {
  e.preventDefault();
  const id = card.dataset.id;
  const app = state.apps[id];
  selectDetail(id);
  if (app && app.url && app.url !== '/') { enterEmbed(id); } else { exitEmbed(); }
}));
```

- [ ] **Step 3: 绑定返回按钮 + 详情面板「打开项目」改为进入嵌入**

在事件绑定区，把 `openWorkbenchBtn` 的 handler 改为：

```js
$('openWorkbenchBtn').addEventListener('click', () => {
  const app = state.apps[state.selected];
  if (app && app.url && app.url !== '/') { enterEmbed(state.selected); return; }
  exitEmbed();
});
```

并在其后追加：

```js
$('backBtn').addEventListener('click', exitEmbed);
```

这样详情面板主按钮语义统一为「在主区域渲染」；逃生仍走 `.embed-open` 链接。

- [ ] **Step 4: 语法检查**

Run:
```bash
node --check static/app.js
```
Expected: no output（语法正确）。

- [ ] **Step 5: 本地 CDP 验证视图切换**

写 CDP 脚本 `/var/folders/bw/qn56_rh528v26gdqp634rbk40000gn/T/opencode/wb-embed.js`（结构参照 `wb-v2-verify.js`：`--remote-debugging-port=9235`，注入 cookie，`Emulation.setDeviceMetricsOverride` 1440×900）：导航后执行：

```js
await ev("document.querySelectorAll('.project-card')[1].click()");
// 等待后断言
await ev("[document.getElementById('appShell').className, document.getElementById('embedFrame').src, document.getElementById('pageTitleMain').textContent]")
```
Expected: `['app-shell embed-view', '<socks url>?embed=1', '代理切换台']`，且 `.metric-grid` display 为 none。

再执行 `await ev("document.getElementById('backBtn').click()")`，断言 classList 无 `embed-view`、`embedFrame.src` 为空。

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "feat: app.js 本地/嵌入视图状态机与点击交互"
```

---

### Task 4: app.js — postMessage 协议与安全校验

**Files:**
- Modify: `static/app.js`

**Interfaces:**
- Consumes: Task 3 的 `state.view`/`enterEmbed`/`exitEmbed`、`#embedFrame`。
- Produces: 全局 `message` 监听；支持 `ready`/`title`/`exit` 三种消息；iframe `load` 也隐藏 loading。

- [ ] **Step 1: 添加 message 监听与 iframe load 处理**

在 Task 3 的 `exitEmbed` 函数后追加：

```js
const embedFrameEl = $('embedFrame');
embedFrameEl.addEventListener('load', () => { $('embedLoading').style.display = 'none'; });

window.addEventListener('message', (event) => {
  const v = state.view;
  if (!v || v.mode !== 'embed') return;
  const app = state.apps[v.id];
  if (!app || event.source !== embedFrameEl.contentWindow) return;
  const expected = app.url && app.url.startsWith('http') ? new URL(app.url).origin : location.origin;
  if (event.origin !== expected) return;
  const d = event.data;
  if (!d || d.source !== 'kypher-embed') return;
  if (d.type === 'ready') {
    $('embedLoading').style.display = 'none';
  } else if (d.type === 'title' && d.title) {
    $('pageTitleMain').textContent = d.title;
    $('embedTitle').textContent = d.title;
  } else if (d.type === 'exit') {
    exitEmbed();
  }
});
```

注意：`message` 监听是页面级单次注册；若子项目页面重定向多次，`event.source` 仍是当前 iframe 的 contentWindow。

- [ ] **Step 2: 语法检查**

Run: `node --check static/app.js`（Expected: 无输出）。

- [ ] **Step 3: 加本地测试钩子（仅 localhost 暴露，生产不挂载）**

`static/app.js` 模块末尾（`})();` 之前）追加：

```js
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__kypherEmbedTest__ = { enterEmbed, exitEmbed, state };
}
```

原因：`state`/`enterEmbed` 在 IIFE 闭包内，CDP 无法直接访问；该钩子只在本地调试宿主暴露，生产域名不挂载。

- [ ] **Step 4: 用本地测试页验证 postMessage**

在 `/var/folders/bw/qn56_rh528v26gdqp634rbk40000gn/T/opencode/embed-test.html` 写一个测试页：

```html
<!doctype html><html><body><script>
  window.parent.postMessage({ source: 'kypher-embed', type: 'ready' }, '*');
  setTimeout(() => window.parent.postMessage({ source: 'kypher-embed', type: 'title', title: '测试子项目' }, '*'), 500);
</script></body></html>
```

起本地服务：`python3 -m http.server 9001 --directory /var/folders/bw/qn56_rh528v26gdqp634rbk40000gn/T/opencode/`。

CDP（`--remote-debugging-port=9235`，注入 cookie，桌面 1440×900）执行：

```js
await ev("window.__kypherEmbedTest__.state.apps['test'] = { name:'测试子项目', url:'http://localhost:9001/embed-test.html' }")
await ev("window.__kypherEmbedTest__.enterEmbed('test')")
// 等待 1.5s
await ev("[document.getElementById('pageTitleMain').textContent, document.getElementById('embedLoading').style.display, document.getElementById('embedTitle').textContent]")
```
Expected: `['测试子项目', 'none', '测试子项目']`（title 消息生效、loading 被 ready 隐藏）。

再验证 `exit` 消息：改测试页临时发 `{ type:'exit' }`（改 embed-test.html 内容），重载后断言 `appShell` 无 `embed-view` class。

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "feat: app.js postMessage 协议（ready/title/exit）与来源校验"
```

---

### Task 5: worker.js — /login 注入 redirect 白名单

**Files:**
- Modify: `worker.js`

**Interfaces:**
- Consumes: `appsJson`（Text 导入的 JSON 字符串）。
- Produces: 返回 `/login` 时替换 `loginHtml` 中的 `__REDIRECT_ALLOWLIST__` 为 JSON 数组（`apps.json` 中 url 非 `/` 的 host 列表，去端口）。

- [ ] **Step 1: 修改 /login 路由**

现 `/login` 分支：

```js
if (method === 'GET' && url.pathname === '/login') {
  return new Response(loginHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
```

改为：

```js
if (method === 'GET' && url.pathname === '/login') {
  const registry = JSON.parse(appsJson);
  const allowlist = Object.values(registry)
    .map((a) => a.url)
    .filter((u) => u && u !== '/' && u.startsWith('http'))
    .map((u) => { try { return new URL(u).host; } catch (e) { return null; } })
    .filter(Boolean);
  const html = loginHtml.replace('__REDIRECT_ALLOWLIST__', JSON.stringify(allowlist));
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
```

- [ ] **Step 2: 验证注入**

Run:
```bash
curl -s http://127.0.0.1:8787/login | grep -o '__REDIRECT_ALLOWLIST__\|\[.*kypher.*\]'
```
Expected: 无 `__REDIRECT_ALLOWLIST__` 占位符残留；出现含 `socks.kypher.kdns.fr` 与 `submgr.kypher.ccwu.cc` 的 JSON 数组。

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: /login 注入 redirect 白名单（注册表域名）"
```

---

### Task 6: login.html — redirect 参数读取与安全回跳

**Files:**
- Modify: `static/login.html`

**Interfaces:**
- Consumes: Task 5 注入的 `__REDIRECT_ALLOWLIST__`（JSON 数组，替换为 `var REDIRECT_ALLOWLIST = [...]`）。
- Produces: 登录成功后按 `?redirect=` 安全回跳（站内路径或白名单 host，否则回 `/`）。

- [ ] **Step 1: 在 login 页面脚本顶部注入白名单**

`<script>` 块（现有 IIFE 之前）加：

```html
<script>
  var REDIRECT_ALLOWLIST = __REDIRECT_ALLOWLIST__;
  function safeRedirect(raw) {
    if (!raw) return '/';
    try {
      var u = new URL(raw, location.origin);
      if (u.origin === location.origin) return raw;
      if (u.protocol === 'https:' && REDIRECT_ALLOWLIST.indexOf(u.host) !== -1) return raw;
    } catch (e) {}
    return '/';
  }
</script>
```

- [ ] **Step 2: 登录成功处改为安全回跳**

现有 `location.href = '/';`（第 58 行）改为：

```js
var target = safeRedirect(new URLSearchParams(location.search).get('redirect'));
location.href = target;
```

- [ ] **Step 3: 本地验证（合法与非法 redirect）**

CDP 或 curl 验证：
1. 打开 `/login?redirect=https%3A%2F%2Fsocks.kypher.kdns.fr%2F`，登录成功后跳 `https://socks.kypher.kdns.fr/`。
2. 打开 `/login?redirect=https%3A%2F%2Fevil.example.com%2F`，登录成功后回落 `/`。

（CDP 验证方式：注入 cookie 前先导航 `/login?redirect=...`，填表提交，等 1s 后读 `location.href`。）

- [ ] **Step 4: Commit**

```bash
git add static/login.html
git commit -m "feat: 登录页支持 redirect 安全回跳（注册表白名单）"
```

---

### Task 7: docs/接入标准.md — 核心交付物文档

**Files:**
- Create: `docs/接入标准.md`

**Interfaces:**
- Consumes: 本 spec 的「接入标准文档」章节；现有 `apps.json` 字段语义。
- Produces: 面向第三方业务方的完整接入指引（注册 → 布局 → 嵌入改造 → 登录 → 统一鉴权长期目标 → 检查清单）。

- [ ] **Step 1: 编写文档**

按 spec「三、接入标准文档」的 10 节结构撰写完整内容，至少包含：

1. 接入总览与两种接入模式（共享登录 / 自建登录，各自适用场景）。
2. 注册：`apps.json` 字段表（`id`/`name`/`url`/`icon`/`description`）与约束（url 需 HTTPS、可被 iframe 加载）。
3. 布局：注册后出现在侧边栏导航、接入项目列表、项目一览卡、详情面板；点击后在核心区 iframe 渲染（`?embed=1`）的行为 + ASCII 布局图。
4. 嵌入模式改造：`body[data-embed]` CSS 约定 + 示例代码（检测 `?embed=1` 隐藏自身顶栏/侧边栏/页脚）。
5. 会话 Cookie：跨域 iframe 需 `SameSite=None; Secure`，附第三方 Cookie 现状说明；长期方案迁父域后同站。
6. postMessage 协议：`kypher-embed` 消息规范 + 双向 origin 校验 + 主站白名单说明。
7. 登录跳转（接入模式）：未登录 → `https://www.kypher72.indevs.in/login?redirect=<子站URL>` → 回跳；open-redirect 防护规则。
8. 统一鉴权长期目标：迁 `kypher72.indevs.in` 父域 + 复用 `auth/auth.js`，一处登录处处免登。
9. 适配检查清单（注册→嵌入→隐藏导航→登录→postMessage 逐项自检）。

- [ ] **Step 2: 通读检查**

逐节确认：无 TBD/占位符；字段名与 `apps.json` 实际一致；URL/域名与实际一致；协议字段名与 Task 4 代码一致（`source:'kypher-embed'`、`type: ready/title/exit`）。

- [ ] **Step 3: Commit**

```bash
git add docs/接入标准.md
git commit -m "docs: 接入标准文档（第三方业务方接入指引）"
```

---

### Task 8: 版本号递增 + 整体验证 + 部署

**Files:**
- Modify: `static/index.html`、`static/login.html`（`?v=3` → `?v=4`，全部引用）

**Interfaces:**
- Consumes: 全部已完成任务。
- Produces: 可部署的主站版本；生产验证通过。

- [ ] **Step 1: 版本号递增**

`static/index.html` 与 `static/login.html` 中所有 `?v=3` 改为 `?v=4`（`styles.css`、`components.js`、`app.js` 引用，共 6 处）。

- [ ] **Step 2: 整体 CDP 验证（桌面 1440×900）**

复跑 `wb-v2-verify.js` 断言原有功能不回归；跑 `wb-embed.js` 断言：点击子项目进入嵌入（iframe src 带 `?embed=1`）、返回恢复、console 0 错误。

- [ ] **Step 3: 移动端验证（375×812）**

断言：抽屉可开、嵌入时 `details-panel` 隐藏、iframe 占满、无水平滚动、返回常驻、console 0 错误。

- [ ] **Step 4: 提交并部署**

```bash
git add -A
git commit -m "feat: 工作台嵌入框架 + 登录 redirect + 接入标准文档（v4）"
export http_proxy="http://127.0.0.1:10808" https_proxy="http://127.0.0.1:10808"
npx wrangler deploy --domains www.kypher72.indevs.in
```

- [ ] **Step 5: 生产验证**

Run:
```bash
export http_proxy="http://127.0.0.1:10808" https_proxy="http://127.0.0.1:10808"
curl -s https://www.kypher72.indevs.in/login | grep -c '__REDIRECT_ALLOWLIST__'   # 期望 0
curl -s https://www.kypher72.indevs.in/login | grep -o 'socks.kypher.kdns.fr'     # 期望出现（白名单注入）
curl -s -b <cookie> https://www.kypher72.indevs.in/ | grep -c 'v=4'               # 期望 3
curl -s https://www.kypher72.indevs.in/assets/styles.css | grep -c 'embed-view'   # 期望 ≥1
```
Expected: 0 / 1 / 3 / ≥1，即白名单注入、版本号生效、新 CSS 上线。
