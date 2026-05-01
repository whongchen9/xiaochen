# 小陈即到（xiaoChen-dao）

同城跑腿 / 代买 / 代办微信小程序（AI 对话下单）。业务说明与交接文档见 [`docs/HANDBOOK.md`](docs/HANDBOOK.md)。

本仓库当前以 **Cursor 协作配置** 为主，便于他人复制使用；完整小程序与后端代码可按需在本地继续开发后再推送。

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
