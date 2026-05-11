'use strict';

/**
 * 文本安全校验；接口不可用或异常时放行，避免阻塞群聊/协作主流程。
 * @param {import('wx-server-sdk')} cloud
 * @param {string} content
 * @returns {Promise<{ errCode: number, errMsg?: string }>}
 */
async function wxMsgSecCheckOrSkip(cloud, content) {
  const s = String(content || '').trim();
  if (!s) return { errCode: 0 };
  const slice = s.slice(0, 2500);
  try {
    if (!cloud.openapi || !cloud.openapi.security || !cloud.openapi.security.msgSecCheck) {
      return { errCode: 0 };
    }
    const r = await cloud.openapi.security.msgSecCheck({ content: slice });
    return r && typeof r.errCode === 'number' ? r : { errCode: 0 };
  } catch (e) {
    console.warn('msgSecCheck skip:', (e && e.message) || e);
    return { errCode: 0 };
  }
}

module.exports = { wxMsgSecCheckOrSkip };
