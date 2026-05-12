/**
 * 陌生人自动匹配结果：会话内「黑头像 / 定时揭晓 / 延迟进群」状态持久化（按 planId）
 */
function keyPlan(planId) {
  return 'xc_stranger_dock_' + String(planId || '');
}

function saveStrangerDockState(planId, state) {
  if (!planId) return;
  try {
    wx.setStorageSync(keyPlan(planId), JSON.stringify(Object.assign({ savedAt: Date.now() }, state)));
  } catch (e) {}
}

function loadStrangerDockState(planId) {
  if (!planId) return null;
  try {
    const s = wx.getStorageSync(keyPlan(planId));
    if (!s) return null;
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch (e) {
    return null;
  }
}

function clearStrangerDockState(planId) {
  if (!planId) return;
  try {
    wx.removeStorageSync(keyPlan(planId));
  } catch (e) {}
}

function summarizeShort(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = max != null ? max : 96;
  return t.length > m ? t.slice(0, m) + '…' : t;
}

module.exports = {
  saveStrangerDockState,
  loadStrangerDockState,
  clearStrangerDockState,
  summarizeShort
};
