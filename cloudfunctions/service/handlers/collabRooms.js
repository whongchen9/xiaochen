/**
 * 协作计划 / 群聊 / 离线客服相关 handlers（由 index 注入 db、XC 等）
 */
module.exports = function createCollabHandlers(deps) {
  const { db, _, cloud, XC, fmtTime, tryLlmChat, wxMsgSecCheckOrSkip, CS_OWNER_OFFLINE_MS } = deps;

  function parsePlanAdmins() {
    const raw = process.env.PLAN_ADMIN_OPENIDS || '';
    return raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function syncPlanCardFields(planId, patch) {
    const q = await db
      .collection(XC.CHAT_MESSAGES)
      .where({ planId, msgType: 'plan_card' })
      .limit(20)
      .get()
      .catch(() => ({ data: [] }));
    const now = db.serverDate();
    for (const doc of q.data || []) {
      await db
        .collection(XC.CHAT_MESSAGES)
        .doc(doc._id)
        .update({ data: Object.assign({}, patch, { updatedAt: now }) })
        .catch(() => {});
    }
  }

  async function handleCreatePlan(openid, event) {
    const title = String(event.title || '').trim().slice(0, 80);
    if (!title) return { ok: false, errMsg: '缺少计划标题' };
    const summary = String(event.summary || '').trim().slice(0, 500);

    const admins = parsePlanAdmins();
    const needReview = admins.length > 0;
    const reviewStatus = needReview ? 'pending' : 'approved';
    const planStatus = needReview ? 'pending_review' : 'matching';

    // 默认开启参与匹配：照顾不熟悉操作的用户；匹配精度随计划书补充而提高，需关者可自行关闭。
    const planAdd = await db.collection(XC.PLANS).add({
      data: {
        _openid: openid,
        title,
        summary,
        status: planStatus,
        reviewStatus,
        matchEnabled: true,
        strangerPoolEnabled: true,
        autoFormRoomEnabled: true,
        pickBeforeInviteEnabled: false,
        memberOpenids: [openid],
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });

    /** 协作群仅由陌生人匹配（A1–A8）等流程建群；此处只落计划，不写 CHAT_ROOMS / 群消息 */
    return {
      ok: true,
      planId: planAdd._id,
      roomId: '',
      reviewPending: needReview
    };
  }

  async function handleApprovePlan(openid, event) {
    const planId = String(event.planId || '').trim();
    if (!planId) return { ok: false, errMsg: '缺少 planId' };
    const admins = parsePlanAdmins();
    if (!admins.length || !admins.includes(openid)) {
      return { ok: false, errMsg: '无审核权限（需在云函数环境配置 PLAN_ADMIN_OPENIDS）' };
    }

    let p;
    try {
      const pr = await db.collection(XC.PLANS).doc(planId).get();
      p = pr.data;
    } catch (e) {
      return { ok: false, errMsg: '计划不存在' };
    }
    if (!p) return { ok: false, errMsg: '计划不存在' };

    await db
      .collection(XC.PLANS)
      .doc(planId)
      .update({
        data: {
          reviewStatus: 'approved',
          status: 'matching',
          updatedAt: db.serverDate()
        }
      });

    return { ok: true };
  }

  function clampStrangerRevealSeconds(raw) {
    const envN = Number(process.env.STRANGER_MATCH_REVEAL_SECONDS);
    const def = Number.isFinite(envN) && envN > 0 ? Math.round(envN) : 60;
    const n = Number(raw);
    const x = Number.isFinite(n) && n > 0 ? Math.round(n) : def;
    return Math.min(600, Math.max(15, x));
  }

  /** 未写字段视为默认：与产品「默认全开（除先挑人）」一致 */
  function normalizePlanMatchPrefs(row) {
    const p = row || {};
    return {
      matchEnabled: p.matchEnabled !== false,
      strangerPoolEnabled: p.strangerPoolEnabled !== false,
      autoFormRoomEnabled: p.autoFormRoomEnabled !== false,
      pickBeforeInviteEnabled: p.pickBeforeInviteEnabled === true,
      strangerRevealSeconds: clampStrangerRevealSeconds(p.strangerRevealSeconds)
    };
  }

  async function handleSetPlanMatchEnabled(openid, event) {
    const planId = String(event.planId || '').trim();
    const enabled = !!event.enabled;
    if (!planId) return { ok: false, errMsg: '缺少 planId' };

    let p;
    try {
      const pr = await db.collection(XC.PLANS).doc(planId).get();
      p = pr.data;
    } catch (e) {
      return { ok: false, errMsg: '计划不存在' };
    }
    if (!p || p._openid !== openid) return { ok: false, errMsg: '仅发起人可操作' };

    await db
      .collection(XC.PLANS)
      .doc(planId)
      .update({
        data: { matchEnabled: enabled, updatedAt: db.serverDate() }
      });
    await syncPlanCardFields(planId, { matchEnabled: enabled });

    const rid = String(p.roomId || '').trim();
    if (enabled && rid) {
      await syncPlanMatchDigestForRoom(rid, openid).catch(() => {});
    }

    return { ok: true, matchEnabled: enabled };
  }

  /**
   * 计划书页：发起人批量更新匹配相关开关（可部分字段）。
   * strangerPoolEnabled / autoFormRoomEnabled 缺省为 true；pickBeforeInviteEnabled 缺省为 false。
   */
  async function handleSetPlanMatchPreferences(openid, event) {
    const planId = String(event.planId || '').trim();
    if (!planId) return { ok: false, errMsg: '缺少 planId' };
    let p;
    try {
      const pr = await db.collection(XC.PLANS).doc(planId).get();
      p = pr.data;
    } catch (e) {
      return { ok: false, errMsg: '计划不存在' };
    }
    if (!p || p._openid !== openid) return { ok: false, errMsg: '仅发起人可操作' };

    const data = { updatedAt: db.serverDate() };
    let touched = false;
    if (typeof event.matchEnabled === 'boolean') {
      data.matchEnabled = event.matchEnabled;
      touched = true;
    }
    if (typeof event.strangerPoolEnabled === 'boolean') {
      data.strangerPoolEnabled = event.strangerPoolEnabled;
      touched = true;
    }
    if (typeof event.autoFormRoomEnabled === 'boolean') {
      data.autoFormRoomEnabled = event.autoFormRoomEnabled;
      touched = true;
    }
    if (typeof event.pickBeforeInviteEnabled === 'boolean') {
      data.pickBeforeInviteEnabled = event.pickBeforeInviteEnabled;
      touched = true;
    }
    if (event.strangerRevealSeconds != null && event.strangerRevealSeconds !== '') {
      const n = Number(event.strangerRevealSeconds);
      if (Number.isFinite(n)) {
        data.strangerRevealSeconds = clampStrangerRevealSeconds(n);
        touched = true;
      }
    }
    if (!touched) return { ok: false, errMsg: '无有效字段' };

    await db.collection(XC.PLANS).doc(planId).update({ data });

    const merged = Object.assign({}, p, data);
    const prefs = normalizePlanMatchPrefs(merged);

    if (typeof event.matchEnabled === 'boolean') {
      await syncPlanCardFields(planId, { matchEnabled: prefs.matchEnabled });
      const rid = String(p.roomId || '').trim();
      if (prefs.matchEnabled && rid) {
        await syncPlanMatchDigestForRoom(rid, openid).catch(() => {});
      }
    }

    return { ok: true, ...prefs };
  }

  async function addOpenidToRoomAndPlan(rid, roomDoc, openidToAdd) {
    await db
      .collection(XC.CHAT_ROOMS)
      .doc(rid)
      .update({
        data: {
          memberOpenids: _.addToSet(openidToAdd),
          updatedAt: db.serverDate()
        }
      });
    const pid = roomDoc.planId;
    if (pid) {
      await db
        .collection(XC.PLANS)
        .doc(pid)
        .update({
          data: {
            memberOpenids: _.addToSet(openidToAdd),
            updatedAt: db.serverDate()
          }
        })
        .catch(() => {});
    }
  }

  async function planOwnerOpenid(planId) {
    if (!planId) return '';
    try {
      const pr = await db.collection(XC.PLANS).doc(planId).get();
      const p = pr.data;
      return p && p._openid ? String(p._openid) : '';
    } catch (e) {
      return '';
    }
  }

  async function handleJoinChatRoom(openid, event) {
    const roomId = String(event.roomId || '').trim();
    const planId = String(event.planId || '').trim();
    let rid = roomId;
    let roomDoc;

    if (rid) {
      try {
        const r = await db.collection(XC.CHAT_ROOMS).doc(rid).get();
        roomDoc = r.data;
      } catch (e) {
        return { ok: false, errMsg: '协作群不存在' };
      }
      if (!roomDoc) return { ok: false, errMsg: '协作群不存在' };
    } else if (planId) {
      const r = await db
        .collection(XC.CHAT_ROOMS)
        .where({ planId })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }));
      if (!r.data || !r.data[0]) return { ok: false, errMsg: '协作不存在' };
      roomDoc = r.data[0];
      rid = roomDoc._id;
    } else {
      return { ok: false, errMsg: '缺少 roomId 或 planId' };
    }

    const members = Array.isArray(roomDoc.memberOpenids) ? roomDoc.memberOpenids : [];
    const roomTitle = String(roomDoc.title || '协作群').slice(0, 80);
    if (members.includes(openid)) {
      return { ok: true, roomId: rid, alreadyMember: true, roomTitle };
    }

    await addOpenidToRoomAndPlan(rid, roomDoc, openid);

    return { ok: true, roomId: rid, alreadyMember: false, roomTitle };
  }

  async function handleRequestJoinChatRoom(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };

    let roomDoc;
    try {
      const r = await db.collection(XC.CHAT_ROOMS).doc(roomId).get();
      roomDoc = r.data;
    } catch (e) {
      return { ok: false, errMsg: '协作群不存在' };
    }
    if (!roomDoc) return { ok: false, errMsg: '协作群不存在' };

    const members = Array.isArray(roomDoc.memberOpenids) ? roomDoc.memberOpenids : [];
    if (members.includes(openid)) {
      return { ok: true, roomId, alreadyMember: true };
    }

    const ownerOpenid = await planOwnerOpenid(roomDoc.planId);
    if (ownerOpenid && ownerOpenid === openid) {
      await addOpenidToRoomAndPlan(roomId, roomDoc, openid);
      return { ok: true, roomId, alreadyMember: true };
    }

    const existed = await db
      .collection(XC.JOIN_REQUESTS)
      .where({ roomId, applicantOpenid: openid, status: 'pending' })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }));
    if (existed.data && existed.data.length) {
      return { ok: true, roomId, status: 'pending', duplicate: true };
    }

    await db.collection(XC.JOIN_REQUESTS).add({
      data: {
        roomId,
        applicantOpenid: openid,
        status: 'pending',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });

    if (ownerOpenid) {
      await db
        .collection(XC.NOTIFICATIONS)
        .add({
          data: {
            _openid: ownerOpenid,
            title: '协作群入群申请',
            desc: `有人申请加入「${roomDoc.title || '协作群'}」`,
            category: 'match',
            read: false,
            createdAt: db.serverDate()
          }
        })
        .catch(() => {});
    }

    return { ok: true, roomId, status: 'pending' };
  }

  async function assertRoomMember(roomId, openid) {
    let doc;
    try {
      const r = await db.collection(XC.CHAT_ROOMS).doc(roomId).get();
      doc = r.data;
    } catch (e) {
      return { ok: false, errMsg: '房间不存在' };
    }
    if (!doc || !Array.isArray(doc.memberOpenids) || !doc.memberOpenids.includes(openid)) {
      return { ok: false, errMsg: '无权访问该群' };
    }
    return { ok: true, room: doc };
  }

  const MATCH_BOARD_PAGE = 3;

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

  function buildMatchReasonLine(planHaystack, profileJoin, fitScore, intentLabel) {
    const p = String(planHaystack || '').replace(/\s/g, '');
    const raw = String(profileJoin || '').trim();
    if (p.length && raw.length >= 2) {
      for (let len = Math.min(12, raw.length); len >= 2; len--) {
        for (let i = 0; i + len <= raw.length; i++) {
          const seg = raw.slice(i, i + len);
          const sub = seg.replace(/\s/g, '');
          if (sub.length >= 2 && p.includes(sub)) {
            const display = seg.trim().slice(0, 10);
            return `与您计划中「${display}${display.length >= 10 ? '…' : ''}」相关`;
          }
        }
      }
    }
    if (fitScore >= 12) return '与您计划摘要用语重合较多';
    if (fitScore >= 6) return '与对方公开标签有部分重合';
    if (intentLabel) return `对方意向：${intentLabel}，可参考对接`;
    return '群内成员，可尝试邀请沟通';
  }

  function extractOverlapSnippet(matchReason, intentLabel) {
    const m = /与您计划中「([^」]+)/.exec(String(matchReason || ''));
    if (m) return String(m[1] || '').replace(/…$/, '').trim().slice(0, 14);
    if (intentLabel) return intentLabel.slice(0, 14);
    return '需求摘要';
  }

  /** 一句话概括「能帮什么忙」（来自公开标签，非模型生成） */
  function buildHelpOneLiner(intentLabel, mt, rg) {
    const parts = [];
    if (intentLabel) parts.push(`【${intentLabel}】`);
    if (mt) parts.push(String(mt).trim().slice(0, 34));
    else parts.push('可提供协助');
    const regionBit = rg ? String(rg).trim().slice(0, 14) : '';
    let s = parts.join(' ') + (regionBit ? ` · ${regionBit}` : '');
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > 46) s = s.slice(0, 46) + '…';
    return s || '可在个人资料中补充公开标签';
  }

  /**
   * 计划发起人视角：候选人为群内除发起人外的成员；用于计划书列表与群内撮合参考。
   */
  async function computePlanMatchRows(roomDoc, planOwnerOpenid, title, summary, matchEnabled) {
    const members = Array.isArray(roomDoc.memberOpenids) ? roomDoc.memberOpenids : [];
    const slice = members.slice(0, 50);
    let participants = [];
    let userRowMap = {};
    if (slice.length) {
      userRowMap = {};
      /** 微信云 `_.in` 单次数组长度上限为 10 */
      const inMax = 10;
      for (let i = 0; i < slice.length; i += inMax) {
        const part = slice.slice(i, i + inMax);
        const ures = await db
          .collection(XC.USERS)
          .where({ _openid: _.in(part) })
          .limit(part.length)
          .get()
          .catch(() => ({ data: [] }));
        for (const row of ures.data || []) {
          userRowMap[row._openid] = row;
        }
      }
      participants = slice.map((oid) => {
        const row = userRowMap[oid];
        return {
          openid: oid,
          nickname: row && row.nickname ? String(row.nickname) : '用户',
          avatarUrl: row && row.avatarUrl ? String(row.avatarUrl) : ''
        };
      });
    }

    const planHaystack = `${title}\n${summary}`;
    let matchRowsAll = [];
    if (!matchEnabled || !slice.length) {
      return { participants, matchRowsAll };
    }

    const others = planOwnerOpenid
      ? slice.filter((oid) => oid !== planOwnerOpenid)
      : slice.slice();

    const umap = {};
    for (const row of participants) {
      umap[row.openid] = row;
    }

    matchRowsAll = others.map((oid) => {
      const u = umap[oid] || { openid: oid, nickname: '用户', avatarUrl: '' };
      const row = userRowMap[oid];
      const tagArr =
        row && Array.isArray(row.tags) ? row.tags.filter(Boolean).map((t) => String(t).trim()) : [];
      const profileJoin = tagArr.length ? tagArr.slice(0, 12).join(' · ') : '';
      const intentLabel = '';
      const fitScore = roughFitScore(planHaystack, profileJoin);
      const fullPlanText =
        profileJoin ||
        '对方尚未补充公开标签（可在「我的」资料中编辑标签，便于展示契合度）。';
      const matchReason = buildMatchReasonLine(planHaystack, profileJoin, fitScore, intentLabel);
      const overlapSnippet = extractOverlapSnippet(matchReason, intentLabel);
      const helpOneLiner = buildHelpOneLiner(intentLabel, profileJoin, '');
      return {
        openid: oid,
        nickname: u.nickname,
        avatarUrl: u.avatarUrl,
        fitScore,
        matchBrief: fullPlanText,
        fullPlanText,
        matchReason,
        overlapSnippet,
        helpOneLiner
      };
    });
    matchRowsAll.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
    return { participants, matchRowsAll };
  }

  async function findLatestMatchDigestSig(roomId) {
    const r = await db
      .collection(XC.CHAT_MESSAGES)
      .where({ roomId })
      .limit(80)
      .get()
      .catch(() => ({ data: [] }));
    const sorted = (r.data || []).sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });
    for (let i = sorted.length - 1; i >= 0; i--) {
      const m = sorted[i];
      if ((m.msgType || '') === 'match_digest' && m.matchDigestSig) {
        return String(m.matchDigestSig);
      }
    }
    return '';
  }

  async function syncPlanMatchDigestForRoom(roomId, callerOpenid) {
    const rid = String(roomId || '').trim();
    if (!rid || !callerOpenid) return { ok: false, errMsg: '参数不全' };
    const gate = await assertRoomMember(rid, callerOpenid);
    if (!gate.ok) return gate;

    const roomDoc = gate.room;
    const pid = String(roomDoc.planId || '').trim();
    if (!pid) return { ok: true, skipped: true };

    let title = String(roomDoc.title || '').trim();
    let summary = '';
    let matchEnabled = true;
    let planOwnerOpenid = '';
    try {
      const pr = await db.collection(XC.PLANS).doc(pid).get();
      const p = pr.data;
      if (p) {
        title = String(p.title || title).trim();
        summary = String(p.summary || '').trim();
        matchEnabled = p.matchEnabled !== false;
        planOwnerOpenid = p._openid ? String(p._openid) : '';
      }
    } catch (e) {}

    if (!matchEnabled) return { ok: true, skipped: true };

    const { matchRowsAll } = await computePlanMatchRows(roomDoc, planOwnerOpenid, title, summary, matchEnabled);
    const top3 = matchRowsAll.slice(0, 3);
    if (!top3.length) return { ok: true, skipped: true };

    const sig = `${pid}:${top3.map((r) => r.openid).join(',')}`;
    const prevSig = await findLatestMatchDigestSig(rid);
    if (prevSig === sig) return { ok: true, skipped: true };

    const blocks = top3.map((r) => {
      const nick = r.nickname || '用户';
      const ov = String(r.overlapSnippet || '需求').trim().slice(0, 14);
      const help = String(r.helpOneLiner || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 52);
      return `推荐联系人：${nick} · 与您计划中「${ov}」相关；对方已在平台填写可提供：${help}${help.length >= 52 ? '…' : ''}。如需对接，请在计划书页点「邀请」发起分享，或让对方通过链接申请入群。`;
    });
    const content =
      `【系统说明 · 推荐联系人】以下为根据计划与成员撮合简介筛出的参考人选（非对方本人发言）：\n\n` +
      blocks.map((b, i) => `${i + 1}）${b}`).join('\n\n') +
      `\n\n发起人可在计划书页使用「换一批」查看更多群内成员。`;

    await db.collection(XC.CHAT_MESSAGES).add({
      data: {
        roomId: rid,
        _openid: '__system_match__',
        role: 'system',
        msgType: 'match_digest',
        content,
        matchDigestSig: sig,
        createdAt: db.serverDate()
      }
    });
    await db
      .collection(XC.CHAT_ROOMS)
      .doc(rid)
      .update({ data: { lastMsgAt: db.serverDate() } })
      .catch(() => {});

    const roomTitle = String(roomDoc.title || '协作群').slice(0, 40);
    for (const row of top3) {
      await db
        .collection(XC.NOTIFICATIONS)
        .add({
          data: {
            _openid: row.openid,
            title: '有一条与您简介相近的协作需求',
            desc: `群「${roomTitle}」的计划与您的撮合简介匹配度较高。点按本条查看摘要，并可表态「愿意对接」或生成一句回复草稿（需您亲自发送）。`,
            category: 'match',
            read: false,
            linkRoomId: rid,
            linkPlanId: pid,
            notifyKind: 'collab_match_digest',
            createdAt: db.serverDate()
          }
        })
        .catch(() => {});
    }

    return { ok: true, inserted: true };
  }

  async function handleSyncPlanMatchDigest(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    return syncPlanMatchDigestForRoom(roomId, openid);
  }

  async function handleListRoomJoinRequests(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const ownerOpenid = await planOwnerOpenid(gate.room.planId);
    if (!ownerOpenid || ownerOpenid !== openid) {
      return { ok: false, errMsg: '仅发起人可处理入群申请' };
    }

    const r = await db
      .collection(XC.JOIN_REQUESTS)
      .where({ roomId, status: 'pending' })
      .limit(50)
      .get()
      .catch(() => ({ data: [] }));
    const requests = (r.data || []).map((row) => ({
      id: row._id,
      applicantOpenid: row.applicantOpenid || '',
      createdAt: fmtTime(row.createdAt)
    }));
    return { ok: true, requests };
  }

  async function handleDecideRoomJoinRequest(openid, event) {
    const roomId = String(event.roomId || '').trim();
    const applicantOpenid = String(event.applicantOpenid || '').trim();
    const approve = !!event.approve;
    if (!roomId || !applicantOpenid) return { ok: false, errMsg: '参数不全' };

    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const ownerOpenid = await planOwnerOpenid(gate.room.planId);
    if (!ownerOpenid || ownerOpenid !== openid) {
      return { ok: false, errMsg: '仅发起人可操作' };
    }

    const req = await db
      .collection(XC.JOIN_REQUESTS)
      .where({ roomId, applicantOpenid, status: 'pending' })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }));
    const doc = req.data && req.data[0];
    if (!doc) return { ok: false, errMsg: '没有待处理的申请' };

    await db
      .collection(XC.JOIN_REQUESTS)
      .doc(doc._id)
      .update({
        data: {
          status: approve ? 'approved' : 'rejected',
          updatedAt: db.serverDate()
        }
      });

    const title = gate.room.title || '协作群';
    if (approve) {
      await addOpenidToRoomAndPlan(roomId, gate.room, applicantOpenid);
      await db
        .collection(XC.NOTIFICATIONS)
        .add({
          data: {
            _openid: applicantOpenid,
            title: '入群申请已通过',
            desc: `发起人已通过你加入「${title}」`,
            category: 'general',
            read: false,
            createdAt: db.serverDate()
          }
        })
        .catch(() => {});
      await syncPlanMatchDigestForRoom(roomId, openid).catch(() => {});
    } else {
      await db
        .collection(XC.NOTIFICATIONS)
        .add({
          data: {
            _openid: applicantOpenid,
            title: '入群申请未通过',
            desc: `发起人未通过你加入「${title}」的申请`,
            category: 'general',
            read: false,
            createdAt: db.serverDate()
          }
        })
        .catch(() => {});
    }

    return { ok: true, approved: approve };
  }

  async function roomLastMessagePreview(roomId) {
    if (!roomId) return '';
    try {
      const r = await db
        .collection(XC.CHAT_MESSAGES)
        .where({ roomId })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      const m = (r.data || [])[0];
      if (!m) return '';
      const t = m.msgType || 'text';
      if (t === 'image') return '[图片]';
      if (t === 'plan_card') return '[协作计划]';
      if (t === 'match_digest') return '[匹配参考]';
      if (t === 'system') {
        const c = String(m.content || '').trim().replace(/\s+/g, ' ');
        return c ? (c.length > 48 ? c.slice(0, 48) + '…' : c) : '[系统消息]';
      }
      const c = String(m.content || '').trim().replace(/\s+/g, ' ');
      return c ? (c.length > 48 ? c.slice(0, 48) + '…' : c) : '';
    } catch (e) {
      return '';
    }
  }

  async function handleListChatRooms(openid) {
    const r = await db
      .collection(XC.CHAT_ROOMS)
      .where({ memberOpenids: openid })
      .limit(80)
      .get()
      .catch(() => ({ data: [] }));
    const rows = (r.data || []).sort((a, b) => {
      const ta = a.lastMsgAt ? new Date(a.lastMsgAt).getTime() : 0;
      const tb = b.lastMsgAt ? new Date(b.lastMsgAt).getTime() : 0;
      return tb - ta;
    });
    const planIds = [...new Set(rows.map((row) => row.planId).filter(Boolean))];
    const planMap = new Map();
    await Promise.all(
      planIds.map(async (pid) => {
        try {
          const pr = await db.collection(XC.PLANS).doc(pid).get();
          if (pr.data) planMap.set(pid, pr.data);
        } catch (e) {
          /* skip */
        }
      })
    );
    const previewLimit = 32;
    const topIds = rows.slice(0, previewLimit).map((row) => row._id).filter(Boolean);
    const previewMap = new Map();
    await Promise.all(
      topIds.map(async (rid) => {
        const s = await roomLastMessagePreview(rid);
        previewMap.set(rid, s);
      })
    );
    const list = rows.map((row) => {
      const p = row.planId ? planMap.get(row.planId) : null;
      const reviewPending = !!(
        p &&
        (p.reviewStatus === 'pending' || p.status === 'pending_review')
      );
      const lastMessage = previewMap.get(row._id) || '';
      return {
        roomId: row._id,
        title: row.title || '协作群',
        planId: row.planId || '',
        lastMsgAt: fmtTime(row.lastMsgAt),
        lastMsgAtMs: row.lastMsgAt ? new Date(row.lastMsgAt).getTime() : 0,
        lastMessage: lastMessage || '暂无消息',
        reviewPending,
        matchEnabled: p ? p.matchEnabled !== false : true
      };
    });
    return { ok: true, rooms: list };
  }

  async function attachRoomImageTempUrls(items) {
    const ids = [];
    const seen = new Set();
    for (const m of items) {
      const fid = m.imageFileId;
      if (
        (m.msgType || 'text') === 'image' &&
        fid &&
        String(fid).indexOf('cloud://') === 0 &&
        !seen.has(fid)
      ) {
        seen.add(fid);
        ids.push(fid);
      }
    }
    if (!ids.length) return items;
    let urlMap = {};
    try {
      const tmp = await cloud.getTempFileURL({ fileList: ids });
      for (const row of tmp.fileList || []) {
        if (row.fileID && row.tempFileURL && String(row.tempFileURL).indexOf('http') === 0) {
          urlMap[row.fileID] = row.tempFileURL;
        }
      }
    } catch (e) {
      console.error('attachRoomImageTempUrls', e.message || e);
    }
    return items.map((m) => {
      if ((m.msgType || 'text') !== 'image' || !m.imageFileId) return m;
      const u = urlMap[m.imageFileId];
      return u ? Object.assign({}, m, { imageTempUrl: u }) : m;
    });
  }

  async function handleGetRoomMessages(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;

    const r = await db
      .collection(XC.CHAT_MESSAGES)
      .where({ roomId })
      .limit(80)
      .get()
      .catch(() => ({ data: [] }));
    const sorted = (r.data || []).sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return ta - tb;
    });
    const tail = sorted.slice(-50);
    const items = tail.map((m) => {
      const mt = m.msgType || 'text';
      const base = {
        id: m._id,
        role: m.role || 'user',
        msgType: mt,
        content: m.content || '',
        imageFileId: m.imageFileId || '',
        time: fmtTime(m.createdAt),
        senderOpenid: m._openid || '',
        isAssistant: (m.role || '') === 'assistant'
      };
      if (mt === 'match_digest') {
        return Object.assign({}, base, {
          role: 'system',
          msgType: 'match_digest',
          content: m.content || '',
          imageFileId: '',
          isMatchDigest: true,
          isAssistant: false
        });
      }
      if (mt === 'plan_card') {
        return Object.assign({}, base, {
          planId: m.planId || '',
          planTitle: m.planTitle || m.content || '',
          planSummary: m.planSummary || '',
          matchEnabled: m.matchEnabled !== false,
          isPlanCard: true,
          isAssistant: false
        });
      }
      return base;
    });
    const messages = await attachRoomImageTempUrls(items);
    const planId = String((gate.room && gate.room.planId) || '').trim();
    return { ok: true, messages, title: gate.room.title || '协作群', planId };
  }

  async function maybeReplyAsCsAssistant(roomId, senderOpenid, userContent, roomDoc) {
    try {
      const planId = roomDoc.planId;
      if (!planId) return;
      const ownerOpenid = await planOwnerOpenid(planId);
      if (!ownerOpenid || senderOpenid === ownerOpenid) return;

      const ures = await db.collection(XC.USERS).where({ _openid: ownerOpenid }).limit(1).get();
      const urow = ures.data[0];
      if (!urow || !urow.csAssistOffline) return;

      const csSnap = await db.collection(XC.ROOM_CS).doc(roomId).get().catch(() => ({ data: null }));
      const cs = csSnap.data;
      if (!cs || !cs.assistOfflineEnabled) return;

      const lastSeen = cs.ownerLastSeenAt ? new Date(cs.ownerLastSeenAt).getTime() : 0;
      if (lastSeen && Date.now() - lastSeen < CS_OWNER_OFFLINE_MS) return;

      const ctx = String(cs.aiContextText || '').slice(0, 5000);
      const prompt = `你是微信小程序「即DAO」里的「协作助手」，正在临时替协作项目主理人回复群里的提问。\n\n主理人先前与 AI 整理的项目要点（摘录，可能不完整）：\n${ctx || '（暂无摘录）'}\n\n群成员刚发送的消息：${userContent}\n\n请用简短、友好、口语化的中文回复；不得编造价格或承诺；不清楚时请说明会请主理人上线后再答复。`;
      const reply = await tryLlmChat(prompt, []);
      if (!reply) return;

      const replyChk = await wxMsgSecCheckOrSkip(reply);
      if (!replyChk.ok) {
        console.error('maybeReplyAsCsAssistant msgSecCheck', replyChk.errMsg || replyChk.code);
        return;
      }

      await db.collection(XC.CHAT_MESSAGES).add({
        data: {
          roomId,
          _openid: '__system_cs__',
          role: 'assistant',
          content: reply,
          createdAt: db.serverDate()
        }
      });
      await db
        .collection(XC.CHAT_ROOMS)
        .doc(roomId)
        .update({ data: { lastMsgAt: db.serverDate() } })
        .catch(() => {});
    } catch (e) {
      console.error('maybeReplyAsCsAssistant', e.message || e);
    }
  }

  async function handleSendRoomMessage(openid, event) {
    const roomId = String(event.roomId || '').trim();
    const msgType = String(event.msgType || 'text').trim();
    const imageFileId = String(event.imageFileId || '').trim();
    let content = String(event.content || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };

    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;

    if (msgType === 'plan_card' || msgType === 'match_digest') {
      return { ok: false, errMsg: '不支持的消息类型' };
    }

    if (msgType === 'image') {
      if (!imageFileId || imageFileId.indexOf('cloud://') !== 0) {
        return { ok: false, errMsg: '无效图片文件' };
      }
      content = content.slice(0, 200);
      if (content) {
        const capChk = await wxMsgSecCheckOrSkip(content);
        if (!capChk.ok) {
          return { ok: false, errMsg: capChk.errMsg || '图片说明未通过安全检查' };
        }
      }
      await db.collection(XC.CHAT_MESSAGES).add({
        data: {
          roomId,
          _openid: openid,
          role: 'user',
          msgType: 'image',
          imageFileId,
          content,
          createdAt: db.serverDate()
        }
      });
      await maybeReplyAsCsAssistant(roomId, openid, '[图片]', gate.room);
    } else {
      content = content.slice(0, 500);
      if (!content) return { ok: false, errMsg: 'empty message' };
      const txtChk = await wxMsgSecCheckOrSkip(content);
      if (!txtChk.ok) {
        return { ok: false, errMsg: txtChk.errMsg || '内容未通过安全检查' };
      }
      await db.collection(XC.CHAT_MESSAGES).add({
        data: {
          roomId,
          _openid: openid,
          role: 'user',
          msgType: 'text',
          content,
          createdAt: db.serverDate()
        }
      });
      await maybeReplyAsCsAssistant(roomId, openid, content, gate.room);
    }

    await db
      .collection(XC.CHAT_ROOMS)
      .doc(roomId)
      .update({
        data: { lastMsgAt: db.serverDate() }
      })
      .catch(() => {});

    return { ok: true };
  }

  async function handleGetRoomCsState(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const ownerOpenid = await planOwnerOpenid(gate.room.planId);
    const isOwner = !!(ownerOpenid && ownerOpenid === openid);
    let assistEnabled = false;
    const csSnap = await db.collection(XC.ROOM_CS).doc(roomId).get().catch(() => ({ data: null }));
    if (csSnap.data) assistEnabled = !!csSnap.data.assistOfflineEnabled;
    return { ok: true, isOwner, assistEnabled };
  }

  async function handleSetRoomCsAssist(openid, event) {
    const roomId = String(event.roomId || '').trim();
    const enabled = !!event.enabled;
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const ownerOpenid = await planOwnerOpenid(gate.room.planId);
    if (!ownerOpenid || ownerOpenid !== openid) {
      return { ok: false, errMsg: '仅发起人可设置' };
    }
    const ref = db.collection(XC.ROOM_CS).doc(roomId);
    const exist = await ref.get().catch(() => ({ data: null }));
    const now = db.serverDate();
    if (!exist.data) {
      await ref.set({
        data: {
          roomId,
          assistOfflineEnabled: enabled,
          aiContextText: '',
          ownerLastSeenAt: now,
          createdAt: now,
          updatedAt: now
        }
      });
    } else {
      await ref.update({
        data: { assistOfflineEnabled: enabled, updatedAt: now }
      });
    }
    return { ok: true };
  }

  async function handleAppendRoomCsAiContext(openid, event) {
    const roomId = String(event.roomId || '').trim();
    const segment = String(event.segment || '').trim().slice(0, 4000);
    if (!roomId || !segment) return { ok: false, errMsg: '缺少 roomId 或 segment' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const ownerOpenid = await planOwnerOpenid(gate.room.planId);
    if (!ownerOpenid || ownerOpenid !== openid) {
      return { ok: false, errMsg: '仅发起人可写入摘要' };
    }
    const ref = db.collection(XC.ROOM_CS).doc(roomId);
    const exist = await ref.get().catch(() => ({ data: null }));
    const prev = (exist.data && exist.data.aiContextText) || '';
    const next = (prev + '\n' + segment).slice(-6000);
    const now = db.serverDate();
    if (!exist.data) {
      await ref.set({
        data: {
          roomId,
          aiContextText: next,
          assistOfflineEnabled: false,
          ownerLastSeenAt: now,
          createdAt: now,
          updatedAt: now
        }
      });
    } else {
      await ref.update({ data: { aiContextText: next, updatedAt: now } });
    }
    return { ok: true };
  }

  async function handleHeartbeatRoomCsOwner(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const ownerOpenid = await planOwnerOpenid(gate.room.planId);
    if (!ownerOpenid || ownerOpenid !== openid) return { ok: false, errMsg: '仅发起人可心跳' };
    const ref = db.collection(XC.ROOM_CS).doc(roomId);
    const exist = await ref.get().catch(() => ({ data: null }));
    const now = db.serverDate();
    if (!exist.data) {
      await ref.set({
        data: {
          roomId,
          assistOfflineEnabled: false,
          aiContextText: '',
          ownerLastSeenAt: now,
          createdAt: now,
          updatedAt: now
        }
      });
    } else {
      await ref.update({ data: { ownerLastSeenAt: now, updatedAt: now } });
    }
    return { ok: true };
  }

  async function handleGetCsAssistPreference(openid) {
    const ures = await db.collection(XC.USERS).where({ _openid: openid }).limit(1).get();
    const row = ures.data[0];
    const enabled = !!(row && row.csAssistOffline);
    return { ok: true, enabled };
  }

  async function handleSaveCsAssistPreference(openid, event) {
    const enabled = !!event.enabled;
    const exist = await db.collection(XC.USERS).where({ _openid: openid }).limit(1).get();
    if (!exist.data.length) return { ok: false, errMsg: '用户不存在' };
    await db
      .collection(XC.USERS)
      .doc(exist.data[0]._id)
      .update({
        data: { csAssistOffline: enabled, updatedAt: db.serverDate() }
      });
    return { ok: true, enabled };
  }

  /** 计划书页：已在群内的成员查看标题摘要与正式成员头像（非候选人列表） */
  async function handleGetPlanBoard(openid, event) {
    const roomId = String(event.roomId || '').trim();
    const planIdIn = String(event.planId || '').trim();
    let rid = roomId;
    let roomDoc;

    if (rid) {
      try {
        const r = await db.collection(XC.CHAT_ROOMS).doc(rid).get();
        roomDoc = r.data;
      } catch (e) {
        roomDoc = null;
      }
    } else if (planIdIn) {
      const r = await db
        .collection(XC.CHAT_ROOMS)
        .where({ planId: planIdIn })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }));
      roomDoc = r.data && r.data[0];
      rid = roomDoc ? roomDoc._id : '';
      if (!roomDoc) {
        let pOnly;
        try {
          const pr = await db.collection(XC.PLANS).doc(planIdIn).get();
          pOnly = pr.data;
        } catch (e) {
          pOnly = null;
        }
        if (!pOnly) return { ok: false, errMsg: '协作不存在' };
        const ownerOid = pOnly._openid ? String(pOnly._openid) : '';
        const mems =
          Array.isArray(pOnly.memberOpenids) && pOnly.memberOpenids.length
            ? pOnly.memberOpenids.slice(0, 50)
            : ownerOid
              ? [ownerOid]
              : [];
        if (ownerOid !== openid && !mems.includes(openid)) {
          return { ok: false, errMsg: '无权查看' };
        }
        roomDoc = {
          _id: '',
          planId: planIdIn,
          memberOpenids: mems,
          title: String(pOnly.title || '').trim()
        };
        rid = '';
      }
    } else {
      return { ok: false, errMsg: '缺少 roomId 或 planId' };
    }

    if (!roomDoc) return { ok: false, errMsg: '协作不存在' };
    const members = Array.isArray(roomDoc.memberOpenids) ? roomDoc.memberOpenids : [];
    if (!members.includes(openid)) return { ok: false, errMsg: '无权查看' };

    const pid = String(roomDoc.planId || '').trim();
    let title = String(roomDoc.title || '').trim();
    let summary = '';
    let reviewPending = false;
    let matchEnabled = true;
    let strangerPoolEnabled = true;
    let autoFormRoomEnabled = true;
    let pickBeforeInviteEnabled = false;
    let strangerRevealSeconds = 60;
    let planOwnerOpenid = '';
    let coverImageFileId = '';
    let coverImageTempUrl = '';
    if (pid) {
      try {
        const pr = await db.collection(XC.PLANS).doc(pid).get();
        const p = pr.data;
        if (p) {
          title = String(p.title || title).trim();
          summary = String(p.summary || '').trim();
          reviewPending = String(p.reviewStatus || '') === 'pending';
          const prefs = normalizePlanMatchPrefs(p);
          matchEnabled = prefs.matchEnabled;
          strangerPoolEnabled = prefs.strangerPoolEnabled;
          autoFormRoomEnabled = prefs.autoFormRoomEnabled;
          pickBeforeInviteEnabled = prefs.pickBeforeInviteEnabled;
          strangerRevealSeconds = prefs.strangerRevealSeconds;
          planOwnerOpenid = p._openid ? String(p._openid) : '';
          coverImageFileId = String(p.coverImageFileId || '').trim();
          if (coverImageFileId && coverImageFileId.indexOf('cloud://') === 0) {
            try {
              const tmp = await cloud.getTempFileURL({ fileList: [coverImageFileId] });
              const ent = tmp.fileList && tmp.fileList[0];
              const u = ent && ent.tempFileURL;
              if (u && String(u).indexOf('http') === 0) coverImageTempUrl = String(u);
            } catch (e) {
              /* skip */
            }
          }
        }
      } catch (e) {}
    }

    const batch = Math.max(0, parseInt(event.matchBatch, 10) || 0);
    const { participants, matchRowsAll } = await computePlanMatchRows(
      roomDoc,
      planOwnerOpenid,
      title,
      summary,
      matchEnabled
    );
    const start = batch * MATCH_BOARD_PAGE;
    const matchRows = matchRowsAll.slice(start, start + MATCH_BOARD_PAGE);
    const matchTotal = matchRowsAll.length;
    const matchBatchCount = matchTotal ? Math.max(1, Math.ceil(matchTotal / MATCH_BOARD_PAGE)) : 1;

    return {
      ok: true,
      roomId: rid,
      planId: pid,
      title,
      summary,
      reviewPending,
      matchEnabled,
      strangerPoolEnabled,
      autoFormRoomEnabled,
      pickBeforeInviteEnabled,
      strangerRevealSeconds,
      isPlanOwner: !!(planOwnerOpenid && planOwnerOpenid === openid),
      participants,
      matchRows,
      matchBatch: batch,
      matchBatchCount,
      matchTotal,
      coverImageFileId,
      coverImageTempUrl
    };
  }

  /** 计划书配图：仅发起人；传空 coverImageFileId 表示移除 */
  async function handleSetPlanCoverImage(openid, event) {
    const planId = String((event && event.planId) || '').trim();
    const raw = String((event && event.coverImageFileId) || '').trim();
    if (!planId) return { ok: false, errMsg: '缺少 planId' };
    let doc;
    try {
      const pr = await db.collection(XC.PLANS).doc(planId).get();
      doc = pr.data;
    } catch (e) {
      return { ok: false, errMsg: '计划不存在' };
    }
    if (!doc) return { ok: false, errMsg: '计划不存在' };
    if (String(doc._openid || '') !== openid) {
      return { ok: false, errMsg: '仅计划发起人可设置配图' };
    }
    if (raw && raw.indexOf('cloud://') !== 0) {
      return { ok: false, errMsg: '无效云文件路径' };
    }
    const data = raw
      ? { coverImageFileId: raw, updatedAt: db.serverDate() }
      : { coverImageFileId: _.remove(), updatedAt: db.serverDate() };
    try {
      await db.collection(XC.PLANS).doc(planId).update({ data });
    } catch (e) {
      return { ok: false, errMsg: (e && e.message) || '保存失败' };
    }
    return { ok: true, coverImageFileId: raw };
  }

  function titleFromAiNotebook(nb) {
    const lines = String(nb || '')
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return (lines[0] || '协作对话').slice(0, 80);
  }

  /**
   * 与 AI 会话绑定的云端计划：幂等创建/更新 PLANS（不写「会话即群」、不落群消息）。
   * 协作群仅由陌生人匹配（A1–A8）等流程创建。
   */
  async function handleEnsureAiCollabRoom(openid, event) {
    const aiSessionId = String(event.aiSessionId || '').trim();
    if (!aiSessionId) return { ok: false, errMsg: '缺少 aiSessionId' };

    const existQ = await db
      .collection(XC.PLANS)
      .where({ aiSessionId })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }));
    if (existQ.data && existQ.data.length) {
      const p = existQ.data[0];
      if (p._openid !== openid) return { ok: false, errMsg: '无权访问该会话' };
      const pid = p._id;

      const notebook = String(event.notebook || '').trim();
      let outTitle = String(p.title || '').trim() || '协作对话';
      if (notebook.length >= 12) {
        const nextTitle = titleFromAiNotebook(notebook);
        const summary = notebook.slice(0, 500);
        outTitle = nextTitle;
        await db
          .collection(XC.PLANS)
          .doc(pid)
          .update({
            data: { title: nextTitle, summary, updatedAt: db.serverDate() }
          })
          .catch(() => {});
      }

      return {
        ok: true,
        planId: pid,
        title: outTitle,
        existed: true
      };
    }

    const notebook = String(event.notebook || '').trim();
    const title = titleFromAiNotebook(notebook || '协作对话');
    const summary =
      notebook.length >= 12
        ? notebook.slice(0, 500)
        : '在对话中补充协作要点，助手会帮你整理进计划书。';

    const planAdd = await db.collection(XC.PLANS).add({
      data: {
        _openid: openid,
        aiSessionId,
        title,
        summary,
        status: 'matching',
        reviewStatus: 'approved',
        matchEnabled: true,
        strangerPoolEnabled: true,
        autoFormRoomEnabled: true,
        pickBeforeInviteEnabled: false,
        memberOpenids: [openid],
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });

    return {
      ok: true,
      planId: planAdd._id,
      title,
      existed: false
    };
  }

  async function handleGetCollabMatchTipContext(openid, event) {
    const roomId = String(event.roomId || '').trim();
    const planIdIn = String(event.planId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const pid = planIdIn || String(gate.room.planId || '').trim();
    const ownerOid = await planOwnerOpenid(pid);
    const isOwner = !!(ownerOid && ownerOid === openid);
    let planTitle = String(gate.room.title || '').trim() || '协作';
    let planSummary = '';
    if (pid) {
      try {
        const pr = await db.collection(XC.PLANS).doc(pid).get();
        const p = pr.data;
        if (p) {
          planTitle = String(p.title || planTitle).trim();
          planSummary = String(p.summary || '').trim().slice(0, 400);
        }
      } catch (e) {
        /* skip */
      }
    }
    return {
      ok: true,
      roomId,
      planId: pid,
      planTitle,
      planSummary,
      roomTitle: String(gate.room.title || '').trim() || '协作群',
      isOwner
    };
  }

  async function handleSetCollabMatchWilling(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    if (event.willing !== true) return { ok: false, errMsg: '请明确选择愿意对接' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const pid = String(gate.room.planId || '').trim();
    const ownerOpenid = await planOwnerOpenid(pid);
    if (ownerOpenid && ownerOpenid === openid) {
      return { ok: false, errMsg: '发起人无需在此表态' };
    }

    const ures = await db.collection(XC.USERS).where({ _openid: openid }).limit(1).get();
    const nick =
      ures.data && ures.data[0] && ures.data[0].nickname
        ? String(ures.data[0].nickname).trim().slice(0, 24)
        : '成员';

    await db.collection(XC.CHAT_MESSAGES).add({
      data: {
        roomId,
        _openid: '__system_match__',
        role: 'system',
        msgType: 'text',
        content: `【系统】成员「${nick}」已通过匹配提示表示愿意进一步对接。发起人可在群内沟通，或在计划书查看「为您筛好的协作者」。`,
        createdAt: db.serverDate()
      }
    });
    await db
      .collection(XC.CHAT_ROOMS)
      .doc(roomId)
      .update({ data: { lastMsgAt: db.serverDate() } })
      .catch(() => {});

    if (ownerOpenid) {
      const rt = String(gate.room.title || '协作').slice(0, 36);
      await db
        .collection(XC.NOTIFICATIONS)
        .add({
          data: {
            _openid: ownerOpenid,
            title: '成员愿意对接',
            desc: `「${nick}」表示愿意对接您的协作「${rt}」，可进群查看系统说明。`,
            category: 'match',
            read: false,
            linkRoomId: roomId,
            linkPlanId: pid,
            notifyKind: 'collab_peer_willing',
            createdAt: db.serverDate()
          }
        })
        .catch(() => {});
    }

    return { ok: true };
  }

  async function handleSuggestCollabReply(openid, event) {
    const roomId = String(event.roomId || '').trim();
    if (!roomId) return { ok: false, errMsg: '缺少 roomId' };
    const gate = await assertRoomMember(roomId, openid);
    if (!gate.ok) return gate;
    const pid = String(gate.room.planId || '').trim();
    let planTitle = String(gate.room.title || '').trim() || '协作';
    if (pid) {
      try {
        const pr = await db.collection(XC.PLANS).doc(pid).get();
        if (pr.data && pr.data.title) planTitle = String(pr.data.title).trim().slice(0, 80);
      } catch (e) {
        /* skip */
      }
    }
    const draft = `您好，我看到协作「${planTitle}」的需求说明。方便的话我们可以在群里细聊对接方式。`;
    return { ok: true, draft: draft.slice(0, 500) };
  }

  /** 与 index.js seedDemoData 使用同一套虚拟 openid，便于撮合闭环演示 */
  const SEED_COLLAB_PEER_OID = 'oDemoPeer0000000000000000001';
  const SEED_COLLAB_RUNNER_OID = 'oDemoRunner00000000000000001';

  async function removeSeedCollabPlansForOpenid(ownerOpenid) {
    const pr = await db
      .collection(XC.PLANS)
      .where({ _openid: ownerOpenid })
      .limit(100)
      .get()
      .catch(() => ({ data: [] }));
    for (const p of pr.data || []) {
      if (!/^\[演示闭环\]/.test(String(p.title || ''))) continue;
      const pid = p._id;
      const rid = String(p.roomId || '').trim();
      if (rid) {
        let batch;
        do {
          batch = await db
            .collection(XC.CHAT_MESSAGES)
            .where({ roomId: rid })
            .limit(100)
            .get()
            .catch(() => ({ data: [] }));
          for (const m of batch.data || []) {
            await db.collection(XC.CHAT_MESSAGES).doc(m._id).remove().catch(() => {});
          }
        } while ((batch.data || []).length >= 100);
        await db.collection(XC.CHAT_ROOMS).doc(rid).remove().catch(() => {});
      }
      await db.collection(XC.PLANS).doc(pid).remove().catch(() => {});
    }
  }

  async function upsertSeedCollabUser(seedOpenid, nickname) {
    const ex = await db.collection(XC.USERS).where({ _openid: seedOpenid }).limit(1).get();
    if (!ex.data.length) {
      await db.collection(XC.USERS).add({
        data: {
          _openid: seedOpenid,
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

  /** 写入演示协作群：计划 + 两名虚拟成员 + 计划卡片 + 撮合参考 */
  async function handleSeedCollabDemo(openid, event) {
    if (!event || !event.confirm) {
      return { ok: false, errMsg: '请传入 confirm: true' };
    }

    await removeSeedCollabPlansForOpenid(openid);

    await upsertSeedCollabUser(SEED_COLLAB_PEER_OID, '演示用户·张三');
    await upsertSeedCollabUser(SEED_COLLAB_RUNNER_OID, '演示用户·李四');

    const title = '[演示闭环] 社区团购蔬菜配送协作';
    const summary =
      '需要高州城区熟悉社群运营的伙伴，帮忙对接菜场货源与夜班分拣，报酬面议。';

    const planAdd = await db.collection(XC.PLANS).add({
      data: {
        _openid: openid,
        title,
        summary,
        status: 'matching',
        reviewStatus: 'approved',
        matchEnabled: true,
        strangerPoolEnabled: true,
        autoFormRoomEnabled: true,
        pickBeforeInviteEnabled: false,
        memberOpenids: [openid, SEED_COLLAB_PEER_OID, SEED_COLLAB_RUNNER_OID],
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });

    const roomAdd = await db.collection(XC.CHAT_ROOMS).add({
      data: {
        planId: planAdd._id,
        title,
        memberOpenids: [openid, SEED_COLLAB_PEER_OID, SEED_COLLAB_RUNNER_OID],
        createdAt: db.serverDate(),
        lastMsgAt: db.serverDate()
      }
    });

    await db
      .collection(XC.PLANS)
      .doc(planAdd._id)
      .update({
        data: { roomId: roomAdd._id, updatedAt: db.serverDate() }
      });

    await db.collection(XC.CHAT_MESSAGES).add({
      data: {
        roomId: roomAdd._id,
        _openid: '__seed_collab__',
        role: 'system',
        msgType: 'text',
        content:
          '【演示】群内已包含两名虚拟成员，用于查看「撮合参考」与计划书参与人员排序。',
        createdAt: db.serverDate()
      }
    });

    await db.collection(XC.CHAT_MESSAGES).add({
      data: {
        roomId: roomAdd._id,
        _openid: openid,
        role: 'system',
        msgType: 'plan_card',
        planId: planAdd._id,
        content: title,
        planTitle: title,
        planSummary: summary,
        matchEnabled: true,
        createdAt: db.serverDate()
      }
    });

    await db
      .collection(XC.CHAT_ROOMS)
      .doc(roomAdd._id)
      .update({ data: { lastMsgAt: db.serverDate() } })
      .catch(() => {});

    await syncPlanMatchDigestForRoom(roomAdd._id, openid).catch(() => {});

    return {
      ok: true,
      roomId: roomAdd._id,
      planId: planAdd._id,
      title
    };
  }

  return {
    handleCreatePlan,
    handleApprovePlan,
    handleSetPlanMatchEnabled,
    handleSetPlanMatchPreferences,
    handleGetPlanBoard,
    handleSetPlanCoverImage,
    handleSyncPlanMatchDigest,
    handleGetCollabMatchTipContext,
    handleSetCollabMatchWilling,
    handleSuggestCollabReply,
    handleEnsureAiCollabRoom,
    handleJoinChatRoom,
    handleRequestJoinChatRoom,
    handleListRoomJoinRequests,
    handleDecideRoomJoinRequest,
    handleListChatRooms,
    handleGetRoomMessages,
    handleSendRoomMessage,
    handleGetRoomCsState,
    handleSetRoomCsAssist,
    handleAppendRoomCsAiContext,
    handleHeartbeatRoomCsOwner,
    handleGetCsAssistPreference,
    handleSaveCsAssistPreference,
    handleSeedCollabDemo
  };
};
