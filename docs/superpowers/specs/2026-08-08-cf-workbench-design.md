# 个人 CF 工作台 + 统一接入标准 — 设计文档

> 历史设计记录。鉴权、Cookie、子项目模式判定与接入流程已由 `docs/接入标准.md` 取代；其中 `AUTH_MASTER_TOKEN`、`/api/auth/sync` 及“仅父域 Cookie”方案不得用于新项目。

- 日期：2026-08-08
- 状态：已批准（2026-08-08）

## 背景与目标

用 Cloudflare Worker 搭建一个个人工作台，聚合所有个人 CF 项目。定义一套统一的「接入标准」，让每个子项目：

1. 保持独立部署、独立 git 仓库、独立访问（仍是一个网站）。
2. 按标准接入工作台，获得统一视觉与共享登录。

本次范围：定义标准 + 建工作台，再逐个改造现有子项目
（`Calpher-Socks-Switch`、`calpher-sub`）。改造先做前端 + 鉴权，后端逻辑不动。

## 关键决策（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 接入方式 | 统一设计系统 + 独立部署（门户壳联动） |
| 设计系统分发 | 每个项目内置一份拷贝（母版在 workbench） |
| 工作台首页 | 概览卡 + 项目网格（套用门户壳） |
| 访问控制 | 需登录，共享鉴权，统一主账号体系 |
| 域名 | 统一父域名 + 子域名（具体域名未定，标准中用占位符） |
| 认证中心形态 | 任一处可登录，登录后共享 Cookie |
| 凭据存储 | 工作台为主鉴权中心；子项目可接入共享账号或作为独立站点 |
| 改造范围 | 先改前端 + 鉴权，后端不动 |
| UI 保留程度 | 布局整体重做（octopus 风格），后端 API 不动 |
| 健康状态 | 不要实时状态，项目卡片只显示静态配置 |
| 回滚 | 每个子项目改造前打 pre-tag 并 push |
| 实施顺序 | 标准先行 → 建工作台 → 改造子项目 |
| Git 工作流 | 工作台本地开发 → 部署 CF + 改造子项目测试通过 → 与子项目一起同步 GitHub |

## 一、整体架构

```
VPS/
├── Calpher-Workbench/        ← 新项目：个人工作台（Cloudflare Worker，独立 git 仓库）
│   ├── worker.js              (或 src/index.js)
│   ├── static/
│   │   ├── index.html        ← octopus 风格：侧边栏 + 概览卡 + 项目网格
│   │   ├── styles.css        ← 设计系统标准文件（含 --accent-* token、玻璃拟态、主题切换）
│   │   └── app.js            ← 组件脚本
│   ├── design-system/        ← 设计系统「母版」目录
│   │   ├── styles.css        ← 一份权威拷贝，同步给子项目
│   │   └── components.js
│   ├── auth/                 ← 鉴权中间件「母版」
│   │   ├── auth.js           ← 统一鉴权模块（接入模式 / 独立模式）
│   │   └── README.md         ← 接入标准文档
│   ├── apps.json             ← 项目注册表（所有子项目清单）
│   └── wrangler.toml         ← name=workbench，绑定自定义域名/路由
│
├── Calpher-Socks-Switch/     ← 子项目 1（独立部署，仍独立 git）
│   ├── design-system/        ← 拷贝的设计系统
│   └── auth.js               ← 鉴权中间件拷贝（填主鉴权信息 = 接入）
│
└── calpher-sub/              ← 子项目 2（同上）
```

**三个关键约定：**

1. **母版 / 拷贝**：`Calpher-Workbench/` 里放设计系统和鉴权中间件的权威版本，子项目目录下各有一份拷贝。标准演进 → 改母版 → 同步拷贝。
2. **注册表**：`apps.json` 登记所有子项目（名称、URL、图标、描述），工作台据此渲染网格/概览。
3. **独立 + 接入**：子项目永远是可独立访问的 Worker；是否「接入共享账号」由鉴权配置决定，而不是由代码结构决定。

## 二、共享鉴权标准

### 共享 Cookie 机制

- 前提：统一父域名（如 `*.calpher.dev`），工作台和子项目都部署在其下。具体域名未定，标准中以 `calpher.dev` 为占位符。
- 登录成功 → `Set-Cookie: calpher_auth=<session>; Domain=.calpher.dev; Path=/; HttpOnly; Secure; SameSite=Lax`。
- 父域名 Cookie 对所有子域名可见 → 子项目无需再登录。

### auth.js 中间件的两种模式

由 wrangler 配置的 env 决定，不写死：

| 模式 | 触发条件 | 行为 |
|---|---|---|
| **接入模式** | 配置了 `AUTH_MASTER_ORIGIN` + `AUTH_MASTER_TOKEN`（指向工作台） | 本地校验共享 Cookie（同套签名 secret），Cookie 无效时跳转工作台登录 |
| **独立模式** | 未配置上述变量 | 用项目自己的 `AUTH_MASTER_PASS` 本地校验，视为独立站点 |

### 密钥与会话

- **Cookie 签名**：统一用一套 secret（`AUTH_COOKIE_SECRET`）做 HMAC 签名 session。工作台和接入模式的子项目持有同一 secret，才能互相校验。密钥手动配到各项目（`wrangler secret` / `vars`），无网络依赖。
- **登录入口**：任一处可登录（登录 POST → 校验 master 凭据 → 发共享 Cookie）。
- **账号同步接口**：工作台提供 `POST /api/auth/sync`（用 `AUTH_MASTER_TOKEN` 鉴权），供子项目注册/同步账号；未接入的项目不调用它，独立运行。
- **本地鉴权上下文**：`auth.js` 暴露 `authenticate(request, env)` 返回 `{ user }`，子项目现有路由逻辑只需把原来各自的鉴权替换为这个统一调用——**后端路由逻辑不变**。

### 主鉴权中心

- 工作台作为主作用区，用一套 secret，并开放接口能力给其他子项目同步账号。
- 其他项目接入时，部署按接入标准填写主项目的鉴权信息（`AUTH_MASTER_ORIGIN` + `AUTH_MASTER_TOKEN`）即可同步账号 → 视为接入共享账号的子站点。
- 不填 → 自行设置 `AUTH_MASTER_PASS`，视为独立站点而不是子站点。

## 三、设计系统标准

设计系统参考 `octopus-kaogong-workbench` 的视觉语言，重新定制为个人工作台风格。

### 文件构成

- `styles.css`：设计 tokens + 玻璃拟态 + 布局样式。
- `components.js`：主题切换、玻璃模态框、toast、流体概览卡、项目卡片组件（统一 DOM 结构 + `cn-*` class 前缀）。

### Design tokens

- 主题变量：`--bg` / `--panel` / `--panel-2` / `--line` / `--text` / `--muted`
- 强调色阶：`--accent-h` / `--accent-s` / `--accent-rgb` / `--accent-50`~`--accent-900` / `--accent-foreground` / `--accent-ink`
- 玻璃拟态：`--glass-bg` / `--glass-border` / `--glass-blur`
- 5 套强调色：静海（ocean，默认）、翡翠（emerald）、鸢尾（iris）、琥珀（amber）、绯樱（sakura）
- 亮 / 暗 / 系统主题 + 强调色切换，写入 `localStorage`（key 统一为 `calpher-workbench-theme` / `calpher-workbench-accent`），首屏启动脚本防闪烁。

## 四、工作台首页

```
┌─────────────────────────────────────────────────────────┐
│ sidebar            │  top bar: 搜索 | 主题切换 | 消息      │
│ ┌──────────────┐   │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│ │ 概览驾驶舱    │   │ │概览卡│ │概览卡│ │概览卡│ │概览卡│ │
│ ├──────────────┤   │ └──────┘ └──────┘ └──────┘ └──────┘ │
│ │ 我的项目      │   │                                     │
│ │  - 代理切换   │   │  项目网格（流体卡片）                │
│ │  - 订阅管理   │   │ ┌────────┐ ┌────────┐ ┌────────┐   │
│ │  (未来项目…)  │   │ │ 代理切换│ │ 订阅管理│ │ + 新项目│   │
│ ├──────────────┤   │ │ 状态/描述│ │ 状态/描述│ │        │   │
│ │ 设置中心      │   │ └────────┘ └────────┘ └────────┘   │
│ └──────────────┘   │                                     │
└─────────────────────────────────────────────────────────┘
```

- **侧边栏**：概览驾驶舱（首页）、我的项目列表、设置中心；项目项带 live-dot（静态装饰，不实时）。
- **概览卡**：在线项目数、快捷入口等流体卡片（数据来自 `apps.json` 静态统计，不实时轮询）。
- **项目网格**：从 `apps.json` 读取渲染，每张卡片含名称、描述、图标、跳转链接。点击 → 新标签打开子项目（独立站点）。
- **登录态**：顶部显示当前用户；未登录时引导到登录。
- **不实现实时健康检查**：不强制子项目提供 `/api/health`，卡片只显示静态配置。

## 五、子项目改造方案

**改造原则**：前端整体重做成 octopus 风格布局（侧边栏 + 顶部操作区 + 卡片化），后端 API 和路由完全不动。

### Calpher-Socks-Switch（worker: socks）

- 现状：`worker.js` 2318 行，HTML/CSS/JS 全内嵌；D1；`WEB_USER`/`WEB_PASS` Basic Auth。
- 改造：
  - 前端重写为 octopus 布局：左侧导航（代理切换、节点状态、设置等）+ 主内容区卡片化。
  - 调用现有 `/api/*` 接口（登录、配置、槽位、节点等，全部保留）。
  - 引入设计系统 + `auth.js` 中间件，替换现有 Basic Auth 为统一鉴权（保留回退）。

### calpher-sub（worker: calpher-sub）

- 现状：`src/static/index.html` 5978 行，Tailwind；KV；`ADMIN_UUID` 登录。
- 改造：
  - 前端重写为 octopus 布局：侧边栏（我的订阅、节点编排、分组管理、用户管理）。
  - 调用现有 `/api/*` 和 `/api/v1/*` 接口（全部保留）。
  - 引入设计系统 + `auth.js`，替换现有 `ADMIN_UUID` 登录为统一鉴权。

### 两者共通的改造动作

1. 各打 pre-tag 并 push（回滚保底）。
2. 拷入设计系统文件 + `auth.js`。
3. 重写前端 HTML/CSS/JS。
4. wrangler 配置补 env（`AUTH_MASTER_*` 等）。
5. 验证原有功能 + 独立部署正常。

## 六、实施顺序

1. **标准先行**：建 `Calpher-Workbench/` 仓库 → 定义设计系统母版 + auth.js 母版 + apps.json 规范 + 接入标准文档。
2. **改造 socks**：按标准接入。
3. **改造 calpher-sub**：按标准接入。
4. **后续新项目**：按标准接入即可。

## 回滚保障

- 每个子项目在改造前打 `pre-workbench-refactor` tag 并 push 到 GitHub origin。
- 工作台仓库为全新项目，独立 git 历史。

## Git 工作流（2026-08-08 补充）

- **工作台**：先在本地搭建开发（本地 git 历史），部署到 CF 并改造完子项目、测试通过后，再与子项目一起同步到 GitHub。在此之前不建 GitHub remote、不 push。
- 本地开发阶段：工作台仓库本地提交，保留完整历史，随时可回滚。

## 部署决策（2026-08-08 确认）

- **项目名**：`Calpher-Workbench`（目录名同），Worker 名 `calpher-workbench`。
- **统一父域**：`kypher72.indevs.in`（zone id `68bc861245c2078d2e50cdc3b47c0ca8`），所有接入站点挂其下。
- **工作台主站**：`www.kypher72.indevs.in`，父域 Cookie `Domain=kypher72.indevs.in`。
- **验收顺序**：先部署现状（当前已验收的版本）到 `www.kypher72.indevs.in` 让用户初步验收 → 再实现门户壳/移动端/主题同步迭代。
- **子项目现状域名**（改造前保持）：`socks.kypher.kdns.fr`、`submgr.kypher.ccwu.cc`。改造时统一迁到 `kypher72.indevs.in` 子域。
- **部署网络**：本机需走代理（`http_proxy`/`https_proxy` = `http://127.0.0.1:10808`）。

## 门户壳（Portal Shell）演进（2026-08-08 批准）

> 背景：用户希望接入统一平台的子项目共享同一个侧边栏（在主站和任意子站都能看到接入站点、互相跳转、回主站），而不是简单卡片跳转或 iframe 嵌入。未接入的独立站点则没有侧边栏。同时要求兼容手机端，样式整体协调。

### 决策（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 联动形态 | 非 iframe；共享侧边栏「门户壳」，接入站点自己渲染 |
| 注册表数据源 | 运行时从主站 `GET /api/apps` 拉取 |
| 拉取失败降级 | 侧边栏仅显示主站首页按钮 + 失败提示 + 重新加载按钮 |
| 移动端 | ≤768px 侧边栏收成抽屉（汉堡按钮 + 滑出 + 遮罩） |
| 主题偏好 | 共享 Cookie `calpher_prefs`（非 HttpOnly，父域）跨站同步 |
| 接入成本 | 拷贝设计系统 + `Cn.initPortal({ origin })` 一行即可 |

### 一、门户壳组件（设计系统标准新增）

`components.js` 新增 `Cn.initPortal(opts)`，渲染统一外壳：

- **侧边栏**：从主站 `/api/apps` 拉注册表，渲染「主站首页 + 所有接入站点」。
- **当前站点高亮**：按 `location.origin` 匹配 `apps.json` 中 `url`（`url` 为 `/` 表示主站自身，比对 `location.origin + location.pathname` 开头），匹配项高亮。
- **站点互跳**：点击其他站点 → 新标签打开；点击主站 → 回主站首页。
- **顶栏**：当前站点名 + 主题切换按钮 +（移动端）汉堡按钮。
- **降级**：拉取失败/超时 → 侧边栏仅显示「主站首页」按钮 + 「接入站点加载失败」提示 + 重新加载按钮；站点本身仍完整可用。
- **注册表默认来源**：`opts.origin` 指定主站地址；主站自身调用时 origin 可为空（用自身 `/api/apps`）。

### 二、跨站主题同步

- 新增 Cookie `calpher_prefs`：`Domain=<父域>`，`Max-Age=30天`，**非 HttpOnly**（前端 JS 读写），存 JSON `{theme, accent}`。
- 优先级：本地 `localStorage`（`calpher-workbench-theme` / `calpher-workbench-accent`）优先；未设置时回落到 `calpher_prefs`。
- 任一站切换主题/强调色 → 同步写两者（localStorage + cookie）→ 所有接入站读到同一偏好。
- 与共享登录 Cookie 独立；未登录也能同步主题。

### 三、移动端

- `styles.css` 增加 ≤768px 断点。
- 侧边栏默认隐藏，顶栏汉堡按钮展开抽屉（滑入 + 遮罩，点遮罩关闭）。
- 工作台与子项目移动端体验一致。

### 四、接入成本（子项目视角）

1. 拷贝 `design-system/`、`auth/auth.js`。
2. 配置 `auth/README.md` 所述 env。
3. 页面调用 `Cn.initPortal({ origin: 'https://主站地址' })`。
4. 注册表由主站统一维护，子项目无需各自维护清单。

### 五、需要改动的工作台文件

| 文件 | 改动 |
|---|---|
| `design-system/components.js` | 新增 `initPortal`（渲染壳 + 拉注册表 + 降级 + 抽屉交互） |
| `design-system/styles.css` | 新增壳布局样式 + 移动端断点/抽屉样式 |
| `static/index.html` + `static/app.js` | 工作台首页改用壳组件 |
| `worker.js` | `/api/apps` 增加 `Access-Control-Allow-Origin`（跨子域拉取） |
| `auth/README.md` | 升级为完整《接入标准》文档（含门户壳接入步骤） |
| `apps.json` | 保持注册表语义不变，url 填统一父域下的实际地址 |

### 六、子项目改造阶段（本次范围外，后续）

- `Calpher-Socks-Switch`、`calpher-sub` 接入门户壳 + 统一鉴权，前端重做。
- 绑定统一父域子域名，替换现有自定义域名。
- 改造前各打 `pre-workbench-refactor` tag 并 push。
