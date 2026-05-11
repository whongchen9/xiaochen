/**
 * 即DAO · 统一云函数
 * 方案 A：集合名带 xc_ 前缀，与同环境的撮合集市（建议 cs_）分区共存。
 * 需在控制台创建：xc_users、xc_notifications、xc_addresses、xc_ratings（可选）、
 * xc_plans（V3 协作计划）、xc_chat_rooms（计划关联群聊）、xc_chat_messages（群消息）
 * xc_room_cs（协作群离线客服：开关、主理人 AI 对话摘要、最后在线）
 * xc_room_join_requests（成员分享入群时的待审批申请）
 * xc_meta（计数器等元数据，如 registration_seq 注册序号）
 * xc_stranger_match_invites（陌生人计划匹配：自动建群记录与邀请）
 */
const cloud = require('wx-server-sdk');
const { tryLlmChat, tryLlmMergePlanNotebook, tryLlmPlanDraftFromChat, tryLlmDiscoverLayout, postJson } = require('./llm');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const { fmtTime } = require('./lib/fmt');
const security = require('./lib/security');

/** 即DAO专用集合（勿与撮合集市默认集合混名） */
const XC = {
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

const CS_OWNER_OFFLINE_MS = 3 * 60 * 1000;

function wxMsgSecCheckOrSkip(content) {
  return security.wxMsgSecCheckOrSkip(cloud, content);
}

const createCollabHandlers = require('./handlers/collabRooms');
const createStrangerMatchHandlers = require('./handlers/strangerMatch');
const createAgentChat = require('./handlers/agentChat');
const collab = createCollabHandlers({
  db,
  _,
  cloud,
  XC,
  fmtTime,
  tryLlmChat,
  wxMsgSecCheckOrSkip,
  CS_OWNER_OFFLINE_MS
});
const strangerMatch = createStrangerMatchHandlers({ db, _, XC, fmtTime });
const agentChat = createAgentChat({ db, _, XC, postJson });

/** 新用户注册序号（xc_meta/registration_seq 自增），用于早鸟等展示 */
async function allocSignupIndex() {
  const ref = db.collection(XC.META).doc('registration_seq');
  try {
    await ref.update({ data: { n: _.inc(1) } });
  } catch (e) {
    try {
      await ref.set({ data: { n: 1 } });
      return 1;
    } catch (e2) {
      console.error('allocSignupIndex bootstrap', e2.message || e2);
      return null;
    }
  }
  const snap = await ref.get().catch(() => ({ data: null }));
  if (!snap.data || snap.data.n == null) return null;
  return Number(snap.data.n);
}

async function handleLogin(openid, event) {
  const col = db.collection(XC.USERS);
  const nick = event.nickname || '';
  const avatarUrl = event.avatarUrl || '';
  const exist = await col.where({ _openid: openid }).limit(1).get();

  if (exist.data.length === 0) {
    const signupIndex = await allocSignupIndex();
    const newRow = {
      _openid: openid,
      nickname: nick || '微信用户',
      avatarUrl: avatarUrl || '',
      phone: '',
      points: 0,
      creditScore: 85,
      rating: 5,
      breachCount: 0,
      tags: [],
      creditRepairDay: '',
      creditRepairDayGain: 0,
      matchModePrefs: {},
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    };
    if (signupIndex != null && !Number.isNaN(signupIndex)) {
      newRow.signupIndex = signupIndex;
    }
    await col.add({
      data: newRow
    });
  } else {
    const patch = { updatedAt: db.serverDate() };
    if (nick) patch.nickname = nick;
    if (avatarUrl) patch.avatarUrl = avatarUrl;
    await col.doc(exist.data[0]._id).update({ data: patch });
  }

  const u = await col.where({ _openid: openid }).limit(1).get();
  const row = u.data[0];
  await patchUserV3Defaults(row._id, row);

  const u2 = await col.where({ _openid: openid }).limit(1).get();
  const row2 = u2.data[0];
  const si =
    row2.signupIndex != null && row2.signupIndex !== ''
      ? Number(row2.signupIndex)
      : null;
  return {
    ok: true,
    openid,
    user: {
      nickname: row2.nickname || '微信用户',
      avatarUrl: row2.avatarUrl || '',
      phone: row2.phone || '',
      points: row2.points || 0,
      signupIndex: si != null && !Number.isNaN(si) ? si : null
    }
  };
}

/** 老用户补齐 V3 个人页 / 信用字段 */
async function patchUserV3Defaults(docId, row) {
  if (!docId || !row) return;
  const patch = {};
  if (row.creditScore == null || row.creditScore === '') patch.creditScore = 85;
  if (row.rating == null || row.rating === '') patch.rating = 5;
  if (row.breachCount == null || row.breachCount === '') patch.breachCount = 0;
  if (!Array.isArray(row.tags)) patch.tags = [];
  if (row.creditRepairDay == null) patch.creditRepairDay = '';
  if (row.creditRepairDayGain == null) patch.creditRepairDayGain = 0;
  if (row.csAssistOffline == null) patch.csAssistOffline = false;
  if (Object.keys(patch).length === 0) return;
  patch.updatedAt = db.serverDate();
  await db.collection(XC.USERS).doc(docId).update({ data: patch }).catch(() => {});
}

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

function defaultStrangerMatchProfile() {
  return {
    collabStance: '',
    tradeStance: '',
    caps: { logistics: false, errand: false }
  };
}

function coerceStrangerMatchProfile(raw) {
  const d = defaultStrangerMatchProfile();
  if (!raw || typeof raw !== 'object') return d;
  const c = String(raw.collabStance || '').trim();
  if (['organizer', 'collaborator', 'both'].includes(c)) d.collabStance = c;
  const t = String(raw.tradeStance || '').trim();
  if (['need', 'supply', 'both'].includes(t)) d.tradeStance = t;
  const caps = raw.caps && typeof raw.caps === 'object' ? raw.caps : {};
  d.caps = {
    logistics: !!caps.logistics,
    errand: !!caps.errand
  };
  return d;
}

async function handleSaveStrangerMatchProfile(openid, event) {
  const ev = event || {};
  const capsIn = ev.caps && typeof ev.caps === 'object' ? ev.caps : {};
  const profile = coerceStrangerMatchProfile({
    collabStance: ev.collabStance,
    tradeStance: ev.tradeStance,
    caps: {
      logistics: ev.capLogistics != null ? !!ev.capLogistics : !!capsIn.logistics,
      errand: ev.capErrand != null ? !!ev.capErrand : !!capsIn.errand
    }
  });
  const ures = await db.collection(XC.USERS).where({ _openid: openid }).limit(1).get();
  if (!ures.data || !ures.data[0]) return { ok: false, errMsg: '用户不存在' };
  try {
    await db.collection(XC.USERS).doc(ures.data[0]._id).update({
      data: { strangerMatchProfile: profile, updatedAt: db.serverDate() }
    });
  } catch (e) {
    console.error('saveStrangerMatchProfile', e);
    return { ok: false, errMsg: '保存失败' };
  }
  return { ok: true, strangerMatchProfile: profile };
}

async function loadPlansForOpenid(openid) {
  const [owned, joined] = await Promise.all([
    db
      .collection(XC.PLANS)
      .where({ _openid: openid })
      .limit(30)
      .get()
      .catch(() => ({ data: [] })),
    db
      .collection(XC.PLANS)
      .where({ memberOpenids: openid })
      .limit(30)
      .get()
      .catch(() => ({ data: [] }))
  ]);
  const map = new Map();
  for (const p of [...(owned.data || []), ...(joined.data || [])]) {
    if (!p || !p._id) continue;
    map.set(p._id, p);
  }
  const list = [...map.values()].sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
  return list;
}

function mapPlanForPublicPreview(p) {
  const status = String((p && p.status) || '');
  let statusLabel = '进行中';
  if (status === 'done') statusLabel = '已完成';
  else if (status === 'archived') statusLabel = '已归档';
  else if (status === 'pending_review') statusLabel = '审核中';
  else if (status === 'matching') statusLabel = '匹配中';
  return {
    id: String(p._id),
    title: String(p.title || '协作计划').slice(0, 80),
    summary: String(p.summary || '').slice(0, 160),
    memberCount: Array.isArray(p.memberOpenids) ? p.memberOpenids.length : 1,
    roomId: p.roomId ? String(p.roomId) : '',
    statusLabel
  };
}

/** 个人中心聚合：信用、标签、最近协作计划 */
async function handleProfile(openid, event) {
  const ev = event || {};
  const rpLimit = Math.min(100, Math.max(1, Number(ev.recentPlansLimit) || 5));

  const ures = await db.collection(XC.USERS).where({ _openid: openid }).limit(1).get();
  const u = ures.data[0];
  if (!u) {
    return {
      ok: true,
      creditScore: 85,
      fulfillRate: 100,
      rating: 5,
      totalPlans: 0,
      completedPlans: 0,
      breachCount: 0,
      tags: [],
      recentPlans: [],
      signupIndex: null,
      strangerMatchProfile: defaultStrangerMatchProfile()
    };
  }

  const plans = await loadPlansForOpenid(openid);
  const totalPlans = plans.length;
  const completedPlans = plans.filter((p) => p.status === 'done' || p.status === 'archived').length;
  const fulfillRate =
    totalPlans > 0 ? Math.min(100, Math.round((completedPlans / totalPlans) * 100)) : 100;

  const recentPlans = plans.slice(0, rpLimit).map((p) => ({
    id: p._id,
    title: p.title || '协作计划',
    status: p.status === 'done' || p.status === 'archived' ? 'done' : 'active',
    memberCount: Array.isArray(p.memberOpenids) ? p.memberOpenids.length : 1,
    roomId: p.roomId || '',
    reviewPending: !!(p.reviewStatus === 'pending' || p.status === 'pending_review')
  }));

  const signupIdx =
    u.signupIndex != null && u.signupIndex !== '' ? Number(u.signupIndex) : null;
  return {
    ok: true,
    creditScore: Number(u.creditScore != null ? u.creditScore : 85),
    fulfillRate,
    rating: Number(u.rating != null ? u.rating : 5),
    totalPlans,
    completedPlans,
    breachCount: Number(u.breachCount != null ? u.breachCount : 0),
    tags: normalizeUserTags(u.tags),
    recentPlans,
    signupIndex: signupIdx != null && !Number.isNaN(signupIdx) ? signupIdx : null,
    strangerMatchProfile: coerceStrangerMatchProfile(u.strangerMatchProfile)
  };
}

/** 查看他人公开资料（邀请/协作场景）；不含手机号等隐私 */
async function handlePublicUserPreview(viewerOpenid, event) {
  const targetOpenid = String((event && event.targetOpenid) || '').trim();
  if (!targetOpenid) return { ok: false, errMsg: '缺少 targetOpenid' };
  if (targetOpenid === viewerOpenid) {
    return { ok: false, errMsg: '请使用「我的」查看本人资料' };
  }

  const ures = await db.collection(XC.USERS).where({ _openid: targetOpenid }).limit(1).get();
  const u = ures.data[0];
  if (!u) return { ok: false, errMsg: '用户不存在或不可见' };

  const plans = await loadPlansForOpenid(targetOpenid);
  const totalPlans = plans.length;
  const completedPlans = plans.filter((p) => p.status === 'done' || p.status === 'archived').length;
  const fulfillRate =
    totalPlans > 0 ? Math.min(100, Math.round((completedPlans / totalPlans) * 100)) : 100;

  const collabMatching = [];
  const collabHistory = [];
  for (const p of plans) {
    const st = String((p && p.status) || '');
    const row = mapPlanForPublicPreview(p);
    if (st === 'done' || st === 'archived') collabHistory.push(row);
    else collabMatching.push(row);
  }

  return {
    ok: true,
    targetOpenid,
    nickname: u.nickname || '微信用户',
    avatarUrl: u.avatarUrl || '',
    tags: normalizeUserTags(u.tags),
    creditScore: Number(u.creditScore != null ? u.creditScore : 85),
    fulfillRate,
    rating: Number(u.rating != null ? u.rating : 5),
    totalPlans,
    completedPlans,
    breachCount: Number(u.breachCount != null ? u.breachCount : 0),
    collabMatching: collabMatching.slice(0, 20),
    collabHistory: collabHistory.slice(0, 20)
  };
}

async function handleSaveUserTags(openid, event) {
  const tags = normalizeUserTags(event.tags);
  await db
    .collection(XC.USERS)
    .where({ _openid: openid })
    .update({
      data: { tags, updatedAt: db.serverDate() }
    })
    .catch(() => {});
  return { ok: true, tags };
}

/** 信用修复：公益 +3 / 互助 +2，单日得分上限 +3（HANDOVER 7.7） */
async function handleCreditRepair(openid, event) {
  const type = String(event.type || '').trim();
  const gainWant = type === 'charity' ? 3 : type === 'help' ? 2 : 0;
  if (!gainWant) return { ok: false, errMsg: 'invalid type' };

  const ures = await db.collection(XC.USERS).where({ _openid: openid }).limit(1).get();
  const row = ures.data[0];
  if (!row) return { ok: false, errMsg: 'no user' };

  const today = new Date().toISOString().slice(0, 10);
  let dayGain = Number(row.creditRepairDayGain || 0);
  if (String(row.creditRepairDay || '') !== today) {
    dayGain = 0;
  }
  const room = Math.max(0, 3 - dayGain);
  const applied = Math.min(gainWant, room);
  if (applied <= 0) {
    return { ok: false, errMsg: 'DAILY_CAP', hint: '今日信用恢复加分已达上限' };
  }

  const score = Math.min(100, Number(row.creditScore != null ? row.creditScore : 85) + applied);
  await db
    .collection(XC.USERS)
    .doc(row._id)
    .update({
      data: {
        creditScore: score,
        creditRepairDay: today,
        creditRepairDayGain: dayGain + applied,
        updatedAt: db.serverDate()
      }
    });

  return { ok: true, creditScore: score, gained: applied };
}

function formatChatHistoryForPlanSnippet(history, lastUserMsg) {
  const lines = [];
  const hist = Array.isArray(history) ? history.slice(-24) : [];
  for (const h of hist) {
    const role = h.role === 'assistant' ? '助手' : h.role === 'user' ? '用户' : null;
    if (!role) continue;
    const c = String(h.content || '').trim();
    if (!c) continue;
    lines.push(`${role}：${c}`);
  }
  const last = String(lastUserMsg || '').trim();
  if (last) lines.push(`用户：${last}`);
  return lines.join('\n');
}

async function handleCreatePlanFromNotebook(openid, event) {
  const notebook = String(event.notebook || '').trim();
  if (notebook.length < 12) {
    return { ok: false, errMsg: '计划书内容过少，请先对话补充要点' };
  }
  const key = process.env.LLM_API_KEY;
  if (!key || !String(key).trim()) {
    return { ok: false, errMsg: '未配置大模型，无法从计划书提取标题' };
  }
  const draft = await tryLlmPlanDraftFromChat(
    '以下为发起人整理的「项目计划书」全文，请据此提取协作计划的 title 与 summary 字段。\n\n' +
      notebook.slice(0, 6000)
  );
  if (!draft || !draft.title) {
    return { ok: false, errMsg: '无法从计划书提取标题，请在对话中补充一句主题' };
  }
  const summary =
    draft.summary && String(draft.summary).trim()
      ? draft.summary
      : notebook.slice(0, 500);
  return collab.handleCreatePlan(openid, {
    title: draft.title,
    summary
  });
}

async function handleChat(openid, event) {
  const message = String(event.message || '').trim();
  const imageFileId = String(event.imageFileId || '').trim();
  /** @type {Array<{ id: string, label: string, ok?: boolean, skipped?: boolean, ms?: number, detail?: string }>} */
  const trace = [];

  if (!message && !imageFileId) return { ok: false, errMsg: 'empty message' };
  if (imageFileId && imageFileId.indexOf('cloud://') !== 0) {
    return { ok: false, errMsg: '无效图片文件' };
  }

  let imageUrls = [];
  if (imageFileId) {
    try {
      const tmp = await cloud.getTempFileURL({ fileList: [imageFileId] });
      const entry = tmp.fileList && tmp.fileList[0];
      const u = entry && entry.tempFileURL;
      if (u && String(u).indexOf('http') === 0) imageUrls = [u];
    } catch (e) {
      console.error('getTempFileURL', e.message || e);
    }
  }

  try {
    let t0 = Date.now();
    let aiText = await tryLlmChat(message || '请看图片并作答。', event.history, {
      imageUrls
    });
    trace.push({
      id: 'llm_primary',
      label: '对话模型',
      ok: !!aiText,
      ms: Date.now() - t0
    });

    if (!aiText && imageUrls.length > 0) {
      t0 = Date.now();
      aiText = await tryLlmChat(
        `用户上传了一张图片。${
          message ? '用户补充说明：' + message : '随便聊两句或问问用户想聊啥都行，不用像客服一样套话。'
        }`,
        event.history
      );
      trace.push({
        id: 'llm_retry_img',
        label: '对话模型（无图理解补试）',
        ok: !!aiText,
        ms: Date.now() - t0
      });
    } else if (!aiText && imageFileId && !imageUrls.length) {
      t0 = Date.now();
      aiText = await tryLlmChat(
        message ||
          '用户尝试上传图片但暂时拉不到图；用一两句说明情况，并建议用文字说说也行，语气自然点。',
        event.history
      );
      trace.push({
        id: 'llm_retry_url',
        label: '对话模型（图链失败补试）',
        ok: !!aiText,
        ms: Date.now() - t0
      });
    }
    if (!aiText) {
      return {
        ok: false,
        errMsg: 'NO_AI_REPLY',
        hint: '未配置或未接通大模型：请在云函数环境配置 LLM_API_KEY，或稍后重试',
        trace
      };
    }

    let planDocOut = String(event.planDocPrevious || '').trim().slice(0, 12000);
    const llmKey = process.env.LLM_API_KEY;
    /** 每轮对话默认「回复 + 合并计划书」两次串行 LLM；合并可关以排查延迟（设 LLM_DISABLE_PLAN_MERGE=1） */
    const mergeDisabled =
      process.env.LLM_DISABLE_PLAN_MERGE === '1' ||
      process.env.LLM_DISABLE_PLAN_MERGE === 'true' ||
      process.env.LLM_DISABLE_PLAN_MERGE === 'yes';
    if (mergeDisabled || !llmKey || !String(llmKey).trim()) {
      trace.push({
        id: 'plan_merge',
        label: '合并计划书',
        skipped: true,
        detail: mergeDisabled ? 'LLM_DISABLE_PLAN_MERGE' : '未配置 LLM_API_KEY'
      });
    } else {
      t0 = Date.now();
      try {
        const snippetBase = formatChatHistoryForPlanSnippet(event.history, message);
        const merged = await tryLlmMergePlanNotebook(planDocOut, snippetBase, aiText);
        const m = String(merged || '').trim();
        const ms = Date.now() - t0;
        if (m.length > 0) planDocOut = m.slice(0, 12000);
        trace.push({
          id: 'plan_merge',
          label: '合并计划书',
          ok: true,
          ms,
          detail: m.length ? '' : '本轮输出与此前相同或为空'
        });
      } catch (e) {
        console.error('mergePlanNotebook', e.message || e);
        trace.push({
          id: 'plan_merge',
          label: '合并计划书',
          ok: false,
          ms: Date.now() - t0,
          detail: String((e && e.message) || e || 'error').slice(0, 120)
        });
      }
    }

    return {
      ok: true,
      reply: aiText,
      source: 'llm',
      planDoc: planDocOut,
      trace
    };
  } catch (e) {
    console.error('LLM error', e.message || e);
    return { ok: false, errMsg: e.message || 'LLM_ERROR', trace };
  }
}

async function handleGenerateDiscoverLayout(openid, event) {
  const message = String(event.message || '').trim();
  if (!message) {
    return { ok: false, errMsg: 'empty_prompt', hint: '请用一句话描述想要的发现页', trace: [] };
  }
  const key = process.env.LLM_API_KEY;
  if (!key || !String(key).trim()) {
    return {
      ok: false,
      errMsg: 'NO_AI_REPLY',
      hint: '未配置 LLM_API_KEY，无法生成布局',
      trace: []
    };
  }
  const trace = [];
  const t0 = Date.now();
  try {
    const prev = String(event.previousLayout || '').trim();
    const { layout, reply } = await tryLlmDiscoverLayout(message, prev);
    trace.push({
      id: 'llm_discover_layout',
      label: '生成发现页布局',
      ok: !!layout,
      ms: Date.now() - t0
    });
    if (!layout) {
      return {
        ok: false,
        errMsg: 'LAYOUT_PARSE_FAIL',
        hint: '模型输出无法解析为版面 JSON，请换种说法或缩短需求后再试',
        trace
      };
    }
    return {
      ok: true,
      layout,
      reply: reply || '已根据你的描述更新发现页布局，返回「发现」即可查看。',
      trace
    };
  } catch (e) {
    console.error('generateDiscoverLayout', e.message || e);
    trace.push({
      id: 'llm_discover_layout',
      label: '生成发现页布局',
      ok: false,
      ms: Date.now() - t0,
      detail: String((e && e.message) || e).slice(0, 120)
    });
    return { ok: false, errMsg: e.message || 'LAYOUT_GEN_ERROR', trace };
  }
}

async function handleNotifications(openid) {
  const res = await db.collection(XC.NOTIFICATIONS).where({ _openid: openid }).limit(50).get();
  const sorted = (res.data || []).sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  const list = sorted.map((n, i) => ({
    id: n._id || i,
    title: n.title,
    desc: n.desc,
    time: fmtTime(n.createdAt),
    read: !!n.read,
    category: n.category || 'general',
    linkRoomId: n.linkRoomId ? String(n.linkRoomId) : '',
    linkPlanId: n.linkPlanId ? String(n.linkPlanId) : '',
    notifyKind: n.notifyKind ? String(n.notifyKind) : '',
    strangerInviteId: n.strangerInviteId ? String(n.strangerInviteId) : ''
  }));
  return { ok: true, notifications: list };
}

async function handleMarkNotifyRead(openid, event) {
  const id = event.notifyId;
  if (!id) return { ok: false };
  await db
    .collection(XC.NOTIFICATIONS)
    .doc(id)
    .update({ data: { read: true } })
    .catch(() => {});
  return { ok: true };
}

async function handleListAddresses(openid) {
  const res = await db
    .collection(XC.ADDRESSES)
    .where({ _openid: openid })
    .limit(50)
    .get()
    .catch(() => ({ data: [] }));
  const sorted = (res.data || []).sort((a, b) => {
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });
  return { ok: true, list: sorted };
}

async function handleSaveAddress(openid, event) {
  const { id, name, phone, detail } = event;
  const payload = {
    name: name || '',
    phone: phone || '',
    detail: detail || '',
    updatedAt: db.serverDate()
  };
  if (id) {
    await db.collection(XC.ADDRESSES).doc(id).update({ data: payload });
    return { ok: true, id };
  }
  const add = await db.collection(XC.ADDRESSES).add({
    data: {
      _openid: openid,
      ...payload,
      createdAt: db.serverDate()
    }
  });
  return { ok: true, id: add._id };
}

async function handleDeleteAddress(openid, event) {
  const id = event.id;
  if (!id) return { ok: false };
  await db.collection(XC.ADDRESSES).doc(id).remove().catch(() => {});
  return { ok: true };
}

async function handleSavePhone(openid, event) {
  const phone = String(event.phone || '').trim().slice(0, 20);
  if (!phone) return { ok: false, errMsg: '请输入手机号' };
  await db
    .collection(XC.USERS)
    .where({ _openid: openid })
    .update({ data: { phone, updatedAt: db.serverDate() } })
    .catch(() => {});
  const u = await db.collection(XC.USERS).where({ _openid: openid }).limit(1).get();
  const row = u.data[0];
  return {
    ok: true,
    user: row
      ? {
          nickname: row.nickname || '微信用户',
          avatarUrl: row.avatarUrl || '',
          phone: row.phone || ''
        }
      : null
  };
}

/** 演示数据：虚拟发布者固定 openid（仅开发） */
const DEMO_PEER_OPENID = 'oDemoPeer0000000000000000001';
const DEMO_RUNNER_OPENID = 'oDemoRunner00000000000000001';

async function ensureDemoActorUsers() {
  const actors = [
    [DEMO_PEER_OPENID, '演示用户·张三'],
    [DEMO_RUNNER_OPENID, '演示用户·李四']
  ];
  for (const [oid, nickname] of actors) {
    const ex = await db.collection(XC.USERS).where({ _openid: oid }).limit(1).get();
    if (!ex.data.length) {
      await db.collection(XC.USERS).add({
        data: {
          _openid: oid,
          nickname,
          avatarUrl: '',
          phone: '',
          points: 0,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
    }
  }
}

/** 需 event.confirm === true；可选 event.collabLoop 写入协作演示闭环 */
async function handleSeedDemoData(openid, event) {
  if (!event || !event.confirm) {
    return { ok: false, errMsg: '请传入 confirm: true 后再写入演示数据' };
  }

  await ensureDemoActorUsers();

  let collabSeed = null;
  if (event.collabLoop) {
    collabSeed = await collab.handleSeedCollabDemo(openid, event);
    if (!collabSeed.ok) {
      return collabSeed;
    }
  }

  await db.collection(XC.NOTIFICATIONS).add({
    data: {
      _openid: openid,
      title: '演示 · 协作数据',
      desc: collabSeed
        ? `演示协作群已创建「${collabSeed.title || ''}」，请到会话打开。`
        : '演示用户已就绪；请勾选 collabLoop 写入协作演示闭环。',
      read: false,
      category: 'general',
      createdAt: db.serverDate()
    }
  });

  return {
    ok: true,
    message: collabSeed
      ? `协作演示已写入：群「${collabSeed.title || ''}」。`
      : '演示用户已就绪；传入 collabLoop 可创建协作群演示数据。',
    collabRoomId: collabSeed && collabSeed.roomId,
    collabPlanId: collabSeed && collabSeed.planId,
    collabTitle: collabSeed && collabSeed.title
  };
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    return {
      ok: false,
      errMsg: 'NO_OPENID',
      hint:
        '无微信用户身份：在云控制台「云端测试」直接点运行时没有 OPENID，属正常现象。请在小程序模拟器/真机里 wx.cloud.callFunction 调用；本地调试时在开发者工具云函数面板勾选模拟小程序调用。若小程序端仍如此，请检查 wx.cloud.init 的 envId 与当前环境一致且已开通云开发。'
    };
  }

  const action = event.action || '';

  try {
    switch (action) {
      case 'login':
        return await handleLogin(openid, event);
      case 'chat':
        return await handleChat(openid, event);
      case 'generateDiscoverLayout':
        return await handleGenerateDiscoverLayout(openid, event);
      case 'notifications':
        return await handleNotifications(openid);
      case 'markNotifyRead':
        return await handleMarkNotifyRead(openid, event);
      case 'listAddresses':
        return await handleListAddresses(openid);
      case 'saveAddress':
        return await handleSaveAddress(openid, event);
      case 'deleteAddress':
        return await handleDeleteAddress(openid, event);
      case 'savePhone':
        return await handleSavePhone(openid, event);
      case 'seedDemoData':
        return await handleSeedDemoData(openid, event);
      case 'profile':
        return await handleProfile(openid, event);
      case 'publicUserPreview':
        return await handlePublicUserPreview(openid, event);
      case 'saveUserTags':
        return await handleSaveUserTags(openid, event);
      case 'saveStrangerMatchProfile':
        return await handleSaveStrangerMatchProfile(openid, event);
      case 'creditRepair':
        return await handleCreditRepair(openid, event);
      case 'createPlanFromNotebook':
        return await handleCreatePlanFromNotebook(openid, event);
      case 'approvePlan':
        return await collab.handleApprovePlan(openid, event);
      case 'setPlanMatchEnabled':
        return await collab.handleSetPlanMatchEnabled(openid, event);
      case 'setPlanMatchPreferences':
        return await collab.handleSetPlanMatchPreferences(openid, event);
      case 'runStrangerMatchScan':
        return await strangerMatch.handleRunStrangerMatchScan(openid, event);
      case 'listMyPendingStrangerMatchInvites':
        return await strangerMatch.handleListMyPendingStrangerMatchInvites(openid);
      case 'acceptStrangerMatchInvite':
        return await strangerMatch.handleAcceptStrangerMatchInvite(openid, event);
      case 'declineStrangerMatchInvite':
        return await strangerMatch.handleDeclineStrangerMatchInvite(openid, event);
      case 'seedStrangerMatchDemoPlans':
        return await strangerMatch.handleSeedStrangerMatchDemoPlans(openid, event);
      case 'getPlanBoard':
        return await collab.handleGetPlanBoard(openid, event);
      case 'setPlanCoverImage':
        return await collab.handleSetPlanCoverImage(openid, event);
      case 'syncPlanMatchDigest':
        return await collab.handleSyncPlanMatchDigest(openid, event);
      case 'getCollabMatchTipContext':
        return await collab.handleGetCollabMatchTipContext(openid, event);
      case 'setCollabMatchWilling':
        return await collab.handleSetCollabMatchWilling(openid, event);
      case 'suggestCollabReply':
        return await collab.handleSuggestCollabReply(openid, event);
      case 'ensureAiCollabRoom':
        return await collab.handleEnsureAiCollabRoom(openid, event);
      case 'listChatRooms':
        return await collab.handleListChatRooms(openid);
      case 'getRoomMessages':
        return await collab.handleGetRoomMessages(openid, event);
      case 'sendRoomMessage':
        return await collab.handleSendRoomMessage(openid, event);
      case 'joinChatRoom':
        return await collab.handleJoinChatRoom(openid, event);
      case 'requestJoinChatRoom':
        return await collab.handleRequestJoinChatRoom(openid, event);
      case 'listRoomJoinRequests':
        return await collab.handleListRoomJoinRequests(openid, event);
      case 'decideRoomJoinRequest':
        return await collab.handleDecideRoomJoinRequest(openid, event);
      case 'getRoomCsState':
        return await collab.handleGetRoomCsState(openid, event);
      case 'setRoomCsAssist':
        return await collab.handleSetRoomCsAssist(openid, event);
      case 'appendRoomCsAiContext':
        return await collab.handleAppendRoomCsAiContext(openid, event);
      case 'heartbeatRoomCsOwner':
        return await collab.handleHeartbeatRoomCsOwner(openid, event);
      case 'getCsAssistPreference':
        return await collab.handleGetCsAssistPreference(openid);
      case 'saveCsAssistPreference':
        return await collab.handleSaveCsAssistPreference(openid, event);
      case 'agentChat':
        return await agentChat.handleAgentChat(openid, event);
      default:
        return { ok: false, errMsg: 'unknown action: ' + action };
    }
  } catch (e) {
    console.error(e);
    return { ok: false, errMsg: e.message || String(e) };
  }
};
