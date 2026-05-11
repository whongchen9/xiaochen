# 即DAO API — 开放接口规范（曾用名：小陈即到）
## 供外部 AI Agent / 第三方应用调用
> 版本：v1 | 2026-05-06 | 协议：HTTPS + JSON

---

API 网关会将 HTTP 请求转换为云函数调用。
每个端点对应 `cloudfunctions/service/index.js` 中的一个 `action`。

## 基础地址

```
https://{your-api-gateway-id}.apigw.tencentcs.com/api/v1
```

## 认证

所有请求需在 Header 中携带：

```
Authorization: Bearer {openid}
X-Platform: xiaoChen-dao
```

`openid` 通过 `POST /auth/login` 获取。

---

## 端点列表

### 认证

```
POST /auth/login
  → action: login
  Body: { "nickname"?: string, "avatarUrl"?: string }
  Response: { "ok": true, "openid": string, "user": { ... } }
```

### AI 对话

```
POST /ai/chat
  → action: chat
  Body: { "message": string, "history"?: array, "sessionId"?: string }
  Response: { "ok": true, "reply": string }
```

**说明**：信息帖 / 广场 / `generatePostDraft` / `publishPost` / `getPost` 等 action 已从云函数移除；对外 HTTP 若曾映射上述路径请下线。

### 通知

```
GET /notifications
  → action: notifications
  Response: { "ok": true, "list": [...] }

POST /notifications/read
  → action: markNotifyRead
  Body: { "notifyId"?: string }
  Response: { "ok": true }
```

### 协作计划

```
POST /plans
  → action: createPlan
  Body: { "title": string, "summary"?: string, "autoCreateRoom"?: boolean }
  Response: { "ok": true, "planId": string, "roomId"?: string }
```

### 群聊

```
GET /groups
  → action: listChatRooms
  Response: { "ok": true, "rooms": [...] }

GET /groups/{roomId}/messages
  → action: getRoomMessages
  Response: { "ok": true, "messages": [...] }

POST /groups/{roomId}/messages
  → action: sendRoomMessage
  Body: { "content": string }
  Response: { "ok": true }
```

### 用户与信用

```
GET /profile
  → action: profile
  Response: { "ok": true, "creditScore": number, "tags": string[], "plans": [...], ... }

POST /profile/tags
  → action: saveUserTags
  Body: { "tags": string[] }
  Response: { "ok": true }

GET /credit
  → action: profile（取 creditScore 等字段）
  Response: { "ok": true, "creditScore": number, "totalCollabs": number, "fulfillRate": number }

POST /credit/repair
  → action: creditRepair
  Body: { "type": "charity" | "help" }
  Response: { "ok": true, "changeAmount": number, "newScore": number }
```

### 地址

```
GET /addresses
  → action: listAddresses
  Response: { "ok": true, "list": [...] }

POST /addresses
  → action: saveAddress
  Body: { "tag": string, "detail": string, "lat"?: number, "lng"?: number }
  Response: { "ok": true, "id": string }

DELETE /addresses/{id}
  → action: deleteAddress
  Response: { "ok": true }
```

### 统计

```
GET /stats
  → action: stats
  Response: { "ok": true, "data": { ... } }
```

### 调试

```
POST /debug/seed
  → action: seedDemoData
  Response: { "ok": true }
```

---

## 接入示例

```bash
# 1. 登录获取 openid
curl -X POST https://xxx.apigw.tencentcs.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"nickname":"AI助手"}'

# 2. AI 对话
curl -X POST https://xxx.apigw.tencentcs.com/api/v1/ai/chat \
  -H "Authorization: Bearer {openid}" \
  -H "Content-Type: application/json" \
  -d '{"message":"帮我找人搬个家"}'

# 3. 查信用分
curl -X GET https://xxx.apigw.tencentcs.com/api/v1/credit \
  -H "Authorization: Bearer {openid}"

# 4. 创建协作计划
curl -X POST https://xxx.apigw.tencentcs.com/api/v1/plans \
  -H "Authorization: Bearer {openid}" \
  -H "Content-Type: application/json" \
  -d '{"title":"帮忙搬家","summary":"周六从A小区到B小区"}'
```

---

## 部署步骤（腾讯云 API 网关）

1. 打开 https://console.cloud.tencent.com/apigateway
2. 新建 API 网关服务（区域选云函数所在区域）
3. 创建 API：
   - 前端配置：`POST /api/v1/{path}`，开启 CORS
   - 后端配置：对接「云函数 SCF」，选择 `service` 函数
   - 参数映射：将 `path` 参数映射为云函数的 `action` 字段
4. 发布到「发布」环境
5. 开启「免鉴权」或配置 API 密钥

详细配置文档见 Tencent Cloud 官方文档。
