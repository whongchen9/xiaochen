'use strict';

/**
 * 计算两个字符串的匹配度分数（基于字符频率）
 * @param {string} planHaystack - 计划文本（标题+摘要）
 * @param {string} profileText - 用户标签或资料文本
 * @returns {number} 匹配分数
 */
function roughFitScore(planHaystack, profileText) {
  const a = String(planHaystack || '').replace(/\s/g, '');
  const b = String(profileText || '').replace(/\s/g, '');
  if (!a.length || !b.length) return 0;
  
  const freq = {};
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    freq[ch] = (freq[ch] || 0) + 1;
  }
  
  let score = 0;
  for (let i = 0; i < b.length; i++) {
    const ch = b[i];
    if (freq[ch]) {
      score++;
      freq[ch]--;
    }
  }
  return score;
}

/**
 * 规范化用户标签数组
 * @param {Array|*} raw - 原始标签数据
 * @returns {string[]} 规范化后的标签数组（去重、截断、最多12个）
 */
function normalizeUserTags(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  
  for (const t of arr) {
    const s = String(t || '')
      .trim()
      .slice(0, 16);
    if (!s || out.includes(s)) continue;
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * 生成排序后的配对键（确保 a:b 和 b:a 返回相同结果）
 * @param {string} idA
 * @param {string} idB
 * @returns {string} 排序后的配对键
 */
function sortedPairKey(idA, idB) {
  const a = String(idA);
  const b = String(idB);
  return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * 脱敏手机号（中间四位用****替换）
 * @param {string} phone - 原始手机号
 * @returns {string} 脱敏后的手机号
 */
function maskPhone(phone) {
  if (!phone || phone.length < 11) return '';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/**
 * 验证手机号格式
 * @param {string} phone - 待验证的手机号
 * @returns {boolean} 是否为有效的手机号
 */
function validatePhone(phone) {
  const regex = /^1[3-9]\d{9}$/;
  return regex.test(String(phone || ''));
}

/**
 * 验证OpenID格式（微信OpenID通常为字符串）
 * @param {string} openid - 待验证的OpenID
 * @returns {boolean} 是否为有效的OpenID
 */
function validateOpenid(openid) {
  const s = String(openid || '').trim();
  return s.length > 0 && s.length <= 64;
}

/**
 * 限制数值在指定范围内
 * @param {number} value - 输入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @param {number} defaultValue - 默认值（当输入无效时使用）
 * @returns {number} 限制后的数值
 */
function clamp(value, min, max, defaultValue) {
  const n = Number(value);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 格式化错误响应（统一格式）
 * @param {string} errMsg - 错误消息
 * @param {string} [errorId] - 错误追踪ID
 * @param {string} [errCode] - 错误代码
 * @returns {{ok: boolean, errMsg: string, errorId?: string, errCode?: string}}
 */
function errorResponse(errMsg, errorId, errCode) {
  const result = { ok: false, errMsg };
  if (errorId) result.errorId = errorId;
  if (errCode) result.errCode = errCode;
  return result;
}

/**
 * 生成错误追踪ID
 * @returns {string} 唯一的错误追踪ID
 */
function generateErrorId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/**
 * 批量获取文档（处理微信云 _.in 10条限制）
 * @param {any} db - 数据库实例
 * @param {string} collectionName - 集合名称
 * @param {string[]} ids - 文档ID数组
 * @param {number} [batchSize=10] - 每批查询数量（最大10）
 * @returns {Map<string, any>} ID到文档的映射
 */
async function batchGetDocs(db, collectionName, ids, batchSize = 10) {
  const map = new Map();
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const limit = Math.min(10, batchSize);
  
  for (let i = 0; i < uniqueIds.length; i += limit) {
    const chunk = uniqueIds.slice(i, i + limit);
    if (!chunk.length) continue;
    
    const r = await db
      .collection(collectionName)
      .where({ _id: db.command.in(chunk) })
      .limit(chunk.length)
      .get()
      .catch(() => ({ data: [] }));
    
    for (const doc of r.data || []) {
      if (doc._id) {
        map.set(doc._id, doc);
      }
    }
  }
  
  return map;
}

/**
 * 延迟执行
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 对象深拷贝（简单实现，适合JSON兼容对象）
 * @param {any} obj - 待拷贝对象
 * @returns {any} 拷贝后的对象
 */
function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    console.warn('deepClone failed:', e.message);
    return obj;
  }
}

module.exports = {
  roughFitScore,
  normalizeUserTags,
  sortedPairKey,
  maskPhone,
  validatePhone,
  validateOpenid,
  clamp,
  errorResponse,
  generateErrorId,
  batchGetDocs,
  delay,
  deepClone
};