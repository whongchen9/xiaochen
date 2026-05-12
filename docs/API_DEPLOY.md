# API 网关部署指南

## 腾讯云控制台操作步骤（约 10 分钟）

### 第1步：打开 API 网关
访问 https://console.cloud.tencent.com/apigateway → 新建服务

| 配置项 | 填什么 |
|--------|--------|
| 服务名称 | `xiaoChen-dao-api` |
| 区域 | 选你云函数所在的区域（大概率上海或广州） |
| 访问方式 | **HTTP**（不需要 HTTPS 可以先 HTTP） |

### 第2步：创建 API
在 API 网关服务里 → 新建 API

**前端配置：**
```
请求路径：/api/v1/{path}
请求方法：ANY（同时支持 GET/POST/PUT/DELETE）
CORS：开启 ✅
```

**后端配置：**
```
对接方式：云函数 SCF
云函数：service
命名空间：default
超时时间：30秒
```

**参数映射（关键）：**
将 `path` 参数的值传给云函数的 `action` 字段。
例如请求 `POST /api/v1/ai/chat` → `action = "ai/chat"`
但云函数用的是 `chat` 而不是 `ai/chat`，所以需要映射表。

### 第3步：发布
创建完后 → 选择「发布」环境 → 发布

发布成功后你会得到一个地址：
```
https://xxxxxxxx.apigw.tencentcs.com/api/v1
```

### 第4步：验证
```bash
curl https://xxxxxxxx.apigw.tencentcs.com/api/v1/auth/login
# 返回 { "ok": true, "openid": "xxx", "user": {...} }
```

---

## URL 到 action 的映射规则

API 网关接收 `POST /api/v1/ai/chat` 后，需要把路径的最后一段映射为 action 传给云函数。

建议的映射表（API 网关的参数映射功能支持正则）：

| 请求路径 | action 参数 |
|---------|------------|
| `/auth/login` | `login` |
| `/ai/chat` | `chat` |
| `/notifications` | `notifications` |
| `/notifications/read` | `markNotifyRead` |
| `/plans` | `createPlanFromNotebook` 等（以 `service` 为准） |
| `/groups` | `listChatRooms` |
| `/groups/{id}/messages` | `getRoomMessages` 或 `sendRoomMessage` |
| `/profile` | `profile` |
| `/profile/tags` | `saveUserTags` |
| `/credit/repair` | `creditRepair` |
| `/addresses` | `listAddresses` 或 `saveAddress` |
| `/debug/seed` | `seedDemoData` |

（已下线映射：`generatePostDraft` / `publishPost` / `getPost` / `matchSnapshot` / `createDemand` 等，勿再接入网关。）

完整的端点列表和请求/响应格式见 `docs/API_SPEC_V3.md`。

---

## 替代方案：HTTP 桥接云函数

如果 API 网关配置起来麻烦，还有一个更简单的办法：

**新建一个云函数 `api-bridge`**，它就是一个 HTTP 风格的调度器：

```javascript
// cloudfunctions/api-bridge/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { httpMethod, path, headers, body, query } = event
  // 把 HTTP 请求映射为 service 云函数调用
  const action = mapPathToAction(httpMethod, path)
  if (!action) return { statusCode: 404, body: 'Not found' }
  
  const result = await cloud.callFunction({
    name: 'service',
    data: { action, ...body, ...query }
  })
  
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.result)
  }
}
```

但这个方案仍然需要 API 网关来触发——云函数自己没法直接收 HTTP 请求。

**所以最终方案还是：云函数 + API 网关。**
