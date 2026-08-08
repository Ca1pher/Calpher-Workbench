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
