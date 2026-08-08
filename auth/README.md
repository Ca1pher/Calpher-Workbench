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

| 模式 | 配置 | 状态 |
|---|---|---|
| 独立模式 | `AUTH_MASTER_PASS` + `AUTH_MASTER_NAME`，本地校验 | 可用 |
| 接入模式 | `AUTH_MASTER_ORIGIN` + `AUTH_MASTER_TOKEN`，指向主鉴权中心 | **未落地**（占位，配置后登录一律失败） |

- **独立模式**：配置 `AUTH_MASTER_PASS`（+ 可选 `AUTH_MASTER_NAME`）本地校验，共享同一套 `AUTH_COOKIE_SECRET` 即跨子域免登录。
- **接入模式**：依赖主鉴权中心的 federation 接口，当前阶段尚未实现。子项目现阶段请使用独立模式（各项目配置相同的主账号与密钥）。
- 模式判定优先级：存在 `AUTH_MASTER_PASS` 即为独立模式，否则有 `AUTH_MASTER_ORIGIN` 则为接入模式（暂不可用），两者皆无则不开放登录。

## 共享 Cookie

`calpher_auth`，`Domain=<父域>`，HttpOnly + Secure + SameSite=Lax，跨子域免登录。
