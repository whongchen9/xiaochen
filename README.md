# 即DAO（仓库 xiaoChen-dao，曾用名小陈即到）

**信息撮合** 微信小程序：AI 对话整理诉求、发布 **文字 + 图片** 公开帖，匹配广场展示意向与帖子；**不接支付、不做订单履约**。变现方向为 **Token 用量 / VIP**（客户端本地计量 + 云对话配额等，以当前实现为准）。业务说明见 [`docs/HANDBOOK.md`](docs/HANDBOOK.md)，**部署自检**见 [`docs/DEPLOY_CHECKLIST.md`](docs/DEPLOY_CHECKLIST.md)。

### 微信云开发（当前主线）

1. 在微信开发者工具中开通 **云开发**。若与 **撮合集市** 共用同一套环境：
   - 项目根目录已配置 **`cloudbaserc.json`**（`envId`）与 **`project.config.json`** 的 **`cloudbaseRoot`**（`./`），供新版 CloudBase / 开发者工具识别。
   - 小程序运行时环境 ID 见 **`miniprogram/config/cloudEnv.js`** 的 **`envId`**。
   - **上传云函数仍须在工具里绑定一次环境**：左侧文件树 **右键 `cloudfunctions` 文件夹** → **「当前环境」/「切换环境」** → 选中你的环境 ID（官方要求，单靠 JSON 有时仍不会写入 IDE 状态）。
   - 请用开发者工具 **打开本项目根目录**（能看到 `project.config.json`、`cloudbaserc.json`），不要只打开子文件夹。
2. **方案 A（与同环境「撮合集市」分区）**：即DAO使用 **`xc_` 前缀集合**，请在云数据库中新建（名称需一致）：**`xc_users`、`xc_notifications`、`xc_addresses`、`xc_ratings`**（可选，历史预留）、**`xc_match_profiles`**（匹配条件单）、**`xc_demands`**（意向帖）、**`xc_demand_interests`**（「有意向」去重）、**`xc_posts`**（信息帖）、**`xc_post_engagements`**（帖子「感兴趣」与匿名反馈，建议 **仅云函数读写**，勿对前端放开全表读）。**不再使用 `xc_orders`。** 撮合集市侧建议使用 **`cs_`** 等前缀，避免与默认 `users`/`orders` 混用。
3. **站内通知**：匹配、意向、撮合相关提醒写入 **`xc_notifications`**（`category` 含 `match` / `general` 等；若历史上曾有 `order` 类条目，设置页仍可按「订单类通知」开关过滤）。匹配双方 **均有定位** 时，云端可按距离做筛选（具体阈值以云函数为准）。
4. 开发阶段可将各集合权限设为「仅创建者可读写」或开发测试规则；上线前务必收紧。
5. 修改集合名或云函数后，请右键 **`cloudfunctions/service`** →「上传并部署：云端安装依赖」。首次需在 `cloudfunctions/service` 目录执行 `npm install`（安装 `wx-server-sdk`）。
6. 小程序启动时 **`App.silentLogin`** 会云函数静默登录并写入/更新 **`xc_users`**；聊天、通知、匹配快照、发帖草稿/发布、地址等均走 **`service` 云函数**。
7. **演示数据（开发）**：上传部署最新 `service` 后，在 **开发版 / 体验版** 打开 **设置**，使用「写入演示数据」；云函数 **`seedDemoData`**（需 `confirm: true`）会写入演示 **意向帖** 等，便于匹配广场筛选查看（无订单演示数据）。

### 接入大模型（AI 对话）

对话接口为云函数 **`service`** 的 **`action: 'chat'`**。已在 `cloudfunctions/service/llm.js` 中接入 **OpenAI 兼容**的 Chat Completions（默认示例为 DeepSeek，可换成任意兼容网关）。

1. 打开 **云开发控制台 → 云函数 → service → 版本与配置 → 环境变量**，新增例如：
   - **`LLM_API_KEY`**（必填）：厂商控制台申请的 API Key  
   - **`LLM_API_URL`**（可选）：默认 `https://api.deepseek.com/v1/chat/completions`；若用 OpenAI 官方或其它代理，改成对应完整 URL  
   - **`LLM_MODEL`**（可选）：默认 `deepseek-chat`  
   - **`LLM_SYSTEM_PROMPT`**（可选）：聊天 system 人设。**可在控制台删除该变量**，或把值清空（仅空格也会被视为未配置），即使用代码内 `DEFAULT_CHAT_SYSTEM_PROMPT`。若暂时无法删除旧变量，可另设 **`LLM_FORCE_DEFAULT_SYSTEM=1`**（或 `true` / `yes`）强制只用代码默认人设。  
   - **`LLM_TEMPERATURE` / `LLM_MAX_TOKENS`**（可选）：数字字符串  

2. **保存后重新上传部署** `service`（云端安装依赖）。未配置 `LLM_API_KEY` 时，`chat` 返回失败（小程序 Toast），**无脚本兜底回复**。

3. （可选）小程序可在 `call('chat', { message, history })` 里传入 **`history`**：`[{ role:'user'|'assistant', content:'...' }, ...]`，便于多轮上下文；不传则单轮。

本仓库含小程序端与 `cloudfunctions`；本地协作配置说明仍见下文。

---

## Cursor：`continuous-agent-protocol` Skill（可单独拿走）

适用于：**长任务开发时 Agent 频繁「阶段性汇报」导致断流、需要连续执行直到可验收** 的场景。

- **路径：** [`.cursor/skills/continuous-agent-protocol/SKILL.md`](.cursor/skills/continuous-agent-protocol/SKILL.md)
- **安装（任选其一）：**
  - **全局：** 将文件夹 `continuous-agent-protocol/` 复制到 `~/.cursor/skills/continuous-agent-protocol/`
  - **单项目：** 复制到 `<你的项目>/.cursor/skills/continuous-agent-protocol/`
- **使用：** 在 Cursor Agent 中 @ 该 skill，或按 `SKILL.md` 内的「User activation block」原文粘贴启用。

**便于检索的英文关键词：** `Cursor Agent Skill`, `continuous execution`, `non-interrupting agent`, `long-running task`, `不要中断`, `连续执行`.

---

## Cursor：Karpathy 行为准则（项目规则）

- **路径：** [`.cursor/rules/karpathy-guidelines.mdc`](.cursor/rules/karpathy-guidelines.mdc)  
- 源自社区整理的 [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) 思路；与上面的「连续执行协议」若同时开启，请自行在对话里约定优先级（例如「长跑模式」下以 protocol 为准）。

---

## 把本仓库公开到 GitHub（示例）

1. 在 GitHub 新建 **Public** 仓库（可同名 `xiaoChen-dao`），**不要**初始化 README（避免推送冲突）。
2. 本地执行（将 `YOUR_USER` 换成你的账号）：

```bash
cd /path/to/xiaoChen-dao
git remote add origin https://github.com/YOUR_USER/xiaoChen-dao.git
git branch -M main
git push -u origin main
```

3. 在 GitHub 仓库 **Settings → General → Danger Zone** 中确认仓库为 **Public**。

完成后，他人即可通过 GitHub 搜索仓库名或 `continuous-agent-protocol SKILL.md` 等关键词找到本配置。
