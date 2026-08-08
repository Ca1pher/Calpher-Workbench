# 工作台嵌入框架 + 接入标准文档 — 设计文档

- 日期：2026-08-08
- 状态：待用户审阅
- 关联：`2026-08-08-cf-workbench-design.md`（总览设计，本文是其嵌入渲染迭代）

## 背景与目标

上一版设计（门户壳）选择「非 iframe 共享侧边栏」：接入站点自己渲染统一侧边栏。用户验收后提出更优体验方案：

> 点击子项目不要再跳新标签页，**主站保留侧边栏，主区域渲染子项目的主区域**。

本文定义：**主站工作台嵌入框架**（iframe 渲染）+ **《接入标准》文档**（面向第三方业务方，作为子项目改造/搭建的唯一指引）。

核心原则（用户确认）：
1. **子项目本期不动**。主站先把框架和标准做好；子项目之后按文档「渐进式」接入——适配到什么程度，嵌入效果就到什么程度（未适配的子项目也能被嵌入，只是暂不隐藏自身导航）。
2. **子站自选接入/不接入**：
   - **接入模式**：共享工作台登录（未登录可跳主站登录页，完成后回跳）。
   - **不接入模式**：子站自建登录模块，工作台不干预。
3. **接入标准文档要写成「另一个业务方只读文档就能接入」**：注册 → 布局 → 嵌入模式改造，每步都写清楚。

## 范围与非目标

### 本期范围
- 主站工作台：本地/嵌入双视图框架、iframe 容器、postMessage 协议、返回/逃生/错误处理、移动端适配。
- 主站登录跳转协议：`/login?redirect=` 支持 + 开放重定向防护（白名单来自注册表）。
- 《接入标准》文档（`docs/接入标准.md`），含两种接入模式、注册、布局、嵌入改造、Cookie、postMessage、统一鉴权长期目标、检查清单。
- 测试：桌面 + 移动端多视口。

### 非本期（后续）
- 改造 `Calpher-Socks-Switch`、`calpher-sub`。
- 统一鉴权迁移（子项目迁父域 + 复用 `auth/auth.js`）。
- 子项目 `SameSite=None` Cookie 落地。

## 关键决策

| 决策点 | 结论 |
|---|---|
| 嵌入形态 | 主站核心区 iframe 加载子项目 `<URL>?embed=1`，侧边栏/顶栏保留在主站 |
| 未适配子项目 | 仍可嵌入（渐进式），只是自身导航不隐藏 |
| 嵌入 URL 约定 | 追加 `embed=1` 查询参数（已有 query 则 `&embed=1`） |
| 子项目通信 | `postMessage`，消息 `source:'kypher-embed'`，双向安全校验 |
| 登录跳转 | `/login?redirect=<url>`，仅允许注册表域名或站内路径 |
| 子项目接入模式 | 本期只写标准不落地；登录回跳依赖（异域）后续 token 换发 |
| 移动端嵌入 | 抽屉保留，iframe 占满可视区，返回按钮常驻 |

## 一、主站工作台：嵌入框架

### 1. 视图模型

`state.view`：
- `{ mode: 'local' }`：默认，显示 `.metric-grid` + `.workspace-grid` + 详情面板。
- `{ mode: 'embed', id }`：隐藏概览/工作区，核心区渲染 `<iframe>`；侧边栏、顶栏、详情面板保留。

切换入口：
- 点击侧边栏导航、接入项目列表（queue-item）、项目一览卡（project-card）→ 进入嵌入视图（`workbench` 自身除外）。
- 点击「个人工作台」（nav 中 `id=workbench`）或顶栏返回按钮 → 回本地视图。
- 每次进入嵌入重新加载 iframe；回本地销毁 iframe（释放资源、停掉子项目轮询）。

### 2. iframe 容器

`index.html` 核心区新增（与 `.workspace-grid` 平级，默认 `display:none`）：

```
<div id="embedHost" class="embed-host" hidden>
  <div class="embed-bar">
    <span class="embed-title">加载中…</span>
    <a class="embed-open" target="_blank" rel="noopener">在新窗口打开</a>
  </div>
  <div class="embed-frame">
    <div class="embed-loading">正在加载子项目…</div>
    <iframe id="embedFrame" class="embed-iframe" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox"></iframe>
    <div class="embed-error" hidden>
      <p>子项目加载失败或需要单独登录</p>
      <a class="embed-open-alt" target="_blank" rel="noopener">在新窗口打开</a>
    </div>
  </div>
</div>
```

行为：
- **加载态**：loading 显示到 iframe 触发 `load` 或收到 `ready` 消息（先到先得，跨域 iframe 的 `load` 父页面可监听）。
- **失败/未登录**：主站无法读取跨域 iframe 内部状态（登录页/401 由子项目内部处理），因此**不误报错误**——保留 iframe，逃生入口常驻可点。
- **逃生**：`.embed-open` 永远可点，`window.open(app.url, '_blank', 'noopener')`。

### 3. postMessage 协议

子项目 → 主站（主站接收校验）：
- `event.source === iframe.contentWindow`
- `event.origin === new URL(app.url).origin`（app.url 非相对路径时）

消息（`data.source === 'kypher-embed'`）：

| type | 载荷 | 主站行为 |
|---|---|---|
| `ready` | — | 隐藏加载态 |
| `title` | `{ title: string }` | 更新顶栏 page-title 主标题 |
| `exit` | — | 请求退出嵌入，回本地视图 |

主站 → 子项目（子项目接收校验）：`{ source:'kypher-embed', type:'embedded' }` 确认已嵌入（子项目可据此初始化，可选）。

子项目侧校验（写入接入标准）：只接受 `event.origin === 主站 origin`。

### 4. 顶栏

嵌入视图下：
- 返回按钮（`.back-btn`，箭头图标）显示在 page-title 左侧，点击回本地。
- `page-title` 主标题显示子项目名（默认 `app.name`，`title` 消息可更新）。
- 搜索框在嵌入视图隐藏（搜索仅作用于本地项目列表）。

### 5. 移动端（≤1180px）

- 抽屉侧边栏保留（汉堡按钮常驻顶栏，覆盖 iframe）。
- 嵌入视图隐藏详情面板（`.details-panel`），iframe 占满核心区。
- 返回按钮常驻顶栏。

### 6. 错误处理汇总

| 场景 | 处理 |
|---|---|
| iframe 加载超时/失败 | 保留 iframe + 展示「在新窗口打开」逃生；不破坏侧边栏/返回 |
| 子项目未登录（接入模式） | 由子项目自行跳主站登录（见接入标准）；主站不干预 |
| 非注册表子项目 | 无法进入嵌入（注册表是唯一入口源） |
| postMessage 来源不符 | 忽略（安全校验） |

## 二、主站登录跳转协议

供「接入模式」子站使用（本期主站实现，子站后续按标准对接）。

- `/login?redirect=<url>`：登录成功后回跳 `redirect`。
- **开放重定向防护**：`redirect` 合法条件二选一：
  1. 站内相对路径（如 `/`、`/xxx`）；
  2. `https` 且 `host` 属于 `apps.json` 注册表中任一子项目 `url` 的 origin（`/` 视为本站）。
- 实现：`worker.js` 返回 `/login` 时把「允许域名列表」注入 login.html（占位符替换，来源 `apps.json`），login.html 登录成功后本地校验再跳转，避免前端硬编码白名单。

### 子站接入流程（写入接入标准）

1. 子站未登录 → `302 https://www.kypher72.indevs.in/login?redirect=<子站URL(encodeURIComponent)>`
2. 主站登录 → `Set-Cookie: calpher_auth`（父域）→ 校验 redirect 合法 → `302` 回跳子站
3. 子站校验自身会话：
   - 同父域（迁移后）：父域 Cookie 已可读，直接放行；
   - 异域（现状）：父域 Cookie 不达，需后续「token 换发」机制（本期文档注明为统一鉴权长期工作，不实现）。

## 三、接入标准文档（交付物）

**位置**：`docs/接入标准.md`。写作目标：第三方业务方只读此文档即可完成接入。

### 文档结构

1. **接入总览**：三步曲 = 注册 → 布局 → 适配嵌入；两种接入模式总览。
2. **两种接入模式（子站自选）**：
   - 接入模式（共享工作台登录）：未登录跳主站登录 → 回跳。
   - 不接入模式：自建登录，工作台不干预。
   - 各自适用场景与取舍。
3. **注册**：`apps.json` 字段表（id / name / url / icon / description）+ 约束（url 需 HTTPS、可被 iframe 加载、workbench 保留 `/`）。
4. **布局**：注册后出现在主站哪些位置（侧边栏导航、接入项目列表、项目一览卡、详情面板），点击后在核心区嵌入渲染的完整行为说明 + ASCII 布局图。
5. **嵌入模式改造**：检测 `?embed=1` → 隐藏自身顶栏/侧边栏/页脚/凭据展示 → 只渲染内容主区域。给出 `body[data-embed]` CSS 约定与示例。
6. **会话 Cookie**：跨域 iframe 下需 `SameSite=None; Secure`（附浏览器第三方 Cookie 现状说明）；长期方案迁父域后同站无需。
7. **postMessage 协议**：`kypher-embed` 消息规范（ready/title/exit + 数据格式 + 双向 origin 校验）。
8. **登录跳转（接入模式）**：如上「子站接入流程」。
9. **统一鉴权（长期目标）**：迁至 `kypher72.indevs.in` 父域 + 复用 `auth/auth.js`，实现一处登录处处免登。
10. **适配检查清单**：注册→嵌入→隐藏导航→登录→postMessage 逐步自检项。

## 四、测试与验证

| 项 | 方法 |
|---|---|
| 本地/嵌入切换 | 桌面 1440×900、1280×800，点项目进嵌入、返回恢复 |
| 未适配子项目嵌入 | 嵌入 socks / calpher-sub（带自身导航）仍能渲染、逃生可用 |
| postMessage | 本地起一个 `?embed=1` 响应 `ready`/`title` 的测试页验证 |
| 登录 redirect | 合法（注册表域名/站内路径）回跳；非法（外域）拒绝回站内 |
| 移动端 | 375×812：抽屉可开、返回常驻、iframe 占满、无水平滚动 |
| 无 console 错误 | CDP 采集 |

## 五、涉及文件

| 文件 | 改动 |
|---|---|
| `static/index.html` | 新增 `#embedHost`（iframe 容器）+ 顶栏返回按钮 |
| `static/app.js` | 视图状态机、`embedApp`/`exitEmbed`、postMessage 监听、返回/逃生、移动端隐藏详情 |
| `design-system/styles.css` | `.embed-host`/`.embed-bar`/`.embed-frame`/`.embed-iframe`/`.back-btn` 样式 + 移动端适配 |
| `worker.js` | `/login` 注入 redirect 白名单（来自 `apps.json`） |
| `static/login.html` | 读 `?redirect`，登录成功后校验并回跳 |
| `docs/接入标准.md` | **新增**：核心交付物（见上） |
| `apps.json` | 本期不改；文档说明其字段语义与未来可扩展（如 `auth` 标记） |

## 六、后续演进（非本期）

- 子项目按《接入标准》改造：socks（Basic → 表单登录 + 嵌入模式）、calpher-sub（嵌入模式）、迁父域统一鉴权。
- 统一鉴权落地后：Cookie 同站、登录回跳免 token 换发、一处登录处处免登。
