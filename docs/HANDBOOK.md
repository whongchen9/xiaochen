# 即DAO（曾用名：小陈即到）· 项目交接文档

> 版本：v3.0（协作计划 + AI 聊天主线） | 2026-05-06
>
> 本文档描述**当前仓库真实技术栈**与页面职责；**意向帖 / 信息帖 / 匹配页 / 广场** 已从客户端与云函数移除，撮合与计划展示在 **AI 聊天与协作群** 内完成。

---

## 1. 项目概述

即DAO是基于 **微信云开发** 的 **协作与 AI 辅助** 小程序：用户通过 AI 对话维护 **项目计划书**，并围绕 **协作计划 / 协作群** 沟通；匹配意愿与摘要由计划与群内能力承载（如 `setPlanMatchEnabled`、`syncPlanMatchDigest` 等，以云函数为准）。

### 1.1 产品与合规边界

- **不做**：小程序内支付、订单履约、平台代收代付、配送担保。
- **可做**：协作计划、群聊、站内通知、AI 对话与计划书整理。
- **变现（产品方向）**：**Token 用量** 与 **VIP**（见 `miniprogram/utils/token-manager.js` 与云函数对话策略）。

### 1.2 技术栈（当前仓库）

- **前端**：微信小程序原生（WXML + WXSS + JavaScript）
- **后端**：微信云函数 **`service`**（`wx-server-sdk`）+ 云数据库集合 **`xc_*`**
- **可选**：大模型 HTTP（`cloudfunctions/service/llm.js`，环境变量配置）

---

## 2. 项目结构（摘录）

```
xiaoChen-dao/
├── miniprogram/
│   ├── app.json
│   ├── pages/
│   │   ├── chat/           # AI 对话、协作群、计划书入口
│   │   ├── plan-board/     # 计划看板（与聊天内 P 联动）
│   │   ├── profile/        # 个人中心
│   │   ├── notify/         # 通知列表
│   │   ├── address/        # 常用地址
│   │   └── settings/       # 设置、演示数据等
│   ├── components/xiaochen-assistant/
│   └── utils/cloud.js      # call('action', data)
├── cloudfunctions/service/
│   └── index.js            # switch(action) 总路由
└── docs/
    ├── BASE_REQUIREMENTS.md
    ├── DEPLOY_CHECKLIST.md
    └── HANDOVER.md
```

---

## 3. 页面说明（与实现对齐）

### 3.1 AI 聊天（`pages/chat/`）

- 与云函数 **`chat`** 多轮对话。
- **项目计划书**：对话侧维护正文，详情阅读在 `plan-board`；创建协作计划见 `createPlanFromNotebook` / `approvePlan` 等（以云函数为准）。
- 匹配相关 UI（如撮合摘要、开关）以聊天与协作消息为准，**无独立匹配/广场页**。

### 3.2 个人中心（`pages/profile/`）

- **`profile`**：信用、标签、最近协作计划等（字段以云端为准）。
- 常用地址、设置、关于等入口。

### 3.3 通知 / 地址 / 设置

- 通知：`notifications` / `markNotifyRead`；可按本地开关过滤类别。
- 地址：`listAddresses` / `saveAddress` / `deleteAddress`。
- 设置：`savePhone`；演示数据调用 `seedDemoData`（仅开发环境约定）。

---

## 4. 云函数调用约定

所有业务通过 **`wx.cloud.callFunction`**，函数名 **`service`**，参数 **`{ action, ... }`**。

封装：`miniprogram/utils/cloud.js` → **`call(action, data)`**。

**action 列表**以 [`docs/BASE_REQUIREMENTS.md`](./BASE_REQUIREMENTS.md) 第 4 节与 **`cloudfunctions/service/index.js`** 为准。

示例：

```js
const { call } = require('../../utils/cloud');
await call('getPlanBoard', { planId: '...' });
```

---

## 5. 独立 HTTP 后端（未接入）

**`utils/request.js` 占位已删除**；当前业务主路径为云函数。若未来接入独立 HTTP 后端，需新建客户端封装、约定鉴权与域名，并更新本文档。

---

## 6. Skill 参考（WorkBuddy / 历史物料）

`.workbuddy/skills/` 下可能存在 **下单、支付、调度** 等 Skill，适用于**其它产品线或旧方案**；与本仓库「无订单」主线并用时，请以 **`service` 源码**为准，避免沿用已删除的 `createOrder` / `payMock` 等 action。

---

## 7. 待办与扩展（举例）

| 优先级 | 事项 | 说明 |
|--------|------|------|
| P0 | 云函数与集合权限 | 上线前收紧 DB 规则 |
| P1 | Token / VIP 与云端对齐 | 防篡改与计费策略 |
| P1 | 订阅消息（可选） | 离线撮合提醒 |
| P2 | 内容审核策略 | 发帖与人审流程 |

---

*界面与云函数会持续迭代；接手请以 `git` 最新代码与 `HANDOVER.md` 为准。*
