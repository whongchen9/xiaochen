# 发版检查清单（即DAO / service + 小程序）

**用途**：每次发体验版 / 正式版前快速过一遍，避免「云未部署、库未建、前端已发」类问题。

---

## 云函数 `service`

- [ ] 微信开发者工具中对 `cloudfunctions/service` **上传并安装依赖**  
- [ ] 环境变量：`LLM_API_KEY`、陌生人匹配相关（如 `STRANGER_MATCH_POOL_LIMIT` 等）与当前环境一致  
- [ ] 云数据库已建：`xc_users`、`xc_plans`、`xc_chat_rooms`、`xc_chat_messages`、`xc_notifications`、**`xc_stranger_match_invites`**（陌生人匹配必需）  
- [ ] 若使用会话列表 `lastMessage`：确认 `xc_chat_messages` 上 **`roomId` + `createdAt`** 索引可用（见 [`STRANGER_MATCH_IMPLEMENTATION_MAP.md`](./STRANGER_MATCH_IMPLEMENTATION_MAP.md)）

## 小程序

- [ ] `miniprogram/config/cloudEnv.js` 中 `envId` 与发版环境一致（或刻意使用动态环境）  
- [ ] Tab 与 `app.json` 页面路径无死链；新增页已注册  
- [ ] 「关于即DAO」页文案与 [`USER_NOTICE.md`](./USER_NOTICE.md) 定稿无冲突  

## 联调抽样

- [ ] 登录 → 会话列表 → 打开 AI → 打开协作群（若有）  
- [ ] 通知列表打开、协作类过滤  
- [ ] 计划书保存、陌生人扫描（有集合时）  

---

*条目随版本增减；重大变更请同步 `HANDOVER.md`。*
