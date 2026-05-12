# 即DAO 云函数项目交接文档

## 1. 项目概述

本项目是「即DAO」微信小程序的后端云函数服务，基于微信云开发平台构建。

### 1.1 架构特点
- **技术栈**: Node.js + 微信云开发 SDK
- **数据库**: 微信云数据库 (NoSQL)
- **AI能力**: DeepSeek API (OpenAI兼容)
- **部署方式**: 微信云函数自动部署

### 1.2 核心功能模块
| 模块 | 功能描述 |
|------|----------|
| 用户认证 | 微信登录、用户资料管理、信用评分系统 |
| AI聊天 | 智能客服、计划草稿生成、协作建议 |
| 协作计划 | 计划创建、审核、管理 |
| 群聊系统 | 协作群管理、消息收发 |
| 陌生人匹配 | 智能匹配、邀请机制 |
| 离线客服 | 主理人离线时AI自动回复 |

---

## 2. 目录结构

```
cloudfunctions/service/
├── index.js              # 入口文件，路由分发
├── package.json          # 依赖配置
├── llm.js                # LLM API 封装
├── config/
│   └── index.js          # 集中配置管理（新增）
├── lib/
│   ├── fmt.js            # 格式化工具
│   ├── security.js       # 安全工具
│   └── utils.js          # 通用工具函数（新增）
├── handlers/
│   ├── collabRooms.js    # 协作计划与群聊处理
│   ├── strangerMatch.js  # 陌生人匹配处理
│   └── agentChat.js      # AI代理聊天处理
└── docs/
    └── HANDOVER.md       # 交接文档（本文件）
```

---

## 3. 配置管理（新增优化）

### 3.1 配置文件位置

所有配置集中在 `config/index.js`，支持通过环境变量覆盖。

### 3.2 配置项说明

#### LLM 配置
| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `LLM_API_KEY` | API密钥（必填） | 空 |
| `LLM_API_URL` | API地址 | `https://api.deepseek.com/v1/chat/completions` |
| `LLM_MODEL` | 模型名称 | `deepseek-chat` |
| `LLM_TEMPERATURE` | 温度参数 | `0.65` |
| `LLM_MAX_TOKENS` | 最大token数 | `900` |
| `LLM_FORCE_DEFAULT_SYSTEM` | 强制使用默认system prompt | `false` |

#### 陌生人匹配配置
| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `STRANGER_MATCH_POOL_LIMIT` | 扫描池上限（40-200） | `120` |
| `STRANGER_MATCH_MIN_AUTO` | 自动匹配最低分数 | `36` |
| `STRANGER_MATCH_MIN_INVITE` | 邀请匹配最低分数 | `22` |
| `STRANGER_MATCH_REVEAL_SECONDS` | 身份暴露时间（秒） | `60` |

#### 管理员配置
| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `PLAN_ADMIN_OPENIDS` | 计划审核管理员OpenID（逗号分隔） | 空 |

### 3.3 配置使用示例

```javascript
const { llm, match, admin } = require('./config');

// 使用配置
const apiKey = llm.apiKey;
const poolLimit = match.poolLimit;
const admins = admin.planAdminOpenids;
```

---

## 4. 工具函数（新增优化）

### 4.1 工具函数位置

`lib/utils.js` 集中管理通用工具函数。

### 4.2 可用工具函数

| 函数名 | 功能说明 | 参数 | 返回值 |
|--------|----------|------|--------|
| `roughFitScore` | 计算字符串匹配度 | `planHaystack`, `profileText` | 匹配分数 |
| `normalizeUserTags` | 规范化用户标签 | `raw`（数组） | 去重后的标签数组 |
| `sortedPairKey` | 生成排序配对键 | `idA`, `idB` | 排序后的键字符串 |
| `maskPhone` | 手机号脱敏 | `phone` | 脱敏后的手机号 |
| `validatePhone` | 验证手机号格式 | `phone` | 布尔值 |
| `validateOpenid` | 验证OpenID格式 | `openid` | 布尔值 |
| `clamp` | 数值范围限制 | `value`, `min`, `max`, `default` | 限制后的数值 |
| `errorResponse` | 生成统一错误响应 | `errMsg`, `errorId`, `errCode` | 错误对象 |
| `generateErrorId` | 生成错误追踪ID | 无 | 唯一ID字符串 |
| `batchGetDocs` | 批量获取文档（处理10条限制） | `db`, `collectionName`, `ids`, `batchSize` | Map<ID, 文档> |
| `delay` | 延迟执行 | `ms` | Promise |
| `deepClone` | 对象深拷贝 | `obj` | 拷贝后的对象 |

---

## 5. 集合结构

### 5.1 集合命名规范

所有集合以 `xc_` 前缀标识「即DAO」专用，避免与同环境其他应用冲突。

### 5.2 核心集合

| 集合名 | 用途 | 关键字段 |
|--------|------|----------|
| `xc_users` | 用户信息 | `_openid`, `nickname`, `avatarUrl`, `creditScore`, `tags` |
| `xc_plans` | 协作计划 | `_openid`, `title`, `summary`, `status`, `memberOpenids` |
| `xc_chat_rooms` | 群聊房间 | `planId`, `memberOpenids`, `ownerOpenid` |
| `xc_chat_messages` | 群消息 | `roomId`, `content`, `msgType`, `_openid` |
| `xc_room_cs` | 离线客服配置 | `roomId`, `assistOfflineEnabled`, `ownerLastSeenAt` |
| `xc_stranger_match_invites` | 匹配邀请 | `inviterOpenid`, `inviteeOpenid`, `planId`, `status` |
| `xc_meta` | 元数据 | `registration_seq`（注册序号） |

---

## 6. API 接口列表

### 6.1 用户相关

| 接口名 | 功能 | 参数 |
|--------|------|------|
| `handleLogin` | 用户登录/注册 | `nickname`, `avatarUrl` |
| `handleUpdateProfile` | 更新用户资料 | `nickname`, `phone`, `tags` |
| `handleGetUser` | 获取用户信息 | 无 |

### 6.2 计划相关

| 接口名 | 功能 | 参数 |
|--------|------|------|
| `handleCreatePlan` | 创建计划 | `title`, `summary` |
| `handleUpdatePlan` | 更新计划 | `planId`, `title`, `summary`, `matchEnabled` |
| `handleGetPlan` | 获取计划详情 | `planId` |
| `handleListPlans` | 获取用户计划列表 | 无 |
| `handleApprovePlan` | 审核计划（管理员） | `planId` |

### 6.3 群聊相关

| 接口名 | 功能 | 参数 |
|--------|------|------|
| `handleCreateRoom` | 创建群聊 | `planId` |
| `handleListChatRooms` | 获取群聊列表 | 无 |
| `handleSendMessage` | 发送消息 | `roomId`, `content`, `msgType` |
| `handleGetMessages` | 获取群消息 | `roomId`, `lastMsgId` |

### 6.4 匹配相关

| 接口名 | 功能 | 参数 |
|--------|------|------|
| `handleScanStrangerPool` | 扫描陌生人匹配池 | `planId` |
| `handleSendMatchInvite` | 发送匹配邀请 | `planId`, `inviteeOpenid` |
| `handleAcceptMatchInvite` | 接受匹配邀请 | `inviteId` |
| `handleCancelMatchInvite` | 撤回匹配邀请 | `planId`, `inviteeOpenid` |
| `handleGetMatchInvites` | 获取匹配邀请列表 | 无 |

### 6.5 AI相关

| 接口名 | 功能 | 参数 |
|--------|------|------|
| `handleLlmChat` | AI聊天 | `userMessage`, `history`, `imageUrls` |
| `handleDraftPlanFromChat` | 从聊天生成计划草稿 | `roomId`, `summary` |
| `handleMergePlanNotebook` | 合并计划笔记 | `planId` |

---

## 7. 关键业务流程

### 7.1 用户注册流程

```
用户登录 → 检查用户是否存在 → 存在则更新资料 → 不存在则创建新用户（分配注册序号）
```

### 7.2 计划创建与审核流程

```
创建计划 → 判断是否需要审核 → 不需要则直接通过 → 需要则等待管理员审核 → 审核通过/拒绝
```

### 7.3 陌生人匹配流程

```
扫描匹配池 → 计算匹配分数 → 自动匹配（分数≥36）或邀请匹配（分数≥22） → 创建邀请 → 对方接受 → 创建群聊
```

### 7.4 离线客服流程

```
群消息 → 检查主理人是否在线 → 离线且启用AI助手 → 调用LLM生成回复 → 发送回复
```

---

## 8. 代码优化记录

### 8.1 优化内容

| 优化项 | 位置 | 说明 |
|--------|------|------|
| 配置集中管理 | `config/index.js` | 将散落的环境变量统一管理，提供默认值和类型转换 |
| 工具函数抽取 | `lib/utils.js` | 抽取 `roughFitScore`、`normalizeUserTags` 等重复函数 |
| 批量查询优化 | `lib/utils.js` | 实现 `batchGetDocs` 处理微信云10条限制 |
| 输入验证增强 | `lib/utils.js` | 添加 `validatePhone`、`validateOpenid` 等验证函数 |
| 错误处理增强 | `lib/utils.js` | 添加 `errorResponse`、`generateErrorId` 统一错误格式 |
| 敏感数据脱敏 | `lib/utils.js` | 添加 `maskPhone` 手机号脱敏函数 |

### 8.2 重构影响

- **移除重复代码**: `roughFitScore`、`sortedPairKey`、`clamp` 等函数已从 handlers 中移除
- **配置引用更新**: 各模块已从 `process.env` 改为从 `config/index.js` 引用
- **依赖注入简化**: `CS_OWNER_OFFLINE_MS` 已从注入参数中移除，改为从配置获取

### 8.3 注意事项

1. **部署时需重新上传云函数**，确保新增文件被包含
2. **配置文件不包含敏感信息**，敏感配置仍通过云函数环境变量设置
3. **原有环境变量保持兼容**，配置文件会自动读取环境变量值

---

## 9. 部署说明

### 9.1 云控制台配置

1. 在微信云开发控制台创建以下集合：
   - `xc_users`
   - `xc_plans`
   - `xc_chat_rooms`
   - `xc_chat_messages`
   - `xc_room_cs`
   - `xc_stranger_match_invites`
   - `xc_meta`
   - `xc_notifications`（可选）
   - `xc_addresses`（可选）
   - `xc_ratings`（可选）

2. 配置环境变量：
   - `LLM_API_KEY`: DeepSeek API 密钥
   - 其他可选配置（参考 3.2 节）

### 9.2 本地开发

```bash
# 安装依赖
npm install

# 本地调试（需配置微信开发者工具）
# 在微信开发者工具中打开云函数目录即可调试
```

### 9.3 上传部署

在微信开发者工具中右键云函数目录 → 「上传并部署：云端安装依赖」

---

## 10. 多端协作注意事项

### 10.1 分支管理

- `main`: 生产环境分支
- `develop`: 开发环境分支
- 功能分支命名: `feature/xxx`
- Bug修复分支: `fix/xxx`

### 10.2 代码规范

- 使用 `'use strict'` 模式
- 变量命名使用驼峰式（camelCase）
- 函数命名使用动词开头
- 注释使用 JSDoc 格式

### 10.3 测试要求

- 新增功能需编写单元测试
- 修改核心逻辑需回归测试
- 部署前需通过 lint 检查

### 10.4 文档更新

- 新增接口需更新本交接文档
- 重大修改需记录在 8.1 节优化记录中

---

## 11. 联系方式

| 角色 | 姓名 | 联系方式 |
|------|------|----------|
| 技术负责人 | - | - |
| 产品负责人 | - | - |

---

**文档版本**: v1.0  
**更新日期**: 2026-05-12  
**适用版本**: 即DAO 云函数 v3.x