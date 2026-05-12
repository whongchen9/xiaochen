'use strict';

/**
 * 配置管理模块
 * 集中管理所有环境变量配置，提供默认值和类型转换
 */

/**
 * LLM 相关配置
 */
const llm = {
  apiKey: process.env.LLM_API_KEY || '',
  apiUrl: process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions',
  model: process.env.LLM_MODEL || 'deepseek-chat',
  temperature: parseFloat(process.env.LLM_TEMPERATURE || process.env.LLM_CHAT_TEMPERATURE) || 0.65,
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS || process.env.LLM_CHAT_MAX_TOKENS) || 900,
  disablePlanMerge: process.env.LLM_DISABLE_PLAN_MERGE === '1' || 
                    process.env.LLM_DISABLE_PLAN_MERGE === 'true' || 
                    process.env.LLM_DISABLE_PLAN_MERGE === 'yes',
  forceDefaultSystem: process.env.LLM_FORCE_DEFAULT_SYSTEM === '1' || 
                      process.env.LLM_FORCE_DEFAULT_SYSTEM === 'true' || 
                      process.env.LLM_FORCE_DEFAULT_SYSTEM === 'yes'
};

/**
 * 陌生人匹配相关配置
 */
const match = {
  poolLimit: (() => {
    const raw = process.env.STRANGER_MATCH_POOL_LIMIT;
    const n = raw == null || raw === '' ? 120 : Number(String(raw).trim());
    if (!Number.isFinite(n)) return 120;
    return Math.min(200, Math.max(40, Math.round(n)));
  })(),
  minAutoScore: parseInt(process.env.STRANGER_MATCH_MIN_AUTO) || 36,
  minInviteScore: parseInt(process.env.STRANGER_MATCH_MIN_INVITE) || 22,
  revealSeconds: (() => {
    const envN = Number(process.env.STRANGER_MATCH_REVEAL_SECONDS);
    return Number.isFinite(envN) && envN > 0 ? Math.round(envN) : 60;
  })(),
  cooldownDays: 3
};

/**
 * 协作群离线客服相关配置
 */
const cs = {
  ownerOfflineMs: 3 * 60 * 1000 // 3分钟判定离线
};

/**
 * 审核管理员配置
 */
const admin = {
  planAdminOpenids: (() => {
    const raw = process.env.PLAN_ADMIN_OPENIDS || '';
    return raw
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  })()
};

/**
 * 数据集合名称配置
 * 前缀 xc_ 表示「即DAO」专用，与撮合集市（cs_）分区共存
 */
const collections = {
  USERS: 'xc_users',
  NOTIFICATIONS: 'xc_notifications',
  ADDRESSES: 'xc_addresses',
  RATINGS: 'xc_ratings',
  PLANS: 'xc_plans',
  CHAT_ROOMS: 'xc_chat_rooms',
  CHAT_MESSAGES: 'xc_chat_messages',
  ROOM_CS: 'xc_room_cs',
  JOIN_REQUESTS: 'xc_room_join_requests',
  META: 'xc_meta',
  STRANGER_MATCH_INVITES: 'xc_stranger_match_invites'
};

/**
 * 演示用户配置
 */
const demo = {
  peerOpenid: 'oDemoPeer0000000000000000001',
  runnerOpenid: 'oDemoRunner00000000000000001'
};

module.exports = {
  llm,
  match,
  cs,
  admin,
  collections,
  demo
};