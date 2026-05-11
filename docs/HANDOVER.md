# 即DAO（曾用名：小陈即到）— 开发交接说明（Cursor / 接手必读）

本文档说明**本地存储约定、云开发调用方式、自定义组件接入方式**以及**已知坑点**，便于在不读完全仓库的前提下快速上手。  
业务功能清单见 [`BASE_REQUIREMENTS.md`](./BASE_REQUIREMENTS.md)。  
对外文案与简介方向见 [`POSITIONING_COPY.md`](./POSITIONING_COPY.md)；通知策略见 [`NOTIFY_STRATEGY.md`](./NOTIFY_STRATEGY.md)；用户须知见 [`USER_NOTICE.md`](./USER_NOTICE.md)；发版检查见 [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md)；北极星指标见 [`METRICS_NORTH_STAR.md`](./METRICS_NORTH_STAR.md)。

---

## 1. Token / 登录相关存储（微信小程序 Storage）

项目里存在**多套与「身份 / 额度」相关的本地键**，含义不同，勿混用。

| Storage Key | 写入位置（主要） | 含义 |
|-------------|------------------|------|
| **`token_data`** | `miniprogram/utils/token-manager.js`（`CONFIG.STORAGE_KEY`） | **AI 对话次数（本地计量）**：余额、是否 VIP、每日重置、看广告奖励等。**不是**微信 access_token，也**不是**云开发票据；广告/VIP 开通为 **演示逻辑**，见 §2.6。 |
| **`token`** | （历史预留）曾计划在独立 HTTP 客户端中作为 Bearer；**当前仓库已移除未使用的 `utils/request.js`**，亦无 `setStorageSync('token')`。 |
| **`openid`** | `app.js` → `login` 成功回调 | 云函数返回的 openid 缓存，便于调试或扩展。 |
| **`userInfo`** | `app.js`、`syncUserProfile`、`settings`、`xiaochen-assistant` 等 | `{ nickname, avatar, phone }` 等展示与表单默认值；与云 `login` / `savePhone` 同步。 |
| **`setting_notify_order`** / **`setting_notify_match`** | `pages/settings/settings.js` | 布尔；通知页 `notify` 按类别过滤展示。 |
| **`xiaochen_assistant_input`** | `match.js`、`xiaochen-assistant` 等 | 跳转到聊天页时预填并自动发送的文案（读完即删）。 |
| **`consult_post_draft`** | （已下线帖子详情页）历史键名；协作群主线下可不使用。 |
| **`chat_temp_image`** | `pages/chat/chat.js` | 选图后的临时路径占位（与 `[图片]` 文案配合，发送逻辑以页面为准）。 |
| **`addressList`** | `xiaochen-assistant.js` | 组件内维护的地址列表缓存（若与云地址库并存，需注意数据源一致性）。 |
| **`userBadges`** | `profile.js` | 个人中心徽章类本地状态（若有）。 |
| **`xc_room_last_seen_<roomId>`** | `pages/chat/chat.js` | 离开群聊页时写入的本地时间戳（毫秒），用于 `conversations` 列表推断「有新消息」圆点（单机、近似）。 |

**云开发身份**：服务端以 **`cloud.getWXContext().OPENID`** 为准（见 `cloudfunctions/service/index.js`），与客户端是否存 `openid` 无必然耦合。

---

## 2. 云函数配置

### 2.1 工程路径

| 配置项 | 值 |
|--------|-----|
| 小程序根目录 | `miniprogram/`（`project.config.json` → `miniprogramRoot`） |
| 云函数目录 | `cloudfunctions/`（`cloudfunctionRoot`） |
| 统一业务云函数名 | **`service`** |

### 2.2 环境 ID

- 文件：**`miniprogram/config/cloudEnv.js`**
- 字段：**`envId`**：填云控制台「环境 ID」；**留空**则使用 `wx.cloud.DYNAMIC_CURRENT_ENV`（跟随开发者工具当前所选环境）。
- `app.js` 里：`wx.cloud.init({ traceUser: true, env: cloudEnv.envId ? cloudEnv.envId : wx.cloud.DYNAMIC_CURRENT_ENV })`。
- **AppID 本机覆盖（推荐）**：复制根目录 **`project.private.config.json.example`** 为 **`project.private.config.json`**（已 `.gitignore`），只在本机填写 `appid`；微信开发者工具会**自动合并**该文件，不必反复改公共的 `project.config.json`。
- **一键装云函数依赖**：仓库根目录执行 **`npm run bootstrap`**，或 **`powershell -File scripts/bootstrap.ps1`**（会安装 `cloudfunctions/service` 依赖；若尚无 `project.private.config.json` 则从示例生成一份）。**上传云函数**仍须在开发者工具里对 `service` 点一次「上传并安装依赖」，云端非脚本可代劳。

### 2.3 调用协议（唯一入口）

所有云端业务通过 **`wx.cloud.callFunction`**，**函数名固定为 `service`**，参数形态为：

```js
{ action: '<动作名>', ...其它字段 }
```

封装：**`miniprogram/utils/cloud.js`** → `call(action, data)`：

- 成功：返回云函数 `result`（且约定 `result.ok !== false`）。
- 失败：`Promise.reject({ errMsg, errCode?, raw })`，`errMsg` 来自 `result.errMsg` 或默认 `'请求失败'`；部分业务错误带 `errCode`（如 `STRANGER_INVITES_DB`）。

页面侧典型写法：

```js
const { call } = require('../../utils/cloud');
await call('chat', { message: '你好', history: [] });
```

**action 列表**见 [`BASE_REQUIREMENTS.md`](./BASE_REQUIREMENTS.md) 各节；源码总闸：`cloudfunctions/service/index.js` 内 `switch (action)`。

### 2.4 云函数本地依赖

- `cloudfunctions/service/package.json`：依赖 **`wx-server-sdk`**（版本以文件为准）。
- 上传/安装：在微信开发者工具中对 `service` 执行「上传并安装依赖」。

### 2.5 控制台里的其它云函数（与本仓库关系）

- 本小程序 **只调用** 统一云函数 **`service`**（`miniprogram/utils/cloud.js` 写死函数名）。
- 若在腾讯云 / 微信云开发控制台仍看到 **`post-getDetail`、`notify-*`、`match-*`、`intent-*`、`user-updateRole`** 等，多为**历史环境或其它端**遗留；**删除前**请在云函数 **日志**里确认 **零调用**，避免影响仍在使用的服务。

### 2.6 Token / VIP / 广告（演示说明）

- **`token_data`**（`token-manager.js`）为 **本地 Storage 计次**：每日额度、看广告奖励、VIP 标记等；**非**微信官方计费。
- 当前产品叙事：**广告与 VIP 开通均为演示（模拟支付 / 模拟广告）**；正式上架需自行接入 **激励视频广告**、**微信支付** 并替换 `profile` 页相关交互。

---

## 3. 自定义组件：`xiaochen-assistant`（小陈助手）

### 3.1 路径与性质

- 目录：`miniprogram/components/xiaochen-assistant/`
- 配置：`xiaochen-assistant.json` 中 `"component": true`。
- 功能概要：可拖拽悬浮按钮 + 弹层内对话/撮合要点预填/资料等；内部同样使用 **`require('../../utils/cloud')` 的 `call`**。

### 3.2 页面注册方式

在页面 **`*.json`** 中声明：

```json
{
  "usingComponents": {
    "xiaochen-assistant": "/components/xiaochen-assistant/xiaochen-assistant"
  }
}
```

在 **`*.wxml`** 中使用标签（短横线命名）：

```xml
<xiaochen-assistant />
```

需要 **脚本调用** 实例方法时（如 `openDialog`），必须带 **`id`**：

```xml
<xiaochen-assistant id="xiaochen-assistant" />
```

```js
const assistant = this.selectComponent('#xiaochen-assistant');
if (assistant) assistant.openDialog();
```

**当前约定**：需要脚本唤起助手（如 `openDialog`）的页面使用带 **`id`** 的写法；仅需点击悬浮钮的页面可省略 **`id`**（如 `profile`、`notify`、**`conversations`（首页）** 等，以各页 `*.wxml` 为准）。

### 3.3 与聊天主页的关系

- **`pages/conversations/conversations`**（`app.json` 首页）已挂载 **`xiaochen-assistant`**，打开小程序即可用小陈助手。
- **`pages/chat/chat`** 的 `chat.json` **未**注册 `xiaochen-assistant`（进入全屏聊天页时避免与悬浮助手叠两层）。
- 跨页唤起全文对话：可 **`wx.setStorageSync('xiaochen_assistant_input', '...')`** 后 **`wx.reLaunch({ url: '/pages/chat/chat' })`**（见 `chat.js` `onLoad` 读取逻辑）。

---

## 4. HTTP 请求工具（与云函数并行）

- **已移除**：原占位文件 **`miniprogram/utils/request.js`**（未被任何页面引用）。
- 若未来接入独立 HTTP 后端，需新建请求封装、配置合法域名，并约定 **`token` 等 Storage 键**的写入方。

---

## 5. 已知问题 / 注意事项

1. **云函数 `NO_OPENID`**  
   在云控制台「云端测试」直接跑云函数时没有小程序上下文，会返回 `NO_OPENID`。真机/模拟器内需保证 `wx.cloud.init` 与环境一致；本地调试云函数时勾选「模拟小程序调用」。

2. **AI Token（`token_data`）扣次时机**  
   **`pages/chat/chat`** 与 **`xiaochen-assistant`** 均在 **`call('chat')` 成功返回回复之后** 调用 `tokenMgr.consume()`；失败则不扣次。若后续改为流式或预扣费，需单独设计回滚。

3. **Storage 键 `token`（HTTP Bearer）**  
   当前仓库无 `setStorageSync('token')`；仅在使用自建 HTTP 客户端时再引入。

4. **`cloudEnv.js` 中的 `envId`**  
   可能包含真实环境 ID；公共仓库建议勿提交敏感配置，改用本地覆盖或未提交的 `cloudEnv.local.js` 策略（按团队规范）。

5. **导航方式**  
   多处使用 **`wx.reLaunch`** 切换「聊天 / 匹配 / 个人中心 / 通知」等，会清空页面栈；改版时注意返回栈与埋点。

6. **`scroll-view` 与 `position: fixed` / 悬浮层**  
   历史上曾因与原生滚动层叠导致右侧裁切错觉；后续若在 `scroll-view` 同页叠悬浮 UI，建议在真机验证层级，必要时查阅微信文档 **`root-portal`** 等方案。

7. **`fit-content` / `width` 实验属性**  
   聊天消息行样式若使用较新 CSS，需在目标基础库版本下回归低端机。

8. **群消息内容安全**  
   `sendRoomMessage` 对用户 **文本**及**图片配文**会调用 `security.msgSecCheck`（与发帖链路共用 `wxMsgSecCheckOrSkip`）；需在 **`cloudfunctions/service/config.json`** 声明 `openapi` 并成功上传云函数。离线助手自动回复（`maybeReplyAsCsAssistant`）在写入群消息前会对模型输出走同一套过审策略；未通过则不写库。

---

## 6. Cursor 建议打开顺序

1. `docs/HANDOVER.md`（本文）  
2. `docs/BASE_REQUIREMENTS.md`  
3. `miniprogram/utils/cloud.js`  
4. `cloudfunctions/service/index.js`（`switch (action)`）  
5. `miniprogram/app.js`（云初始化、静默登录）  
6. 涉及页面：`pages/chat/chat.js`、`components/xiaochen-assistant/xiaochen-assistant.js`

---

## 7. 近期重要改动（2026-05）

### 7.1 产品方向：跑腿 → 信息撮合 → AI群聊协作

```
V1（废弃）：AI解析 → 创建配送单 → 支付 → 骑手配送（跑腿平台）
V2（废弃）：AI对话 → 生成帖子 → 发布到广场 → 线下沟通（信息撮合）
V3（当前）：AI对话 → 制定计划 → 双向确认 → 拉群协作（AI群聊）
```

匹配页面已删除，不再需要帖子/广场/分类筛选等概念。

### 7.2 V3 核心流程

```
① AI对话 → 生成项目计划卡片
   用户："帮我找个人明天一起搬家"
   AI：生成计划卡片（时间/地点/人数等），询问匹配偏好

② 匹配设置（AI根据任务重要性推荐，用户可改）
   小事（带咖啡）→ 自动推荐全自动
   中等（搬家）  → 半自动
   重要（组队）  → 全手动

③ 匹配模式
   发起人侧：自动拉群 / 手动确认
   受邀人侧：自动接单 / 手动接单
   双方都自动 → 直接拉群，无需各自点击确认

④ 双向确认
   AI搜索匹配 → 向候选人发邀请卡片（含发起人信用数据）
   候选人点接受/拒绝 → 接受则拉群，拒绝则AI继续找

⑤ 群聊协作
   群名 = 计划主题
   AI为群成员（群助手），可@小陈助手触发重新匹配
   群内可追加匹配（"还不够，再找人"）
   计划完成 → 归档

⑥ 声誉系统
   每个用户有：履约率 / 响应速度 / 爽约次数
   爽约惩罚：匹配优先级降低，信用标签变红
   受邀时展示发起人信用数据
```

### 7.3 已删除

| 内容 | 原因 |
|------|------|
| `pages/match/`、`pages/post-detail/` | 旧广场 / 意向帖 / 信息帖体系已移除；匹配在 AI 聊天与协作群内完成 |
| `pages/order-detail/` | 不再有订单概念 |
| float-nav 中 match 按钮 | 页面已删除，6页同步移除 |
| `utils/nav.js` 中 match 路由 | 同步清理 |
| `app.json` 中 match 注册 | 同步清理 |

### 7.4 待开发

| 功能 | 优先级 | 说明 |
|------|--------|------|
| `chat_rooms` 群聊数据集合 + 群聊云函数 | P0 | 各群独立房间+消息 |
| 群聊页面（聊天页内二级视图） | P0 | 从对话列表点进去 |
| `createPlan` 云函数（AI生成计划+拉群） | P0 | 自动建群+匹配 |
| `matchToPlan` / `matchCandidates` 云函数 | P0 | 搜索匹配候选人+发邀请 |
| 个人标签编辑面板 | P1 | 增删改标签 |
| 邀请卡片组件（通知页） | P1 | 显示发起人信用+接受/拒绝按钮 |
| 信用/声誉系统 | P1 | 云函数`profile`返回creditScore/fulfillRate等 |
| 匹配模式设置 | P1 | 自动/手动，云端用户偏好存储 |
| 信用修复（公益协作/社区互助） | P1 | 低信用用户的救赎路径 |
| 协作完整历史列表页 | P2 | 全部计划记录展示 |

**实现进度（与仓库同步）：** 已接入 `profile` / `saveUserTags` / `creditRepair` / `createPlan` / `listChatRooms` / `getRoomMessages` / `sendRoomMessage` 等；集合 `xc_plans`、`xc_chat_rooms`、`xc_chat_messages`。协作群入口在 **首页「会话」**（`pages/conversations`）；**「通知」页**（`pages/notify`）仅展示云端 **系统 / 订阅** 通知；进群后聊天 UI 仍在 `pages/chat/chat`（参数 `openRoomId` / 分享 `roomId`）。群消息内容安全、离线助手回复过审、协作 handler 模块化等见云函数 `service`。**未做：** `matchToPlan`、邀请卡片与通知联动、匹配模式偏好持久化等。

### 7.5 UI优化记录（已实现）

- 输入栏、气泡、小陈助手、编辑面板、全局统一样式等（见git历史）

- 输入栏：🎤圆按钮+圆角输入框+📷圆按钮+>圆角发送图标
- AI气泡：`background: #eaecf0` 灰色底靠左，28rpx圆角，左上8rpx微收
- 用户气泡：蓝色底靠右，右下角8rpx微收
- 小陈助手弹窗：加✕关闭按钮
- 编辑面板：底部sheet，字段分组（正文/标题/关键词/图片）
- 全局：page-loading、safe-area、float-nav；**页面主标题**以各页 `*.json` 的 **`navigationBarTitleText`** 为准，内容区 **不要** 再用 `.page-header` + `.page-title` 重复同一主标题。

### 7.6 个人页改造

**新结构**（从上到下）：
1. **头部**：头像/昵称/履约率/参与计划数（替代旧的公开帖+意向帖统计）
2. **信用修复卡**（信用<80时显示）：红色警告+两个修复按钮[公益协作+3分][社区互助+2分]+进度条
3. **信用档案**（信用≥80时显示）：简洁胶囊标签（履约率/好评率/爽约次数）
4. **个人标签**：蓝色标签+添加按钮，AI匹配时读取，可编辑
5. **Token卡**：保持原有逻辑
6. **协作历史**：最近2个计划卡片+查看全部
7. **勋章墙**：折叠式（默认收起）
8. **菜单**：地址/设置/关于（不变）

**云函数 `profile` 需新增字段**：
```json
{
  "creditScore": 85,
  "fulfillRate": 95,
  "rating": 4.8,
  "totalPlans": 12,
  "completedPlans": 11,
  "breachCount": 0,
  "tags": ["有电动车", "体力好"],
  "recentPlans": [{"id":"1","title":"明天搬家","status":"done","memberCount":2}]
}
```

### 7.7 信用修复体系

信用<80时候选人可见红色信用标签 + 邀请卡片预警。
修复方式：公益协作(+3分)、社区互助(+2分)、连续履约(+1分)。
爽约惩罚：-5分/次。每日信用得分上限+3（防刷分）。

### 7.8 合规设计
- 群消息写入前走微信 `msgSecCheck` 内容安全接口
- 群聊必须关联具体计划，计划完成自动归档
- 举报+黑名单（待实现）
- nav.js统一路由映射
- post-detail.wxss修复.page覆盖bug，25个硬编码颜色改CSS变量
- profile.wxss金色渐变改CSS变量
- address弹窗居中模态改底部sheet

### 7.9 陌生人匹配：会话态与状态键（产品已定稿，2026-05）

本节固化 **「双方挑人 × 自动组局」** 与 **AI 会话内匹配呈现** 的约定，供实现 `pages/chat/chat` 匹配条、计划书左右滑、云 `runStrangerMatchScan` 联调时对照。**前提**：双方 `strangerPoolEnabled` 均为真且引擎判定可配对；否则云侧 `skipped: pool_off` 等，不进入下表。

#### 7.9.1 计划字段（`xc_plans` / `getPlanBoard` 偏好）

| 字段 | 语义 |
|------|------|
| `strangerPoolEnabled` | 是否进入陌生人池。 |
| `pickBeforeInviteEnabled` | **挑选候选人模式**（真 = 必须经挑选/邀请链，不走「无感自动并排揭晓」）。 |
| `autoFormRoomEnabled` | **允许系统自动组局**（与云侧 `needInvite` 推导一致）。 |
| `coverImageFileId` | 可选；计划书页顶部配图，微信云文件 ID（`cloud://…`），仅发起人可 `setPlanCoverImage` 写入/移除。 |

#### 7.9.2 状态键（研发命名）

以 `(A挑, B挑)` 表示双方 `pickBeforeInviteEnabled`（**挑** = `true`）。

| 状态键 | A 挑 | B 挑 | 说明 |
|--------|------|------|------|
| `P0_NONE` | 关 | 关 | 双方无「挑选」义务；可走会话内匹配条、定时揭晓头像、计划书左右滑等叙事。 |
| `P2_BOTH` | 开 | 开 | 互挑/互邀；**禁止**用定时亮替代「点头像进挑选」。 |
| `P1_A` | 开 | 关 | **A 决策**（同意系统代为申请或自行挑选邀请）；**B 无感**（无挑选义务；展示最小化直至链推进）。 |
| `P1_B` | 关 | 开 | 与 `P1_A` 对称。 |

#### 7.9.3 与云 `runStrangerMatchScan` 的概念对齐

云内已有：`needInvite = pickA || pickB || !autoA || !autoB`；`needInvite && score >= minInvite` → 邀请链；`!needInvite && score >= minAuto` → 自动建群。

| 状态键 | `needInvite`（概念） | 自动建群（分数够时） |
|--------|----------------------|------------------------|
| `P0_NONE` | 仅当 **双方** `autoFormRoomEnabled` 均为真时为假；否则为真 | `needInvite === false` 且过 `minAuto` → **auto** |
| `P2_BOTH` | **恒真** | **不**走 auto，走邀请/互相同意链 |
| `P1_A` / `P1_B` | **恒真** | 不 auto；**有挑人方**走挑选/系统代申请/发邀；**无感方**不强制交互 |

#### 7.9.4 前端职责边界（避免与计划书页打架）

| 区域 | `P0_NONE` | `P2_BOTH` | `P1_*` |
|------|-----------|-----------|--------|
| **AI 会话 chat** | 匹配条、黑头像、定时亮、左右滑计划书（实现时落地） | 匹配条 + **必须点头像** 进挑选/邀请 | 挑人侧同 `P2_BOTH`；无感侧弱占位或延迟，**不自动给全文** |
| **计划书 P** | 长文、完整度、合规、开关 | 同左 + 邀请说明 | 挑人侧全能力；无感侧最小暴露 |

#### 7.9.5 实现前建议锁死（防扯皮）

1. **「无感」**：定义为无「挑选 / 为被匹配点同意」义务；是否允许 **一条极简系统提示**（排障）→ **已锁定**：允许一行弱提示（**A1b**，见勾选表）。  
2. **`P0_NONE` 下左右滑看对方计划书** → **已锁定**：**A2a**（标题+摘要）；**A3b**（定时揭晓/自动匹配成功后可升全文）。  
3. **「双方都以为在自己群里」**：UI 可叙事为各自 AI 会话壳 + **同一条匹配态**；底层是否共用 `bridge` room 与 **消息流是否合并** 须单独设计（合并则同步成本高）。

后续可在云增加 `getMatchSurfaceState` 或在 `runStrangerMatchScan` 返回中附带 `surface: P0_NONE|P1_A|P1_B|P2_BOTH` 供 chat 渲染（待开发）。

**产品勾选项（已定稿，2026-05-06）**：[`STRANGER_MATCH_PRODUCT_CHOICES.md`](./STRANGER_MATCH_PRODUCT_CHOICES.md)。产品确认 **全部采用该文件推荐列**；摘要：**A1b、A2a、A3b、A4b、A5b、A6a、A7c**（过渡可先 **A7b**）、**A8b**。

#### 7.9.6 运维与实现边界

- **集合**：陌生人邀请与阻断依赖 **`xc_stranger_match_invites`**。未在云控制台创建时，`runStrangerMatchScan` / 同意或拒绝邀请会返回 **`errCode: STRANGER_INVITES_DB`** 与可读 **`errMsg`**（便于小程序 Toast 与排障）。
- **扫描池条数**：云函数环境变量 **`STRANGER_MATCH_POOL_LIMIT`** 控制从 `xc_plans`（`status: matching`）单次拉取上限，**合法范围 40–200**，省略时默认 **120**（旧版硬编码 80 已替换）。
- **代码对照表**：[`STRANGER_MATCH_IMPLEMENTATION_MAP.md`](./STRANGER_MATCH_IMPLEMENTATION_MAP.md)（A1–A8 与主要文件 / 云 action 映射）。

### 7.6 信用/声誉系统设计

- 履约率：完成计划数/总参与数
- 响应速度：平均回复时间（星级）
- 爽约次数：30天内放弃/取消的计划数
- 惩罚：爽约3次/月 → 匹配优先级降50%；5次/月 → 信用标签变红

### 7.7 Skill 体系（7个，位置：.workbuddy/skills/）

| Skill | 用途 |
|-------|------|
| xiaoChen-order-skill | AI下单解析 |
| xiaoChen-dispatch-skill | 调度匹配 |
| xiaoChen-notify-skill | 通知触达 |
| xiaoChen-pay-skill | 支付分账 |
| xiaoChen-user-skill | 用户管理 |
| xiaoChen-token-skill | Token经济 |
| xiaoChen-badge-skill | 成就勋章 |

---

## 8. 界面与导航交接（2026-05-06）

本节面向 **接手做界面 / 交互** 的同事：总结当日已落地的页面结构与尚未实现的交互方向，便于出稿与联调对齐。

### 8.1 当日已实现（与仓库代码一致）

**命名与导航**

- **通知**：悬浮导航等处展示 **「通知」**，路径 `pages/notify/notify`，`utils/nav.js` 中 key 仍为 `notify`。

**「通知」页 `notify`**

仅展示云端通知（协作群不在此页，入口见首页 **会话**）：

| 区块 | 说明 |
|------|------|
| **系统通知** | 云端通知中 **`category !== 'match'`**；列表标签 **「系统」**。 |
| **订阅通知** | **`category === 'match'`**（协作/撮合类）；标签 **「订阅」**。若用户在设置中关闭协作类提醒，显示对应提示。 |

**首页 `pages/chat/chat`（AI）**

- **不再**在首页使用「AI / 协作群」Tab。
- **默认**：未进入协作群时先展示 **落地页**，底部主按钮 **「新建协作」**，点击后才展示 **AI 对话区**（不立即调用 `createPlan`）；协作群在理清需求后另行创建（或由后续产品步骤接入）。
- **会话页顶栏「新建协作」**：`navigateTo` 打开 `/pages/chat/chat?startAi=1`，直接进入 AI 对话区（跳过落地页）。
- 小陈助手预填跳转仍会 **直接进入 AI 对话** 并发送。
- 协作群完整交互（消息列表、输入、邀请成员、计划书入口 **P** 等）仍在 **`chat`**，通过 **`openRoomId`**、分享 **`roomId`** 等进入；**群内旧版「入群审批 / 离线客服」面板已移除**（匹配与计划偏好以计划书页为准）。
- 群内 **「‹ 返回」**：若页面栈长度 > 1 则 `navigateBack`，否则 `reLaunch` 到首页 **会话**（`pages/conversations`）。

**其它**

- 已去掉聊天页原大块标题 + 低对比度长说明（与导航栏重复）。
- `collab-history` 进入群聊的 URL 增加 **`roomTitle`** 参数，便于标题展示。

### 8.2 相关文件路径（界面还原优先看）

- `miniprogram/pages/conversations/*`（首页会话列表 + 小陈助手）
- `miniprogram/pages/notify/*`（通知列表布局与样式）
- `miniprogram/pages/settings/*`、`miniprogram/pages/address/*`
- `miniprogram/pages/chat/*`（AI + 落地页 + 群内视图）
- `miniprogram/pages/user-preview/*`（他人协作名片：`targetOpenid`，可选 `roomId` / `planId`）
- `miniprogram/pages/collab-history/*`
- 各页悬浮导航：首页会话列表 `float-btn` 文案 **「通知」** 进入 `notify`；其余页以各自 `*.wxml` 为准

### 8.3 待实现：方向 B（会话列表）与「AI 入口」产品结论

- **当前已实现（聊天 `chat`）**：**不采用置顶 AI 行**；默认 **落地页 + 底部「新建协作」** → 进入 AI 对话（协作内容优先在对话里产生，而非一点击就建空群）。会话列表页 **`pages/conversations`** 已去掉置顶「小陈助手」行；顶栏「新建协作」跳转 **`/pages/chat/chat?startAi=1`** 直接进入 AI。
- **后续若做强会话列表**：**会话列表**（类比桌面端左侧栏；小程序用 **整页纵向列表**）；列表条目主要为 **协作会话**（绑定计划/群），按最近活跃排序。**不再假设「列表首条永久置顶 AI」**（与上述入口一致时可改为「新建」或落地页统一入口）。
- **点击协作行** → 群聊详情；纯 AI 入口 → 落地页或 `startAi`。**「会话」收件箱页**职能与协作列表合并边界仍需产品最终决策。

### 8.4 云函数 / 联调提示（界面可选读）

协作与通知仍依赖统一云函数 **`service`**：`createPlan`、`listChatRooms`、`getRoomMessages`、`sendRoomMessage`、`notifications`、`markNotifyRead`、`publicUserPreview` 等；封装见 `miniprogram/utils/cloud.js`。

### 8.5 协作会话产品草案（扩展阅读）

会话驱动的协作流程（首启种子草稿、空草稿去重、群内匹配卡片、对方预览主页与「邀请 TA」等）见 **[`SESSION_COLLAB_DESIGN.md`](./SESSION_COLLAB_DESIGN.md)**。

---

*文档随仓库演进更新；若云函数 action 或 Storage 键变更，请同步修改本文。*
