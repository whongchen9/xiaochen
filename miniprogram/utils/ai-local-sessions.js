/**
 * 本地持久化「全屏 AI 协作对话」会话（首条用户消息后才出现在首页列表）。
 */
const META_KEY = 'xc_ai_sessions_meta_v1';
const MSG_PREFIX = 'xc_ai_msgs_v1_';
/** AI 会话关联的「计划书正文」草稿（与 chat / plan-board 共用） */
const PLAN_DOC_PREFIX = 'xc_ai_plan_doc_v1_';

function readMetaList() {
  try {
    const raw = wx.getStorageSync(META_KEY);
    if (!raw || !Array.isArray(raw.list)) return [];
    return raw.list;
  } catch (e) {
    return [];
  }
}

function writeMetaList(list) {
  wx.setStorageSync(META_KEY, { list });
}

function generateId() {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeMessagesForSave(msgs) {
  return (msgs || []).map((m) => ({
    id: m.id,
    role: m.role,
    content: String(m.content || ''),
    imageFileId: String(m.imageFileId || '')
  }));
}

function loadMessages(sessionId) {
  if (!sessionId) return [];
  try {
    const raw = wx.getStorageSync(MSG_PREFIX + sessionId);
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
}

function hasUserSpoken(msgs) {
  return (msgs || []).some((m) => {
    if (m.type === 'draft') return false;
    if (m.role !== 'user') return false;
    if (m.imageFileId) return true;
    return !!String(m.content || '').trim();
  });
}

function previewFromMessages(msgs) {
  for (let i = (msgs || []).length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    const c = String(m.content || '').trim();
    if (m.imageFileId) {
      const line = c ? `[图片] ${c}` : '[图片]';
      return line.slice(0, 80);
    }
    if (c) return c.slice(0, 80);
  }
  return '';
}

function syncMeta(sessionId, msgs) {
  const filtered = readMetaList().filter((x) => x.id !== sessionId);
  if (!hasUserSpoken(msgs)) {
    writeMetaList(filtered);
    return;
  }
  const preview = previewFromMessages(msgs) || '协作对话';
  filtered.push({
    id: sessionId,
    updatedAt: Date.now(),
    preview
  });
  filtered.sort((a, b) => b.updatedAt - a.updatedAt);
  writeMetaList(filtered);
}

function saveSession(sessionId, msgs) {
  if (!sessionId) return;
  const normalized = normalizeMessagesForSave(msgs);
  wx.setStorageSync(MSG_PREFIX + sessionId, normalized);
  syncMeta(sessionId, normalized);
}

function getMetaList() {
  return readMetaList().slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

function loadPlanDoc(sessionId) {
  if (!sessionId) return '';
  try {
    const raw = wx.getStorageSync(PLAN_DOC_PREFIX + sessionId);
    return typeof raw === 'string' ? raw : '';
  } catch (e) {
    return '';
  }
}

function savePlanDoc(sessionId, doc) {
  if (!sessionId) return;
  try {
    wx.setStorageSync(PLAN_DOC_PREFIX + sessionId, String(doc || '').trim());
  } catch (e) {}
}

module.exports = {
  generateId,
  loadMessages,
  saveSession,
  getMetaList,
  loadPlanDoc,
  savePlanDoc
};
