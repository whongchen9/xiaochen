# 小陈即到 — 开发交接说明（Cursor / 接手必读）

本文档说明**本地存储约定、云开发调用方式、自定义组件接入方式**以及**已知坑点**，便于在不读完全仓库的前提下快速上手。  
业务功能清单见 [`BASE_REQUIREMENTS.md`](./BASE_REQUIREMENTS.md)。

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

### 2.3 调用协议（唯一入口）

所有云端业务通过 **`wx.cloud.callFunction`**，**函数名固定为 `service`**，参数形态为：

```js
{ action: '<动作名>', ...其它字段 }
```

封装：**`miniprogram/utils/cloud.js`** → `call(action, data)`：

- 成功：返回云函数 `result`（且约定 `result.ok !== false`）。
- 失败：`Promise.reject({ errMsg, raw })`，`errMsg` 来自 `result.errMsg` 或默认 `'请求失败'`。

页面侧典型写法：

```js
const { call } = require('../../utils/cloud');
await call('matchSnapshot', { latitude: 0, longitude: 0 });
```

**action 列表**见 [`BASE_REQUIREMENTS.md`](./BASE_REQUIREMENTS.md) 第 4 节；源码总闸：`cloudfunctions/service/index.js` 内 `switch (action)`。

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

**当前约定**：需要脚本唤起助手（如 `openDialog`）的页面使用带 **`id`** 的写法；仅需点击悬浮钮的页面可省略 **`id`**（如 `profile`、`notify` 等，以各页 `*.wxml` 为准）。

### 3.3 与聊天主页的关系

- **`pages/chat/chat`** 的 `chat.json` **未**注册 `xiaochen-assistant`（避免首页双层助手）；其它 Tab 类页面多已挂载。
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
| `pages/match/` 匹配页 | AI自动匹配拉群，不再需要广场 |
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

**实现进度（与仓库同步）：** 已接入 `profile` / `saveUserTags` / `creditRepair` / `createPlan` / `listChatRooms` / `getRoomMessages` / `sendRoomMessage` 等；集合 `xc_plans`、`xc_chat_rooms`、`xc_chat_messages`。协作群 **列表入口** 在「消息」页；**新建协作** 在首页（聊天页）顶栏；进群后聊天 UI 仍在 `pages/chat/chat`（参数 `openRoomId` / 分享 `roomId`）。群消息内容安全、离线助手回复过审、协作 handler 模块化等见云函数 `service`。**未做：** `matchToPlan`、邀请卡片与通知联动、匹配模式偏好持久化、会话列表首页（方向 B，见 §8）等。

### 7.5 UI优化记录（已实现）

- 输入栏、气泡、小陈助手、编辑面板、全局统一样式等（见git历史）

- 输入栏：🎤圆按钮+圆角输入框+📷圆按钮+>圆角发送图标
- AI气泡：`background: #eaecf0` 灰色底靠左，28rpx圆角，左上8rpx微收
- 用户气泡：蓝色底靠右，右下角8rpx微收
- 小陈助手弹窗：加✕关闭按钮
- 编辑面板：底部sheet，字段分组（正文/标题/关键词/图片）
- 全局：page-header, page-loading, safe-area, float-nav

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

- 原「通知」在悬浮导航等处改为 **「消息」**（图标多为 💬）；页面路径仍为 `pages/notify/notify`，`utils/nav.js` 中 key 仍为 `notify`（仅改展示文案，避免牵动全局路由）。

**「消息」页 `notify`（聚合收件箱）**

垂直分段（同一滚动区域内）：

| 区块 | 说明 |
|------|------|
| **协作群** | 调用 `listChatRooms`；点击行 **`navigateTo`** → `pages/chat/chat?openRoomId=…&roomTitle=…`。顶部说明：**在首页点「新建协作」发起**；保留邀请/成员转发需审批等规则文案。空状态引导去首页「新建协作」。 |
| **系统通知** | 云端通知中 **`category !== 'match'`**；列表标签 **「系统」**。 |
| **订阅通知** | **`category === 'match'`**（协作/撮合类）；标签 **「订阅」**。若用户在设置中关闭协作类提醒，显示对应提示。 |

页头副文案 **「通知 N 条」** 仅统计上述两类云端通知条数，**不含协作群数量**。

**首页 `pages/chat/chat`（AI）**

- **不再**在首页使用「AI / 协作群」Tab；默认仅为 **AI 对话区**。
- 导航栏下方 **顶栏**（仅未进入群聊时）：左侧短说明 + 右侧 **「＋ 新建协作」**；创建成功后在 **本页切入群聊 UI**（不额外 `navigateTo` 叠一层首页）。
- 协作群完整交互（消息列表、输入、邀请成员、离线客服面板等）仍在 **`chat`**，通过 **`openRoomId`**、分享 **`roomId`** 等进入。
- 群内 **「‹ 返回」**：若页面栈长度 > 1 则 `navigateBack`，否则 `reLaunch` 到「消息」页（产品侧曾表示暂不纠结返回策略，但当前实现如此，改版时请一并考虑）。

**其它**

- 已去掉聊天页原大块标题 + 低对比度长说明（与导航栏重复）。
- `collab-history` 进入群聊的 URL 增加 **`roomTitle`** 参数，便于标题展示。

### 8.2 相关文件路径（界面还原优先看）

- `miniprogram/pages/notify/*`（消息聚合布局与样式）
- `miniprogram/pages/chat/*`（AI + 顶栏 + 群内视图）
- `miniprogram/pages/collab-history/*`
- 各页悬浮导航：`profile` / `address` / `settings` / `chat` 等 `*.wxml` 中 `float-btn` 文案「消息」

### 8.3 待实现：方向 B（会话列表 + 置顶 AI）

已与产品讨论、**尚未开发**，供界面稿对齐：

- **首页主体**从「直接进入 AI」演进为 **会话列表**（类比桌面端工具左侧栏；小程序用 **整页纵向列表**）。
- **列表首条永久置顶**：联系人固定为 **AI（小陈助手）**，不沉底、不可删。
- **其余条目**：主要为 **协作会话**（绑定计划/群），按最近活跃排序；是否允许多条「非置顶」纯 AI 会话由产品再定。
- **点击置顶行** → 纯 AI 对话；**点击协作行** → 群聊详情（第一期可接受两种详情形态分离，不必强做同页 Tab）。
- **「消息」页**职能倾向收窄为 **系统通知 + 订阅通知**；协作列表是否与会话列表完全合并需产品最终决策，避免双列表完全重复、文案分工不清。

### 8.4 云函数 / 联调提示（界面可选读）

协作与通知仍依赖统一云函数 **`service`**：`createPlan`、`listChatRooms`、`getRoomMessages`、`sendRoomMessage`、`notifications`、`markNotifyRead` 等；封装见 `miniprogram/utils/cloud.js`。

---

*文档随仓库演进更新；若云函数 action 或 Storage 键变更，请同步修改本文。*
