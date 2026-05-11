# 即DAO · 基础需求与云 action 清单

**用途**：承接 [`HANDOVER.md`](./HANDOVER.md) 所述「业务功能清单」；与源码 `cloudfunctions/service/index.js` 中 `switch (action)` **保持同步**。  
**调用方式**：`wx.cloud.callFunction({ name: 'service', data: { action: '<下表>', ... } })`。

---

## 1. 范围说明

- 小程序根目录：`miniprogram/`；统一封装：`miniprogram/utils/cloud.js` 的 `call(action, data)`。  
- 已下线或未在 switch 中出现的 action **不应**写进对外文档。

## 2. 用户与资料

| action | 说明 |
|--------|------|
| `login` | 登录/同步用户 |
| `profile` | 个人中心聚合数据 |
| `savePhone` | 保存手机号 |
| `saveUserTags` | 保存用户标签 |
| `saveStrangerMatchProfile` | 陌生人匹配画像 |
| `publicUserPreview` | 他人公开资料预览 |
| `creditRepair` | 信用修复（公益/互助） |

## 3. AI 与 Agent

| action | 说明 |
|--------|------|
| `chat` | AI 对话（含可选图片、计划书合并） |
| `agentChat` | Agent 通道 |
| `createPlanFromNotebook` | 从计划书正文创建计划 |

## 4. 通知与地址

| action | 说明 |
|--------|------|
| `notifications` | 通知列表 |
| `markNotifyRead` | 标记已读 |
| `listAddresses` / `saveAddress` / `deleteAddress` | 地址库 |

## 5. 协作计划与群聊

| action | 说明 |
|--------|------|
| `approvePlan` | 计划审核（管理员场景） |
| `setPlanMatchEnabled` | 计划是否参与匹配 |
| `setPlanMatchPreferences` | 匹配偏好（含陌生人池等） |
| `getPlanBoard` | 计划书看板（含 `coverImageTempUrl` 等） |
| `setPlanCoverImage` | 计划发起人设置/移除计划配图（`coverImageFileId` 云文件 ID，空串移除） |
| `syncPlanMatchDigest` | 同步匹配摘要到群消息 |
| `getCollabMatchTipContext` / `setCollabMatchWilling` / `suggestCollabReply` | 协作撮合提示与意愿 |
| `ensureAiCollabRoom` | AI 会话侧确保协作计划/群 |
| `listChatRooms` | 会话列表（含 `lastMessage` 等） |
| `getRoomMessages` / `sendRoomMessage` | 群消息 |
| `joinChatRoom` / `requestJoinChatRoom` / `listRoomJoinRequests` / `decideRoomJoinRequest` | 入群与审批 |
| `getRoomCsState` / `setRoomCsAssist` / `appendRoomCsAiContext` / `heartbeatRoomCsOwner` | 离线客服相关（若前端仍暴露） |
| `getCsAssistPreference` / `saveCsAssistPreference` | 客服辅助偏好 |

## 6. 陌生人匹配

| action | 说明 |
|--------|------|
| `runStrangerMatchScan` | 扫描匹配 / 自动建群或邀请 |
| `listMyPendingStrangerMatchInvites` | 我的待处理邀请 |
| `acceptStrangerMatchInvite` / `declineStrangerMatchInvite` | 同意/拒绝邀请 |
| `seedStrangerMatchDemoPlans` | 演示数据（开发） |

## 7. 演示与种子

| action | 说明 |
|--------|------|
| `seedDemoData` | 写入演示数据（需 `confirm: true`） |

---

*新增 action 时请更新本文件与 `HANDOVER.md` §2.3。*
