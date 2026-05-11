# 即DAO（曾用名：小陈即到）· 部署与运维自检清单（你需要做的事）

以下步骤无法由仓库代码自动完成，请在微信云开发与公众平台侧逐项核对。

## 1. 云开发环境

1. 在微信开发者工具中打开**项目根目录**，绑定云环境（与 `miniprogram/config/cloudEnv.js`、`cloudbaserc.json` 中 `envId` 一致）。
2. 右键 **`cloudfunctions/service`** → **上传并部署：云端安装依赖**（每次改云函数逻辑或 `package.json` 后重做）。
3. 确认 **`cloudfunctions/service/config.json`** 中 **`timeout: 60`** 已随函数上传（大模型 / 外部 HTTP 依赖）。

## 2. 云数据库集合

在云控制台创建以下集合（名称需一致），权限上线前务必收紧：

| 集合 | 用途 |
|------|------|
| `xc_users` | 用户资料 |
| `xc_notifications` | 站内通知（含 `category`：`match` / `general` 等；历史数据可能有 `order`，可按客户端开关过滤） |
| `xc_addresses` | 常用地址 |
| `xc_ratings` | 可选；历史预留，当前主线可不建 |
| `xc_match_profiles` | 匹配条件单 |
| `xc_demands` | 意向帖（求购/供给等分类以字段为准） |
| `xc_demand_interests` | 「有意向」去重 |
| `xc_posts` | 公开信息帖（文字 + 图片 fileID） |
| `xc_post_engagements` | 帖子「感兴趣」与匿名反馈标签（字段含 `postId`、`actorOpenid`、`interested`、`feedbackTags`） |
| `xc_plans` | V3 协作计划（发起人 `_openid`、`memberOpenids`、`title`、`status`、`roomId` 等） |
| `xc_chat_rooms` | 计划关联群聊房间（`planId`、`memberOpenids`、`title`、`lastMsgAt`） |
| `xc_chat_messages` | 群内消息（`roomId`、发送者 `_openid`、`content`、`role`） |
| `xc_room_cs` | 协作群离线客服（`assistOfflineEnabled`、`aiContextText`、`ownerLastSeenAt` 等，建议仅云函数读写） |
| `xc_room_join_requests` | 成员分享链接入群时的待审批记录（`roomId`、`applicantOpenid`、`status`：`pending`/`approved`/`rejected`） |

**说明：** 若环境里仍存在旧集合 **`xc_orders`**，可与新业务并存或按需归档清理；**新部署不必再创建订单集合**。`xc_post_engagements` 含跨用户汇总所需的多条记录，**请勿配置为「所有用户可读」**，以免泄漏他人选择；宜 **仅云函数读写** 或使用自定义安全规则禁止客户端 `read`。帖子参与度查询建议在控制台为 **`postId`**（及必要时 **`postId + actorOpenid`**）建索引。

### 2.1 云存储路径（协作群 / AI 图片）

| 前缀 | 用途 |
|------|------|
| `xc-room-images/` | 协作群消息图片（前端上传） |
| `xc-ai-chat/` | 首页 AI 对话用户附图 |

免费套餐若无法修改存储安全规则（仍为「仅创建者可读写」），依赖 **`getRoomMessages`** 内 **`getTempFileURL`** 下发 **`imageTempUrl`** 供成员看图；临时链接过期需重新进入房间刷新。

## 3. 大模型（可选）

在云函数环境变量中配置 `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL`。不配 LLM Key 则对话失败（无脚本兜底）。

## 4. 小程序能力与合规

1. **定位**：主线协作群 **未使用** `wx.getLocation`，**`app.json` 已移除** `permission.scope.userLocation` 与 `requiredPrivateInfos.getLocation`。若后续版本重新接入 LBS，需恢复声明并在公众平台「用户隐私保护指引」中同步说明。
2. **支付 / Token**：当前仓库内 **广告奖励与 VIP 为本地演示逻辑**（不产生真实扣款）；正式商业化需单独接入 **激励视频广告**、**微信支付** 并替换对应前端分支。
3. **订阅消息**：若要在小程序外推送协作相关提醒，需申请模板并调用 **`subscribeMessage`**（当前主要为站内 `xc_notifications`）。

## 4.1 云控制台中的其它云函数（可选清理）

小程序 **仅调用 `service`**（见 `miniprogram/utils/cloud.js`）。若腾讯云控制台仍列出 **`post-getDetail`、`notify-*`、`match-*`、`intent-*`** 等历史函数，删除前请在 **云函数 → 日志** 中确认 **无任何调用**，以免误伤并行系统或其它端。

## 5. 协作群主线路（供测试验收）

1. **首页 → 协作群**：发起协作计划（`createPlan`），在群内收发消息（`listChatRooms` / `getRoomMessages` / `sendRoomMessage`）。
2. **发起人**：设置 → 开启「离线客服接待」→ 群内开启「离线时小陈助手代答」→「关联 AI 对话到本群」，再在 AI 对话里补充项目要点（写入 `xc_room_cs.aiContextText`）。
3. **多账号**：使用 **发起人「邀请成员」分享**（直接入群）或 **成员分享链接 + 发起人审批**；或控制台手动写入 `memberOpenids` 做兜底。然后验证离线代答（依赖 `LLM_API_KEY`）。

## 6. 索引（数据量大时）

若 `xc_demands`、`xc_posts` 按状态、时间、`listingCategory` 等查询变慢，可在控制台为常用组合建索引（按需）。

---

完成以上项后，建议用两个测试账号验证 **协作群消息** 与 **离线客服** 链路。
