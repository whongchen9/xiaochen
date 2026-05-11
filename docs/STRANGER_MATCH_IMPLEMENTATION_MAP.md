# 陌生人匹配（A1–A8）与协作群 · 实现对照表

**用途**：把产品勾选项 [`STRANGER_MATCH_PRODUCT_CHOICES.md`](./STRANGER_MATCH_PRODUCT_CHOICES.md) 与仓库代码、云函数 **action** 对上号，便于联调与排障。  
**产品总述**：[`HANDOVER.md`](./HANDOVER.md) **§7.9**。

---

## 云函数 `service`（`cloudfunctions/service`）

| Action | 文件 | 说明 |
|--------|------|------|
| `runStrangerMatchScan` | `handlers/strangerMatch.js` | 扫描 `xc_plans`（`matching`）、写 `xc_stranger_match_invites`、自动建群或发邀请通知 |
| `listMyPendingStrangerMatchInvites` | 同上 | 受邀人待处理邀请列表 |
| `acceptStrangerMatchInvite` | 同上 | 同意邀请 → 建 bridge 计划与群 |
| `declineStrangerMatchInvite` | 同上 | 拒绝邀请 |
| `listChatRooms` | `handlers/collabRooms.js` | 会话列表；含 `lastMessage` 预览（最近若干群各查一条最新消息） |
| `joinChatRoom` / `getRoomMessages` / `sendRoomMessage` 等 | `collabRooms.js` | 协作群消息；群内可展示 `plan_card` / `match_digest`（由云侧写入，非用户 `sendRoomMessage` 类型） |

> **索引**：`lastMessage` 依赖 `xc_chat_messages` 上 **`roomId` + `createdAt` 降序** 查询；若无复合索引，预览可能恒为「暂无消息」，需在云开发控制台按报错补索引。

**环境变量（陌生人匹配）**

| 变量 | 默认 / 范围 | 说明 |
|------|----------------|------|
| `STRANGER_MATCH_POOL_LIMIT` | 默认 **120**，范围 **40–200** | 扫描池单次从库中拉取的 `matching` 计划条数上限 |
| `STRANGER_MATCH_MIN_AUTO` / `STRANGER_MATCH_MIN_INVITE` | 见代码 | 自动建群 / 邀请最低匹配分 |
| `STRANGER_MATCH_REVEAL_SECONDS` | 见代码 | 与计划字段 `strangerRevealSeconds` 共同约束揭晓秒数 |

**数据库**：`xc_stranger_match_invites` 未创建时，相关接口返回 **`errCode: STRANGER_INVITES_DB`** 与 **`errMsg`**（需在云控制台建库后重新部署 `service`）。

---

## A1–A8 与小程序 / 工具

| 编号 | 产品结论 | 主要实现 |
|------|-----------|----------|
| **A1b** | 无感方可有一行弱提示 | `pages/chat/chat`：`strangerWeakStrip`（如「协作匹配处理中…」）；匹配坞区域 |
| **A2a** | P0 下对方计划仅标题+摘要级 | 匹配坞 `peerSummaryShort` / 左右滑摘要；全文见计划书或揭晓后 |
| **A3b** | 定时揭晓或自动匹配成功后可升全文 | 匹配坞 `revealed` 与计时器；云返回 `revealSeconds` |
| **A4b** | 揭晓秒数可配置，默认 60 | 计划书 `setPlanMatchPreferences` + `strangerRevealSeconds`；云 `clampRevealSeconds` / `STRANGER_MATCH_REVEAL_SECONDS` |
| **A5b** | 点亮后可点头像进公开主页 | 以现有 `peerOpenid` + 跳转个人页能力为准（若产品再收紧字段，在 profile 云侧裁剪） |
| **A6a** | 仅当前最优 1 条 | `strangerMatch.js` 打分排序后取 `scored[0]` |
| **A7b / A7c** | 终态 A7c；过渡 A7b | **当前过渡**：计划书自动匹配后 `navigateTo` 聊天并带 `strangerDockPlanId`；AI 侧自动匹配为坞内卡片（**A7b 类**）。**A7c**（不依赖整页群列表的 AI 壳）未在本表代码路径内闭环 |
| **A8b** | 通知 + 会话内可点邀请条 | `pages/notify/notify` → 聊天 `focusStrangerInviteId`；`chat` 邀请条 + `declineStrangerMatchInvite`；通知 `stranger_match_invite_sent` 带 `linkPlanId`（需部署后新通知） |

**相关文件（节选）**

- `miniprogram/pages/chat/chat.js` / `chat.wxml` / `chat.wxss`：匹配坞、弱提示、邀请条、群消息 `plan_card` / `match_digest`
- `miniprogram/pages/plan-board/plan-board.js`：`runStrangerMatchScan`、出站邀请提示、`strangerDockPlanId` 跳转
- `miniprogram/pages/conversations/conversations.js`：`listChatRooms` 的 `lastMessage` 预览
- `miniprogram/utils/stranger-match-dock.js`：坞状态本地持久化
- `miniprogram/utils/cloud.js`：失败时透传 `errCode` / `errMsg` 供 Toast

---

*云函数或集合名变更时，请同步改本表与 `HANDOVER.md` §7.9。*
