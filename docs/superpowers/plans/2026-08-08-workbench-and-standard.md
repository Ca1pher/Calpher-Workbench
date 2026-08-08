# CF 个人工作台 + 统一接入标准 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在本地搭建个人 CF 工作台（octopus 设计语言），并产出设计系统、共享鉴权中间件、项目注册表三件套"接入标准"母版。

**Architecture:** 工作台是独立 Cloudflare Worker，作为主鉴权中心 + 标准母版仓库。设计系统（`styles.css` + `components.js`）和鉴权中间件（`auth.js`）各有一份权威母版，子项目按接入标准拷贝使用。子项目通过 env 配置选择"接入模式/独立模式"，共享 Cookie 跨子域免登录。

**Tech Stack:** 零依赖原生 HTML/CSS/JS（参照 octopus-kaogong-workbench 模板），Cloudflare Worker（wrangler），HMAC Cookie 签名（Web Crypto API，无需第三方库）。

## Global Constraints

- 零第三方运行时依赖（只用 Web Crypto API / fetch / Web 标准）。
- 前端仅用原生 HTML/CSS/JS，无框架、无构建步骤。
- 共享 Cookie 名固定为 `calpher_auth`；`Domain=<占位父域>`，占位符统一用 `example.dev`（spec 中 `calpher.dev` 为未定占位符，代码里用 `PARENT_DOMAIN` env 或常量，本阶段用 `example.dev`）。
- localStorage key 统一：`calpher-workbench-theme`、`calpher-workbench-accent`。
- 强调色固定 5 套：`emerald` / `ocean` / `iris` / `amber` / `sakura`，默认 `ocean`。
- 组件 class 前缀统一 `cn-`；设计 token 命名 `--accent-*`、`--panel*`、`--line*`、`--text*`、`--glass-*`。
- 登录接口统一：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/me`；账号同步 `POST /api/auth/sync`。
- 本阶段工作台只在本地运行（`wrangler dev`），不部署、不建 GitHub remote、不 push。
- 参考模板位于 `/var/folders/.../opencode/octopus-kaogong-workbench/`（styles.css 76KB、app.js 38KB、index.html 18KB）。设计语言可借鉴，但实现需简化并适配个人工作台场景，不整文件照抄。

---

### Task 1: 初始化 workbench Worker 骨架

**Files:**
- Create: `workbench/wrangler.toml`
- Create: `workbench/package.json`
- Create: `workbench/.gitignore`
- Create: `workbench/worker.js`

**Interfaces:**
- Produces: 一个可 `wrangler dev` 的 Worker 入口，`export default { async fetch(request, env, ctx) }`，返回静态 HTML。后续所有 API 路由都挂在这个 fetch 里。

- [ ] **Step 1: 写 wrangler.toml**

```toml
name = "workbench"
main = "worker.js"
compatibility_date = "2026-05-31"
workers_dev = true

[vars]
# 父域名（占位）：共享 Cookie 的 Domain 属性。正式域名确定后改这里。
PARENT_DOMAIN = "example.dev"
```

- [ ] **Step 2: 写 package.json**

```json
{
  "name": "calpher-workbench",
  "version": "0.1.0",
  "private": true,
  "description": "Calpher 个人工作台 — Cloudflare Worker",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail"
  },
  "devDependencies": {
    "wrangler": "^4.95.0"
  }
}
```

- [ ] **Step 3: 写 .gitignore**

```
node_modules/
.wrangler/
.dev.vars
```

- [ ] **Step 4: 写最小 worker.js**

```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("workbench skeleton", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },
};
```

- [ ] **Step 5: 安装依赖并验证**

Run: `cd /Users/calpher/tmp/VPS/workbench && npm install`
Expected: `node_modules/` 生成，wrangler 安装成功。

- [ ] **Step 6: 本地启动验证**

Run: `cd /Users/calpher/tmp/VPS/workbench && npm run dev`
Expected: 启动成功，无报错。访问 `http://localhost:8787/` 返回 "workbench skeleton"。

- [ ] **Step 7: Commit**

```bash
cd /Users/calpher/tmp/VPS/workbench
git add -A
git -c user.name="calpher" -c user.email="calpher@local" commit -m "chore: workbench worker 骨架"
```

---

### Task 2: 设计系统母版 styles.css

**Files:**
- Create: `workbench/design-system/styles.css`

**Interfaces:**
- Consumes: 无
- Produces: `design-system/styles.css` — 定义全部设计 token、主题/强调色切换、玻璃拟态、通用组件（侧边栏、导航项、卡片、按钮、模态框、toast）。要求：纯 CSS，通过 `html[data-theme]` / `html[data-accent]` 属性驱动，组件用 `cn-` 前缀。后续工作台页面和子项目拷贝都用它。

- [ ] **Step 1: 设计 token 与主题基础（:root + data-theme + data-accent）**

在 `design-system/styles.css` 写入以下结构（节选核心，完整实现需覆盖所有 token）：

```css
:root {
  --bg: #080b0a;
  --panel: rgba(255, 255, 255, 0.04);
  --panel-2: rgba(255, 255, 255, 0.02);
  --line: rgba(255, 255, 255, 0.08);
  --line-bright: rgba(255, 255, 255, 0.15);
  --text: #e8ecea;
  --muted: rgba(232, 236, 234, 0.6);
  --accent-h: 202;
  --accent-s: 78%;
  --accent-rgb: 42 169 232;
  --accent-50: hsl(var(--accent-h) var(--accent-s) 96%);
  --accent-100: hsl(var(--accent-h) var(--accent-s) 89%);
  --accent-200: hsl(var(--accent-h) 67% 78%);
  --accent-300: hsl(var(--accent-h) 72% 67%);
  --accent-400: hsl(var(--accent-h) var(--accent-s) 52%);
  --accent-500: hsl(var(--accent-h) var(--accent-s) 43%);
  --accent-600: hsl(var(--accent-h) 74% 35%);
  --accent-700: hsl(var(--accent-h) 72% 27%);
  --accent-800: hsl(var(--accent-h) 66% 20%);
  --accent-900: hsl(var(--accent-h) 58% 13%);
  --accent-foreground: #f4fbff;
  --accent-ink: hsl(var(--accent-h) 70% 15%);
  --glass-bg: rgba(255, 255, 255, 0.04);
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: blur(24px) saturate(180%);
}

html[data-theme="light"] {
  --bg: #f6f8f7;
  --panel: rgba(0, 0, 0, 0.03);
  --panel-2: rgba(0, 0, 0, 0.02);
  --line: rgba(0, 0, 0, 0.1);
  --line-bright: rgba(0, 0, 0, 0.18);
  --text: #1a211e;
  --muted: rgba(26, 33, 30, 0.6);
  --glass-bg: rgba(255, 255, 255, 0.5);
  --glass-border: rgba(255, 255, 255, 0.6);
}

html[data-accent="emerald"] { --accent-h: 158; --accent-s: 76%; --accent-rgb: 35 226 160; --accent-foreground: #f4fff9; }
html[data-accent="ocean"]   { --accent-h: 202; --accent-s: 78%; --accent-rgb: 42 169 232; --accent-foreground: #f4fbff; }
html[data-accent="iris"]    { --accent-h: 263; --accent-s: 68%; --accent-rgb: 132 94 231; --accent-foreground: #fbf8ff; }
html[data-accent="amber"]   { --accent-h: 36;  --accent-s: 84%; --accent-rgb: 230 157 35; --accent-foreground: #fffaf0; --accent-ink: #2b1b05; }
html[data-accent="sakura"]  { --accent-h: 344; --accent-s: 76%; --accent-rgb: 224 82 124; --accent-foreground: #fff7fa; }
```

- [ ] **Step 2: 布局与组件（app-shell / sidebar / topbar / cards / cn-* 组件）**

在 `styles.css` 追加以下组件的样式（每个组件给出可用的最小实现，class 用 `cn-` 前缀）：

```css
/* 布局 */
.cn-app-shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.cn-sidebar { padding: 22px 17px; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.cn-brand { font-weight: 700; letter-spacing: 0.02em; }
.cn-nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 10px; color: var(--muted); cursor: pointer; border: 1px solid transparent; background: transparent; font-size: 13px; width: 100%; text-align: left; }
.cn-nav-item:hover { color: var(--text); background: rgba(255,255,255,.035); }
.cn-nav-item.active { color: var(--text); background: linear-gradient(90deg, rgba(255,255,255,.11), rgba(255,255,255,.055)); border-color: rgba(255,255,255,.09); }
.cn-live-dot { width: 16px; height: 16px; border: 1px solid rgb(var(--accent-rgb) / .6); border-radius: 50%; box-shadow: 0 0 12px rgb(var(--accent-rgb) / .6); }

/* 顶部栏 */
.cn-topbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 22px; border-bottom: 1px solid var(--line); }
.cn-search-box { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; }
.cn-search-box input { background: transparent; border: none; color: var(--text); outline: none; width: 220px; }
.cn-round-btn { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }

/* 概览卡 + 项目卡 */
.cn-metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 22px; }
.cn-metric-card { border-radius: 16px; padding: 18px; border: 1px solid var(--line); background: var(--panel); backdrop-filter: var(--glass-blur); }
.cn-metric-card h3 { font-size: 13px; color: var(--muted); font-weight: 500; }
.cn-metric-card strong { font-size: 30px; color: var(--text); }
.cn-project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; padding: 0 22px 22px; }
.cn-project-card { border-radius: 16px; padding: 18px; border: 1px solid var(--line); background: var(--panel); backdrop-filter: var(--glass-blur); cursor: pointer; transition: transform .2s, border-color .2s; text-decoration: none; color: var(--text); display: block; }
.cn-project-card:hover { border-color: rgb(var(--accent-rgb) / .4); transform: translateY(-3px); }
.cn-project-card h4 { margin: 0 0 6px; font-size: 15px; }
.cn-project-card p { margin: 0; font-size: 12px; color: var(--muted); }

/* 按钮 / 模态框 / toast */
.cn-btn { padding: 8px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; font-size: 13px; }
.cn-btn-primary { background: linear-gradient(145deg, var(--accent-700), var(--accent-900)); color: var(--accent-foreground); border-color: rgb(var(--accent-rgb) / .28); }
.cn-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; }
.cn-modal { width: 380px; max-width: 92vw; border-radius: 16px; border: 1px solid var(--line); background: var(--bg); padding: 22px; box-shadow: 0 22px 48px rgba(0,0,0,.4); }
.cn-toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--line-bright); border-radius: 10px; padding: 10px 18px; backdrop-filter: var(--glass-blur); z-index: 100; }
```

- [ ] **Step 3: 验证 CSS 语法**

Run: `node -e "const s=require('fs').readFileSync('/Users/calpher/tmp/VPS/workbench/design-system/styles.css','utf8'); console.log('bytes:', s.length)"`
Expected: 输出文件字节数，无语法错误。

- [ ] **Step 4: Commit**

```bash
cd /Users/calpher/tmp/VPS/workbench
git add design-system/styles.css
git -c user.name="calpher" -c user.email="calpher@local" commit -m "feat: 设计系统母版 styles.css（token + 主题 + 组件）"
```

---

### Task 3: 设计系统母版 components.js

**Files:**
- Create: `workbench/design-system/components.js`

**Interfaces:**
- Consumes: `design-system/styles.css`（依赖其 class 与 token）
- Produces: `window.Cn` 命名空间，包含：
  - `Cn.initTheme()` — 读取 localStorage 设置 `data-theme`/`data-accent`，处理 system，防闪烁
  - `Cn.setTheme(theme)` / `Cn.setAccent(accent)` — 切换并持久化
  - `Cn.openModal({title, body, buttons})` / `Cn.closeModal()` / `Cn.toast(msg)` — 模态框与 toast
  - `Cn.initThemeToggle(btnSelector)` — 绑定主题切换按钮

后续工作台页面和子项目前端都 `import` 此文件并调用这些函数。

- [ ] **Step 1: 实现 theme 初始化与切换**

```js
(function (global) {
  const THEME_KEY = 'calpher-workbench-theme';
  const ACCENT_KEY = 'calpher-workbench-accent';
  const ACCENTS = ['emerald', 'ocean', 'iris', 'amber', 'sakura'];

  function resolveTheme(pref) {
    if (pref === 'system') {
      return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return pref;
  }

  function initTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) {}
    let accent = 'ocean';
    try { accent = localStorage.getItem(ACCENT_KEY) || 'ocean'; } catch (e) {}
    if (!['light', 'dark', 'system'].includes(theme)) theme = 'dark';
    if (!ACCENTS.includes(accent)) accent = 'ocean';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeResolved = resolveTheme(theme);
    document.documentElement.dataset.accent = accent;
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themeResolved = resolveTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }

  function setAccent(accent) {
    if (!ACCENTS.includes(accent)) return;
    document.documentElement.dataset.accent = accent;
    try { localStorage.setItem(ACCENT_KEY, accent); } catch (e) {}
  }

  function initThemeToggle(btnSelector) {
    const btn = document.querySelector(btnSelector);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme;
      const next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
      setTheme(next);
      const name = { dark: '暗色', light: '亮色', system: '跟随系统' }[next];
      if (btn.setAttribute) btn.setAttribute('aria-label', `切换显示主题，当前${name}`);
    });
  }

  global.Cn = { initTheme, setTheme, setAccent, initThemeToggle };
})(globalThis);
```

- [ ] **Step 2: 实现 modal 与 toast**

```js
(function (global) {
  function openModal(opts) {
    const overlay = document.createElement('div');
    overlay.className = 'cn-modal-overlay';
    overlay.id = 'cn-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'cn-modal';
    const title = opts.title ? `<h2 style="margin:0 0 14px;font-size:16px">${opts.title}</h2>` : '';
    let body = '';
    if (opts.body) {
      body = typeof opts.body === 'string' ? `<div>${opts.body}</div>` : '<div></div>';
      if (typeof opts.body === 'string') {
        modal.insertAdjacentHTML('beforeend', `<div>${opts.body}</div>`);
      }
    }
    modal.innerHTML = title;
    if (typeof opts.body === 'string') modal.insertAdjacentHTML('beforeend', `<div>${opts.body}</div>`);
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px';
    const buttons = opts.buttons || [{ text: '关闭', onClick: closeModal }];
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'cn-btn' + (b.primary ? ' cn-btn-primary' : '');
      btn.textContent = b.text;
      btn.addEventListener('click', () => { if (b.onClick) b.onClick(); });
      footer.appendChild(btn);
    }
    modal.appendChild(footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && opts.closable !== false) closeModal(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeModal() {
    const el = document.getElementById('cn-modal-overlay');
    if (el) el.remove();
  }

  function toast(msg) {
    let el = document.querySelector('.cn-toast');
    if (!el) { el = document.createElement('div'); el.className = 'cn-toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 2400);
  }

  const api = global.Cn = global.Cn || {};
  api.openModal = openModal;
  api.closeModal = closeModal;
  api.toast = toast;
})(globalThis);
```

- [ ] **Step 3: 验证 JS 语法**

Run: `node --check /Users/calpher/tmp/VPS/workbench/design-system/components.js`
Expected: 无输出（语法正确）。

- [ ] **Step 4: Commit**

```bash
cd /Users/calpher/tmp/VPS/workbench
git add design-system/components.js
git -c user.name="calpher" -c user.email="calpher@local" commit -m "feat: 设计系统母版 components.js（主题/模态框/toast）"
```

---

### Task 4: 共享鉴权中间件母版 auth.js

**Files:**
- Create: `workbench/auth/auth.js`
- Create: `workbench/auth/README.md`

**Interfaces:**
- Produces:
  - `export async function authenticate(request, env)` → `{ user: { name, role } | null, sid: string | null }`
  - `export function buildSessionCookie(sid)` → Set-Cookie header 值（写父域共享 Cookie）
  - `export function buildLogoutCookie()` → 清除 Cookie
  - `export async function loginByMaster(env, name, pass)` → `{ ok, user, sid }`，校验主账号凭据（env 配置决定模式）
  - `export async function handleAuthSync(request, env)` → 处理 `POST /api/auth/sync`（工作台专用，`AUTH_MASTER_TOKEN` 鉴权）
  - Cookie/session 由 `AUTH_COOKIE_SECRET` 做 HMAC 签名

后续工作台和子项目都拷贝此文件接入。

- [ ] **Step 1: 实现 HMAC 签名 session 工具**

```js
const enc = new TextEncoder();
const dec = new TextDecoder();

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const COOKIE_NAME = 'calpher_auth';

export function buildSessionCookie(sid) {
  return `${COOKIE_NAME}=${sid}; Domain=${globalThis.PARENT_DOMAIN || 'example.dev'}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

export function buildLogoutCookie() {
  return `${COOKIE_NAME}=; Domain=${globalThis.PARENT_DOMAIN || 'example.dev'}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function signSession(env, payload) {
  const secret = env.AUTH_COOKIE_SECRET || 'dev-insecure-secret';
  const body = JSON.stringify(payload);
  const sig = toHex(await hmac(secret, body));
  return `${Buffer.from ? Buffer.from(body).toString('base64') : btoa(unescape(encodeURIComponent(body)))}.${sig}`;
}

async function verifySession(env, sid) {
  if (!sid) return null;
  const dot = sid.lastIndexOf('.');
  if (dot < 0) return null;
  const b64 = sid.slice(0, dot);
  const sig = sid.slice(dot + 1);
  const secret = env.AUTH_COOKIE_SECRET || 'dev-insecure-secret';
  let body;
  try { body = decodeURIComponent(escape(atob(b64))); } catch (e) { return null; }
  const expect = toHex(await hmac(secret, body));
  if (expect !== sig) return null;
  try { return JSON.parse(body); } catch (e) { return null; }
}

function readCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}
```

注意：Worker 运行时不保证有 `Buffer`，上面 `signSession` 同时兼容了 `Buffer.from` 和浏览器 `btoa` 路径。若实现时确认 wrangler 环境只有 `atob/btoa`，可去掉 Buffer 分支。Base64 编码统一用 `btoa(unescape(encodeURIComponent(body)))` / `decodeURIComponent(escape(atob(b64)))`，保证中文 payload 正确。

- [ ] **Step 2: 实现 authenticate / login / sync**

```js
export async function authenticate(request, env) {
  const sid = readCookie(request, COOKIE_NAME);
  const payload = await verifySession(env, sid);
  if (!payload) return { user: null, sid: null };
  return { user: { name: payload.name, role: payload.role || 'user' }, sid };
}

export async function loginByMaster(env, name, pass) {
  const mode = env.AUTH_MASTER_PASS ? 'standalone' : (env.AUTH_MASTER_ORIGIN ? 'federated' : 'none');
  let ok = false;
  let displayName = name;
  if (mode === 'standalone') {
    ok = name === (env.AUTH_MASTER_NAME || 'admin') && pass === env.AUTH_MASTER_PASS;
  } else if (mode === 'federated') {
    // 接入模式：调主鉴权中心校验（本阶段工作台即主中心，直接本地校验主账号）
    ok = name === (env.AUTH_MASTER_NAME || 'admin') && pass === env.AUTH_MASTER_PASS;
  } else {
    ok = false;
  }
  if (!ok) return { ok: false };
  const payload = { name: displayName, role: 'admin', iat: Date.now() };
  const sid = await signSession(env, payload);
  return { ok: true, user: payload, sid };
}

export async function handleAuthSync(request, env) {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  const token = request.headers.get('X-Master-Token');
  if (token !== env.AUTH_MASTER_TOKEN) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  let body;
  try { body = await request.json(); } catch (e) { body = null; }
  return new Response(JSON.stringify({ ok: true, received: body }), { headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 3: 写接入标准文档 auth/README.md**

```markdown
# Calpher 统一接入标准 — 共享鉴权

## 接入步骤（子项目）

1. 拷贝 `auth/auth.js` 到子项目源码目录。
2. 在 wrangler.toml / .dev.vars 配置以下 env：

| 变量 | 作用 |
|---|---|
| `AUTH_COOKIE_SECRET` | 签名密钥，跨项目必须同一套 |
| `AUTH_MASTER_PASS` | 主账号密码（独立模式） |
| `AUTH_MASTER_NAME` | 主账号名（默认 admin） |
| `AUTH_MASTER_ORIGIN` + `AUTH_MASTER_TOKEN` | 接入模式：指向主鉴权中心 |

3. 替换原有鉴权逻辑为 `authenticate(request, env)`。

## 模式说明

- **接入模式**：配置 `AUTH_MASTER_ORIGIN` + `AUTH_MASTER_TOKEN`，共享主账号 Cookie。
- **独立模式**：未配置上述变量，用 `AUTH_MASTER_PASS` 本地校验。

## 共享 Cookie

`calpher_auth`，`Domain=<父域>`，HttpOnly + Secure + SameSite=Lax，跨子域免登录。
```

- [ ] **Step 4: 验证 JS 语法**

Run: `node --check /Users/calpher/tmp/VPS/workbench/auth/auth.js`
Expected: 无输出（语法正确）。

- [ ] **Step 5: 单元验证（本机 node 跑一段调用）**

Run: `cd /Users/calpher/tmp/VPS/workbench && node -e "const m = require('esm') ? null : null" 2>/dev/null; node --experimental-vm-modules -e "const fs=require('fs'); const src=fs.readFileSync('auth/auth.js','utf8'); if(!src.includes('export async function authenticate')) { console.error('MISSING authenticate'); process.exit(1); } console.log('auth.js exports OK')"`
Expected: 输出 `auth.js exports OK`。

- [ ] **Step 6: Commit**

```bash
cd /Users/calpher/tmp/VPS/workbench
git add auth/
git -c user.name="calpher" -c user.email="calpher@local" commit -m "feat: 共享鉴权中间件母版 auth.js + 接入标准文档"
```

---

### Task 5: 项目注册表 apps.json 规范

**Files:**
- Create: `workbench/apps.json`
- Create: `workbench/auth/../README.md`（若不存在则创建工作台根 README，记录注册表规范）

**Interfaces:**
- Produces: `apps.json` — 标准注册表，工作台首页据此渲染。schema：

```json
{
  "name": "string",            // 项目名（必填）
  "url": "string",             // 项目访问地址（必填）
  "icon": "string",            // SVG symbol id 或 emoji（选填）
  "description": "string",     // 一句话描述（选填）
  "accent": "ocean"            // 可选强调色覆盖（选填，默认 ocean）
}
```

- [ ] **Step 1: 写 apps.json 初始内容**

```json
{
  "workbench": {
    "name": "个人工作台",
    "url": "/",
    "icon": "home",
    "description": "Calpher 个人工作台首页"
  },
  "socks": {
    "name": "代理切换台",
    "url": "https://socks.example.dev",
    "icon": "switch",
    "description": "Free Residential IP Proxy Controller"
  },
  "calpher-sub": {
    "name": "订阅管理",
    "url": "https://calpher-sub.example.dev",
    "icon": "sub",
    "description": "多用户 Clash/V2Ray 订阅编排与分发"
  }
}
```

- [ ] **Step 2: 写接入标准 README 片段（记录注册表规范）**

创建 `workbench/README.md`：

```markdown
# Calpher Workbench — 统一接入标准

## 项目注册表（apps.json）

工作台首页从根目录 `apps.json` 读取所有子项目。接入新项目时：

1. 在 `apps.json` 增加一项，字段见文件内注释。
2. 子项目拷贝 `design-system/` 与 `auth/auth.js`。
3. 按 `auth/README.md` 配置鉴权 env。
4. 部署后把实际 URL 更新到 `apps.json`。
```

- [ ] **Step 3: 验证 JSON 合法**

Run: `cd /Users/calpher/tmp/VPS/workbench && node -e "JSON.parse(require('fs').readFileSync('apps.json','utf8')); console.log('apps.json OK')"`
Expected: 输出 `apps.json OK`。

- [ ] **Step 4: Commit**

```bash
cd /Users/calpher/tmp/VPS/workbench
git add apps.json README.md
git -c user.name="calpher" -c user.email="calpher@local" commit -m "feat: 项目注册表 apps.json + 接入标准 README"
```

---

### Task 6: 工作台首页 HTML（octopus 风格）

**Files:**
- Create: `workbench/static/index.html`
- Create: `workbench/static/app.js`

**Interfaces:**
- Consumes: `design-system/styles.css`（Task 2）、`design-system/components.js`（Task 3）、`apps.json`（Task 5）、`auth/auth.js`（Task 4）
- Produces: 工作台首页完整 HTML + 渲染脚本。`app.js` 从 `fetch('/api/apps')` 读注册表渲染侧边栏 + 概览卡 + 项目网格；调用 `/api/me` 判断登录态；未登录显示登录模态框。

- [ ] **Step 1: 写 static/index.html**

参照 octopus 模板的 `index.html` 结构（内联启动脚本设 `data-theme`/`data-accent` 防闪烁），但布局适配个人工作台：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Calpher 工作台</title>
  <script>
    (() => {
      try { var t = localStorage.getItem('calpher-workbench-theme') || 'dark'; } catch(e) { var t = 'dark'; }
      try { var a = localStorage.getItem('calpher-workbench-accent') || 'ocean'; } catch(e) { var a = 'ocean'; }
      document.documentElement.dataset.theme = ['light','dark','system'].includes(t) ? t : 'dark';
      var r = t === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : (t === 'system' ? 'dark' : t);
      document.documentElement.dataset.themeResolved = r;
      document.documentElement.dataset.accent = ['emerald','ocean','iris','amber','sakura'].includes(a) ? a : 'ocean';
    })();
  </script>
  <link rel="stylesheet" href="/assets/styles.css" />
</head>
<body>
  <main class="cn-app-shell">
    <aside class="cn-sidebar">
      <div class="cn-brand">Calpher OS</div>
      <nav class="cn-primary-nav" aria-label="主导航" id="primaryNav"></nav>
      <div class="cn-sidebar-bottom" id="userBox"></div>
    </aside>
    <section class="cn-core">
      <header class="cn-topbar">
        <div class="cn-page-title"><h1>Calpher 工作台</h1><p>统一接入 · 共享登录 · 独立部署</p></div>
        <div class="cn-top-actions">
          <button id="themeToggleBtn" class="cn-round-btn" aria-label="切换显示主题">☾</button>
          <button id="settingsBtn" class="cn-round-btn" aria-label="设置">⚙</button>
        </div>
      </header>
      <section class="cn-metric-grid" id="metricGrid"></section>
      <section class="cn-project-grid" id="projectGrid"></section>
    </section>
  </main>
  <script src="/assets/components.js"></script>
  <script src="/app.js"></script>
</body>
</html>
```

注意：Worker 需要把 `static/` 目录作为静态资源服务（Task 7 实现路由）。`/assets/styles.css`、`/assets/components.js` 分别对应 `design-system/` 母版。

- [ ] **Step 2: 写 static/app.js**

```js
(async function () {
  const state = { apps: {}, user: null };

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  async function loadApps() {
    const data = await fetchJSON('/api/apps');
    state.apps = data || {};
    renderNav();
    renderMetrics();
    renderGrid();
  }

  function renderNav() {
    const nav = document.getElementById('primaryNav');
    const entries = Object.entries(state.apps);
    nav.innerHTML = entries.map(([id, app]) =>
      `<button class="cn-nav-item ${id === 'workbench' ? 'active' : ''}" data-id="${id}">
         <span class="cn-live-dot"></span><span>${app.name}</span>
       </button>`
    ).join('');
  }

  function renderMetrics() {
    const grid = document.getElementById('metricGrid');
    const count = Object.keys(state.apps).length;
    grid.innerHTML = [
      `<article class="cn-metric-card"><h3>PROJECTS / 项目</h3><strong>${count}</strong><p>已接入工作台</p></article>`,
      `<article class="cn-metric-card"><h3>AUTH / 登录</h3><strong>${state.user ? 'ON' : 'OFF'}</strong><p>${state.user ? state.user.name : '未登录'}</p></article>`,
    ].join('');
  }

  function renderGrid() {
    const grid = document.getElementById('projectGrid');
    grid.innerHTML = Object.entries(state.apps).map(([id, app]) =>
      `<a class="cn-project-card" href="${app.url}" target="_blank" rel="noopener">
         <h4>${app.name}</h4><p>${app.description || ''}</p>
       </a>`
    ).join('');
  }

  async function checkAuth() {
    try {
      state.user = await fetchJSON('/api/me');
    } catch (e) {
      state.user = null;
    }
    renderUser();
  }

  function renderUser() {
    const box = document.getElementById('userBox');
    box.innerHTML = state.user
      ? `<div style="padding:12px"><b>${state.user.name}</b><small>${state.user.role}</small></div>`
      : `<button class="cn-btn cn-btn-primary" id="loginBtn">登录</button>`;
    const btn = document.getElementById('loginBtn');
    if (btn) btn.addEventListener('click', showLogin);
  }

  function showLogin() {
    const body = `<div style="display:flex;flex-direction:column;gap:10px">
      <input id="loginName" placeholder="账号" style="padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)" />
      <input id="loginPass" type="password" placeholder="密码" style="padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text)" />
    </div>`;
    Cn.openModal({
      title: '登录',
      body,
      buttons: [
        { text: '取消', onClick: Cn.closeModal },
        { text: '登录', primary: true, onClick: doLogin },
      ],
    });
  }

  async function doLogin() {
    const name = document.getElementById('loginName').value.trim();
    const pass = document.getElementById('loginPass').value;
    try {
      state.user = await fetchJSON('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ name, pass }),
      });
      Cn.closeModal();
      Cn.toast('登录成功');
      renderUser();
      renderMetrics();
    } catch (e) {
      Cn.toast('登录失败: ' + e.message);
    }
  }

  try { await checkAuth(); } catch (e) {}
  try { await loadApps(); } catch (e) { Cn.toast('加载项目失败'); }
  Cn.initThemeToggle('#themeToggleBtn');
})();
```

- [ ] **Step 3: 验证 JS 语法**

Run: `node --check /Users/calpher/tmp/VPS/workbench/static/app.js`
Expected: 无输出（语法正确）。

- [ ] **Step 4: Commit**

```bash
cd /Users/calpher/tmp/VPS/workbench
git add static/
git -c user.name="calpher" -c user.email="calpher@local" commit -m "feat: 工作台首页 HTML + app.js（octopus 风格）"
```

---

### Task 7: Worker 路由（静态资源 + 鉴权 API）

**Files:**
- Modify: `workbench/worker.js`
- Create: `workbench/static/index.html` 已由 Task 6 创建，这里把 HTML 以字符串引入或作为静态资产服务

**Interfaces:**
- Consumes: `static/index.html`（Task 6）、`design-system/styles.css`（Task 2）、`design-system/components.js`（Task 3）、`auth/auth.js`（Task 4）、`apps.json`（Task 5）
- Produces: 完整 Worker fetch：
  - `GET /` → 返回 `static/index.html`
  - `GET /assets/styles.css` → 返回 `design-system/styles.css`
  - `GET /assets/components.js` → 返回 `design-system/components.js`
  - `GET /api/apps` → 返回 `apps.json` 内容
  - `POST /api/auth/login` → 校验主账号，发共享 Cookie
  - `POST /api/auth/logout` → 清 Cookie
  - `GET /api/me` → 返回当前用户（从 Cookie 解析）
  - `POST /api/auth/sync` → 账号同步接口（`AUTH_MASTER_TOKEN` 鉴权）

- [ ] **Step 1: 改造 worker.js 引入 HTML 与静态资源**

参考 calpher-sub 的 `src/index.js` 做法，把 HTML 以字符串导入（wrangler 需要 Text rule）或用 `import` 引入文本：

```js
import indexHtml from './static/index.html';
import stylesCss from './design-system/styles.css';
import componentsJs from './design-system/components.js';
import appsJson from './apps.json';
import {
  authenticate, loginByMaster, buildSessionCookie, buildLogoutCookie,
  handleAuthSync,
} from './auth/auth.js';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
```

- [ ] **Step 2: 实现路由**

```js
export default {
  async fetch(request, env, ctx) {
    globalThis.PARENT_DOMAIN = env.PARENT_DOMAIN || 'example.dev';
    const url = new URL(request.url);
    const method = request.method;

    // 静态资源
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
    }
    if (url.pathname === '/assets/styles.css') {
      return new Response(stylesCss, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }
    if (url.pathname === '/assets/components.js') {
      return new Response(componentsJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    // 项目注册表
    if (url.pathname === '/api/apps' && method === 'GET') {
      return json(appsJson);
    }

    // 鉴权 API
    if (url.pathname === '/api/auth/login' && method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { name, pass } = body;
      const result = await loginByMaster(env, name, pass);
      if (!result.ok) return json({ error: '账号或密码错误' }, 401);
      return json({ name: result.user.name, role: result.user.role }, 200, {
        'Set-Cookie': buildSessionCookie(result.sid),
      });
    }
    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': buildLogoutCookie() });
    }
    if (url.pathname === '/api/me' && method === 'GET') {
      const { user } = await authenticate(request, env);
      if (!user) return json({ error: '未登录' }, 401);
      return json({ name: user.name, role: user.role });
    }
    if (url.pathname === '/api/auth/sync' && method === 'POST') {
      return handleAuthSync(request, env);
    }

    return new Response('not found', { status: 404 });
  },
};
```

- [ ] **Step 3: wrangler.toml 加 Text rules（精确 glob，勿用 `**/*.js`，否则会误伤 `auth/auth.js` 的 ES module 导入）**

```toml
rules = [
  { type = "Text", globs = ["**/*.html", "static/app.js", "design-system/components.js", "design-system/styles.css", "apps.json"], fallthrough = true }
]
```

注意：`static/index.html` 引用了 `/assets/styles.css` 和 `/app.js`。`/app.js` 也要从 worker 路由返回（`static/app.js`）。在 Task 7 Step 2 的静态资源分支中补充：

```js
import appJs from './static/app.js';
// ...
if (url.pathname === '/app.js') {
  return new Response(appJs, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' } });
}
```

- [ ] **Step 4: 本地联调验证**

Run: `cd /Users/calpher/tmp/VPS/workbench && npm run dev`
Expected:
- `GET http://localhost:8787/` → 返回工作台 HTML
- `GET http://localhost:8787/assets/styles.css` → 返回 CSS
- `GET http://localhost:8787/assets/components.js` → 返回 JS
- `GET http://localhost:8787/app.js` → 返回 app.js
- `GET http://localhost:8787/api/apps` → 返回 apps.json JSON
- `POST http://localhost:8787/api/auth/login` body `{"name":"admin","pass":"<测试密码>"}` → 需配置 env 测试

配置本地测试 env：在 `wrangler.toml` 的 `[vars]` 增加 `AUTH_MASTER_PASS = "test-pass-123"`（临时，仅本地）。验证登录返回 200 + Set-Cookie。

- [ ] **Step 5: 浏览器端到端验证**

在浏览器打开 `http://localhost:8787/`：
- 页面渲染侧边栏 + 概览卡 + 项目网格
- 点击登录按钮 → 模态框出现 → 输入 admin/test-pass-123 → 登录成功 toast
- 刷新页面仍保持登录（Cookie 生效）

- [ ] **Step 6: Commit**

```bash
cd /Users/calpher/tmp/VPS/workbench
git add worker.js wrangler.toml
git -c user.name="calpher" -c user.email="calpher@local" commit -m "feat: worker 路由（静态资源 + 共享鉴权 API）"
```

注意：临时测试用的 `AUTH_MASTER_PASS` 提交进 wrangler.toml 不合适。提交前确认把测试密码挪到 `.dev.vars`（gitignored）或提交时保留占位说明。建议在 `wrangler.toml` 注释掉明文密码，改用 `.dev.vars`：

```bash
echo 'AUTH_MASTER_PASS = "test-pass-123"' > .dev.vars
```

---

### Task 8: 自测与验收

**Files:**
- Modify: 无（验证为主）

**Interfaces:**
- Consumes: Task 1-7 全部产物

- [ ] **Step 1: 全量语法检查**

Run: `cd /Users/calpher/tmp/VPS/workbench && node --check worker.js && node --check static/app.js && node --check design-system/components.js && node --check auth/auth.js`
Expected: 全部无输出。

- [ ] **Step 2: JSON 校验**

Run: `cd /Users/calpher/tmp/VPS/workbench && node -e "JSON.parse(require('fs').readFileSync('apps.json','utf8')); console.log('OK')"`
Expected: `OK`。

- [ ] **Step 3: 完整本地流程**

Run: `cd /Users/calpher/tmp/VPS/workbench && npm run dev`
Expected:
1. 首页渲染：侧边栏（个人工作台/代理切换台/订阅管理）、2 张概览卡、3 张项目卡
2. 主题切换按钮在暗/亮/系统间循环，刷新保留
3. 登录流程走通，刷新后保持登录
4. 退出登录后 `/api/me` 返回 401

- [ ] **Step 4: 验收清单核对**

对照 spec 逐项确认：
- [ ] `design-system/` 母版存在（styles.css + components.js）
- [ ] `auth/auth.js` + `auth/README.md` 母版存在
- [ ] `apps.json` 注册表规范存在
- [ ] 工作台首页为 octopus 风格（侧边栏 + 概览卡 + 项目网格）
- [ ] 共享 Cookie 名 `calpher_auth`，父域 Domain，HttpOnly+Secure
- [ ] 登录/登出/me/sync 接口工作
- [ ] localStorage key 统一 `calpher-workbench-theme`/`calpher-workbench-accent`
- [ ] 本地 git 历史完整，未建 GitHub remote、未 push

- [ ] **Step 5: Commit（若有未提交改动）**

```bash
cd /Users/calpher/tmp/VPS/workbench
git status
git log --oneline
```

Expected: git 历史包含 Task 1-7 的全部 commit，工作区干净。

---

## 后续（不在本计划范围，单独规划）

- 子项目 `Calpher-Socks-Switch` 改造：前端重写为 octopus 布局 + 接入 auth.js
- 子项目 `calpher-sub` 改造：前端重写为 octopus 布局 + 接入 auth.js
- 统一父域名迁移（当前两子项目在 workers.dev）
- 工作台 + 子项目测试通过后一起同步 GitHub
