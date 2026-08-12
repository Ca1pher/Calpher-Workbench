# Calpher 统一鉴权模块

`auth/auth.js` 是 Calpher Workbench 鉴权协议的权威实现。接入项目复制此文件；协议升级时，以主站版本为准同步。

## 模式判定

| 模式 | 配置 | 行为 |
|---|---|---|
| 统一鉴权 | 同时配置 `AUTH_MASTER_ORIGIN`、`AUTH_COOKIE_SECRET` | 验证统一会话；无会话时跳主站登录并通过短时签名票据回站 |
| 独立站 | 缺少上述任意一项 | 保留项目原有登录、账号、会话与 API 鉴权 |

模式选择只看这两个变量。不要要求子项目再配置主站账号或同步 token。

```toml
[vars]
AUTH_MASTER_ORIGIN = "https://www.kypher72.indevs.in"
PARENT_DOMAIN = "kypher72.indevs.in" # 可选；同父域时启用父域 Cookie
```

```bash
npx wrangler secret put AUTH_COOKIE_SECRET
```

平台子站和用户创建的个人子站都使用项目独立密钥。主站管理页显示该项目的密钥，子站把同一值配置为自己的 `AUTH_COOKIE_SECRET`，且只能通过 Cloudflare Secret 管理。主站自身的 `AUTH_COOKIE_SECRET` 不提供给子站。网站导航没有密钥，也不参与统一鉴权。

## 跨域登录

当前子站不在同一 registrable domain 时，浏览器不能共享父域 Cookie。统一鉴权使用 HMAC handoff：

1. 子站跳转到 `<AUTH_MASTER_ORIGIN>/login?redirect=<当前完整 URL>`。
2. 主站登录后校验当前账号白名单：管理员全局项目来自 `apps.json`，个人项目来自 `WORKBENCH_KV`。
3. 主站签发 90 秒、绑定目标 origin 的短时票据。
4. 主站跳到子站 `/.calpher/auth/callback?ticket=...`。
5. 子站验证票据，写入 host-only `calpher_auth`，再回到票据中的原页面。

票据必须校验签名、`typ`、`aud`、`iat`、`exp` 与 `returnUrl.origin`。`nonce` 用于保证每张票据唯一，但当前无中心化消费记录，因此安全边界是短有效期与精确受众绑定，不宣称服务端一次性消费。回调完成后不得在最终地址保留票据。

普通异域访问使用 `SameSite=None; Secure`。主站 iframe 通过 `/api/auth/embed-handoff` 先加载 callback，并写入 host-only、`SameSite=None; Secure; Partitioned` 会话。同父域场景继续使用 `SameSite=Lax; Domain=<PARENT_DOMAIN>`。

普通 Cookie 与 Partitioned Cookie 可能以同一个 `calpher_auth` 名称同时出现在请求中。子站认证必须遍历全部同名值并接受第一个有效会话，不能只验证 Cookie 头中的第一个值。

WebKit/Safari 的严格第三方存储策略仍可能要求 Storage Access API 用户授权；需要完全无交互的跨浏览器 iframe 免登时，应把子站迁到主站同一 registrable parent domain。

## 同父域优化

若主站与子站都位于 `*.kypher72.indevs.in`，配置 `PARENT_DOMAIN=kypher72.indevs.in` 后，`calpher_auth` 会写为父域 Cookie，一次登录即可直接被各子域验证。handoff 仍保留为跨域及 Cookie 异常时的兼容路径。

## 主站额外配置

主站本身使用：

- `AUTH_MASTER_NAME`：账号名，默认 `admin`
- `AUTH_MASTER_PASS`：主站登录密码
- `AUTH_COOKIE_SECRET`：主站会话、成员密码保险箱与项目 handoff 的主站密钥；不与子站共享
- `PARENT_DOMAIN`：可选父域
- `WORKBENCH_KV`：普通成员、配额、个人项目和网站导航的数据绑定

子项目在统一鉴权模式下不配置 `AUTH_MASTER_PASS`。

管理员账号密码保持 Cloudflare 环境变量明文。普通成员密码在 KV 中保存带随机盐的 PBKDF2-SHA256 摘要，并额外保存由主站密钥派生 AES-GCM 密钥加密的密码保险箱；成员列表不返回密码，只有管理员专用的禁止缓存接口按需解密。普通成员默认可创建 3 个个人接入子站和 10 个网站导航，管理员可调整配额、查看成员工作台与删除成员。成员可修改自己的名字和密码，也可删除账号及其全部工作台数据。

## 接入边界

- 浏览器页面：未登录时跳主站。
- 浏览器 API：返回 `401` 和 `loginUrl`，由页面进行顶层跳转。
- 机器 API、Agent、公开订阅地址：沿用项目原有 token/Basic/Bearer 规则，不得被网页登录跳转破坏。
- 独立模式：原有登录必须能完整工作，不能依赖主站在线。
