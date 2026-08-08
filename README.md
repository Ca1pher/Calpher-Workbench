# Calpher Workbench

Cloudflare Worker 个人工作台，支持管理员、普通成员、跨域统一鉴权、个人项目与网站导航。

## 数据与账号

- 管理员账号密码：`AUTH_MASTER_NAME`、`AUTH_MASTER_PASS`，保存在 Cloudflare 环境变量。
- 普通成员与工作台数据：`WORKBENCH_KV`。
- 普通成员默认 3 个统一鉴权项目、10 个网站导航，管理员可调整。
- 成员密码保存 PBKDF2-SHA256 摘要和 AES-GCM 加密保险箱；管理员可通过专用接口按需查看。
- 平台与个人子站都使用项目独立密钥，主站会话密钥不与任何子站共享。

## 三类入口

- `apps.json`：管理员维护的平台子站元数据；独立密钥和删除状态保存在 `WORKBENCH_KV`。
- 个人接入项目：管理员或成员在工作台创建，每个项目使用独立密钥。
- 网站导航：个人导航，不共享登录，不进入 handoff 白名单。

完整创建、接入、安全与验收规则见 `docs/接入标准.md`；鉴权模块说明见 `auth/README.md`。
