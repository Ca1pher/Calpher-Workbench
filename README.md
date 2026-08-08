# Calpher Workbench — 统一接入标准

## 项目注册表（apps.json）

工作台首页从根目录 `apps.json` 读取所有子项目。接入新项目时：

1. 在 `apps.json` 增加一项：

   | 字段 | 必填 | 说明 |
   |---|---|---|
   | `name` | 是 | 项目显示名 |
   | `url` | 是 | 项目访问地址（`/` 或完整 URL，外部站新窗口打开） |
   | `icon` | 否 | 图标（emoji / 图片 URL） |
   | `description` | 否 | 一句简介，用于卡片展示 |
   | `accent` | 否 | 卡片强调色（`emerald` / `ocean` / `iris` / `amber` / `sakura`） |

2. 子项目拷贝 `design-system/` 与 `auth/auth.js`。
3. 按 `auth/README.md` 配置鉴权 env。
4. 部署后把实际 URL 更新到 `apps.json`。
