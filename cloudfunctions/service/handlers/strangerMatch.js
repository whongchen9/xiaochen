/**
 * 陌生人计划匹配：扫描池、自动建群（S1 新群）或邀请后同意建群。
 * 依赖集合 xc_stranger_match_invites（需在云控制台创建）。
 * 扫描池条数上限：环境变量 STRANGER_MATCH_POOL_LIMIT（40–200，默认 120）。
 */
'use strict';

module.exports = function createStrangerMatchHandlers(deps) {
  const { db, _, XC, fmtTime } = deps;

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

  function clampRevealSeconds(raw) {
    const envN = Number(process.env.STRANGER_MATCH_REVEAL_SECONDS);
    const def = Number.isFinite(envN) && envN > 0 ? Math.round(envN) : 60;
    const n = Number(raw);
    const x = Number.isFinite(n) && n > 0 ? Math.round(n) : def;
    return Math.min(600, Math.max(15, x));
  }

  function normalizePlanPrefs(p) {
    const row = p || {};
    return {
      matchEnabled: row.matchEnabled !== false,
      strangerPoolEnabled: row.strangerPoolEnabled !== false,
      autoFormRoomEnabled: row.autoFormRoomEnabled !== false,
      pickBeforeInviteEnabled: row.pickBeforeInviteEnabled === true,
      strangerRevealSeconds: clampRevealSeconds(row.strangerRevealSeconds)
    };
  }

  function mergedRevealSeconds(prefsA, prefsB) {
    return Math.max(
      clampRevealSeconds(prefsA && prefsA.strangerRevealSeconds),
      clampRevealSeconds(prefsB && prefsB.strangerRevealSeconds)
    );
  }

  /** 相对「当前调用方计划」的匹配面状态，与 HANDOVER §7.9 一致 */
  function matchSurfaceFromPrefs(myPick, theirPick) {
    if (myPick && theirPick) return 'P2_BOTH';
    if (!myPick && !theirPick) return 'P0_NONE';
    if (myPick && !theirPick) return 'P1_MINE';
    return 'P1_THEIRS';
  }

  function sortedPairKey(idA, idB) {
    const a = String(idA);
    const b = String(idB);
    return a <= b ? `${a}:${b}` : `${b}:${a}`;
  }

  function planHay(p) {
    return `${String(p.title || '').trim()}\n${String(p.summary || '').trim()}`;
  }

  function minAutoScore() {
    const n = Number(process.env.STRANGER_MATCH_MIN_AUTO);
    return Number.isFinite(n) && n > 0 ? n : 36;
  }

  function minInviteScore() {
    const n = Number(process.env.STRANGER_MATCH_MIN_INVITE);
    return Number.isFinite(n) && n > 0 ? n : 22;
  }

  /** 扫描池单次拉取上限；可用云函数环境变量 STRANGER_MATCH_POOL_LIMIT 覆盖（40–200，默认 120） */
  function strangerPoolQueryLimit() {
    const raw = process.env.STRANGER_MATCH_POOL_LIMIT;
    const n = raw == null || raw === '' ? 120 : Number(String(raw).trim());
    if (!Number.isFinite(n)) return 120;
    return Math.min(200, Math.max(40, Math.round(n)));
  }

  function inviteDbErrorPayload(e) {
    const msg = String((e && e.message) || e || '');
    if (
      /collection.*not exist|集合不存在|DATABASE_COLLECTION_NOT_EXIST|-502005|Db or collection not exist|database collection not exist/i.test(
        msg
      )
    ) {
      return {
        ok: false,
        errCode: 'STRANGER_INVITES_DB',
        errMsg:
          '数据库缺少集合 xc_stranger_match_invites。请在微信云开发控制台「数据库」中新建该集合（权限见 docs/HANDOVER.md §7.9 周边说明）后重新上传云函数并重试。'
      };
    }
    return null;
  }

  function normalizeMatchProfileRow(raw) {
    const d = { collabStance: '', tradeStance: '', caps: { logistics: false, errand: false } };
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

  function matchProfileHaystack(p) {
    const n = normalizeMatchProfileRow(p);
    let s = '';
    if (n.collabStance === 'organizer') s += '组织发起组局协调分工';
    else if (n.collabStance === 'collaborator') s += '配合参与执行协作';
    else if (n.collabStance === 'both') s += '发起与参与协作';
    if (n.tradeStance === 'need') s += '需要找人找服务需求方';
    else if (n.tradeStance === 'supply') s += '提供服务可接单供给方';
    else if (n.tradeStance === 'both') s += '需求与供给';
    if (n.caps.logistics) s += '物流运输大件';
    if (n.caps.errand) s += '跑腿代办同城';
    return s;
  }

  function collabComplementBonus(a, b) {
    const x = String(a || '').trim();
    const y = String(b || '').trim();
    if (!x || !y) return 0;
    if (
      (x === 'organizer' && y === 'collaborator') ||
      (x === 'collaborator' && y === 'organizer')
    ) {
      return 10;
    }
    if (x === 'both' || y === 'both') return 5;
    if (x === y) return 2;
    return 0;
  }

  function tradeComplementBonus(a, b) {
    const x = String(a || '').trim();
    const y = String(b || '').trim();
    if (!x || !y) return 0;
    if ((x === 'need' && y === 'supply') || (x === 'supply' && y === 'need')) return 8;
    if (x === 'both' || y === 'both') return 4;
    if (x === y) return 1;
    return 0;
  }

  async function loadUserMatchContextMap(openids) {
    const unique = [...new Set(openids)].filter(Boolean).slice(0, 100);
    const map = Object.create(null);
    /** 微信云 `_.in` 单次数组长度上限为 10，超出会抛错导致云函数 145 退出 */
    const chunk = 10;
    for (let i = 0; i < unique.length; i += chunk) {
      const part = unique.slice(i, i + chunk);
      if (!part.length) continue;
      const r = await db
        .collection(XC.USERS)
        .where({ _openid: _.in(part) })
        .limit(part.length)
        .get()
        .catch(() => ({ data: [] }));
      for (const row of r.data || []) {
        const oid = row._openid;
        if (!oid) continue;
        map[oid] = {
          tags: Array.isArray(row.tags)
            ? row.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 16)
            : [],
          matchProfile: normalizeMatchProfileRow(row.strangerMatchProfile)
        };
      }
    }
    const empty = { tags: [], matchProfile: normalizeMatchProfileRow(null) };
    for (const oid of unique) {
      if (!map[oid]) map[oid] = Object.assign({}, empty);
    }
    return map;
  }

  async function loadUserPublicMap(openids) {
    const unique = [...new Set(openids)].filter(Boolean).slice(0, 100);
    const map = Object.create(null);
    const chunk = 10;
    for (let i = 0; i < unique.length; i += chunk) {
      const part = unique.slice(i, i + chunk);
      if (!part.length) continue;
      const r = await db
        .collection(XC.USERS)
        .where({ _openid: _.in(part) })
        .limit(part.length)
        .get()
        .catch(() => ({ data: [] }));
      for (const row of r.data || []) {
        const oid = row._openid;
        if (!oid) continue;
        map[oid] = {
          nickname: row.nickname ? String(row.nickname).slice(0, 32) : '用户',
          avatarUrl: row.avatarUrl ? String(row.avatarUrl) : ''
        };
      }
    }
    for (const oid of unique) {
      if (!map[oid]) map[oid] = { nickname: '用户', avatarUrl: '' };
    }
    return map;
  }

  function strangerFitScore(planMine, planOther, ctxMine, ctxOther) {
    const tagsMine = (ctxMine && ctxMine.tags) || [];
    const tagsOther = (ctxOther && ctxOther.tags) || [];
    const profMine = (ctxMine && ctxMine.matchProfile) || normalizeMatchProfileRow(null);
    const profOther = (ctxOther && ctxOther.matchProfile) || normalizeMatchProfileRow(null);
    const h1 = planHay(planMine);
    const h2 = planHay(planOther);
    const t1 = tagsMine.length ? tagsMine.join('·') : '';
    const t2 = tagsOther.length ? tagsOther.join('·') : '';
    let s = roughFitScore(h1, h2);
    s += roughFitScore(h1, t2);
    s += roughFitScore(h2, t1);
    s += Math.floor(roughFitScore(String(planMine.title || ''), String(planOther.title || '')) / 2);
    const hayMine = matchProfileHaystack(profMine);
    const hayOther = matchProfileHaystack(profOther);
    if (hayMine) s += Math.floor(roughFitScore(h2, hayMine) * 0.35);
    if (hayOther) s += Math.floor(roughFitScore(h1, hayOther) * 0.35);
    s += collabComplementBonus(profMine.collabStance, profOther.collabStance);
    s += tradeComplementBonus(profMine.tradeStance, profOther.tradeStance);
    return s;
  }

  async function findBlockingDoc(pairKey) {
    const r = await db
      .collection(XC.STRANGER_MATCH_INVITES)
      .where({ pairKey })
      .limit(40)
      .get()
      .catch(() => ({ data: [] }));
    const now = Date.now();
    const cool = 86400000 * 3;
    for (const doc of r.data || []) {
      const st = String(doc.status || '');
      if (st === 'pending') return doc;
      if ((st === 'accepted' || st === 'auto_created') && doc.roomId) return doc;
      if (st === 'declined' || st === 'rejected') {
        const ts = doc.createdAt ? new Date(doc.createdAt).getTime() : 0;
        if (now - ts < cool) return doc;
      }
    }
    return null;
  }

  async function createBridgeRoomAndPlan(ownerOpenid, oidA, oidB, title, summary, sourcePlanIdA, sourcePlanIdB) {
    const planAdd = await db.collection(XC.PLANS).add({
      data: {
        _openid: ownerOpenid,
        title: title.slice(0, 80),
        summary: summary.slice(0, 500),
        status: 'matching',
        reviewStatus: 'approved',
        matchEnabled: true,
        strangerPoolEnabled: false,
        autoFormRoomEnabled: false,
        pickBeforeInviteEnabled: false,
        strangerBridge: true,
        strangerSourcePlanIds: [String(sourcePlanIdA), String(sourcePlanIdB)],
        memberOpenids: [oidA, oidB],
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
    const roomAdd = await db.collection(XC.CHAT_ROOMS).add({
      data: {
        planId: planAdd._id,
        title: title.slice(0, 80),
        memberOpenids: [oidA, oidB],
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
        _openid: ownerOpenid,
        role: 'system',
        msgType: 'text',
        content:
          '【陌生人协作群】系统已根据双方计划匹配度创建本群。请自行核实对方身份与约定；平台不提供担保、支付与履约。',
        createdAt: db.serverDate()
      }
    });
    await db.collection(XC.CHAT_MESSAGES).add({
      data: {
        roomId: roomAdd._id,
        _openid: ownerOpenid,
        role: 'system',
        msgType: 'plan_card',
        planId: planAdd._id,
        content: title.slice(0, 80),
        planTitle: title.slice(0, 80),
        planSummary: summary.slice(0, 500),
        matchEnabled: true,
        createdAt: db.serverDate()
      }
    });
    await db
      .collection(XC.CHAT_ROOMS)
      .doc(roomAdd._id)
      .update({ data: { lastMsgAt: db.serverDate() } })
      .catch(() => {});
    return { planId: planAdd._id, roomId: roomAdd._id };
  }

  async function notifyUser(openid, payload) {
    await db
      .collection(XC.NOTIFICATIONS)
      .add({
        data: Object.assign(
          {
            _openid: openid,
            read: false,
            category: 'match',
            createdAt: db.serverDate()
          },
          payload
        )
      })
      .catch(() => {});
  }

  async function handleRunStrangerMatchScan(openid, event) {
    const planId = String((event && event.planId) || '').trim();
    if (!planId) return { ok: false, errMsg: '缺少 planId' };

    let mine;
    try {
      const pr = await db.collection(XC.PLANS).doc(planId).get();
      mine = pr.data;
    } catch (e) {
      return { ok: false, errMsg: '计划不存在' };
    }
    if (!mine || mine._openid !== openid) {
      return { ok: false, errMsg: '仅计划发起人可发起扫描' };
    }
    if (mine.strangerBridge) {
      return { ok: true, skipped: true, reason: 'bridge_plan' };
    }

    const myPrefs = normalizePlanPrefs(mine);
    if (!myPrefs.strangerPoolEnabled) {
      return { ok: true, skipped: true, reason: 'pool_off' };
    }

    try {
    const minAuto = minAutoScore();
    const minInv = minInviteScore();

    const poolLimit = strangerPoolQueryLimit();
    const all = await db
      .collection(XC.PLANS)
      .where({ status: 'matching' })
      .limit(poolLimit)
      .get()
      .catch(() => ({ data: [] }));

    const rows = (all.data || [])
      .filter((p) => p && p._id && p._id !== planId && !p.strangerBridge)
      .filter((p) => p._openid && p._openid !== openid)
      .filter((p) => normalizePlanPrefs(p).strangerPoolEnabled);

    const ownerIds = rows.map((p) => String(p._openid || '')).filter(Boolean);
    const ctxMap = await loadUserMatchContextMap([openid].concat(ownerIds));
    const ctxMine = ctxMap[openid] || { tags: [], matchProfile: normalizeMatchProfileRow(null) };

    const scored = [];
    for (const other of rows.slice(0, poolLimit)) {
      const otherOwner = String(other._openid || '');
      if (!otherOwner) continue;
      const ctxOther = ctxMap[otherOwner] || { tags: [], matchProfile: normalizeMatchProfileRow(null) };
      const fit = strangerFitScore(mine, other, ctxMine, ctxOther);
      const op = normalizePlanPrefs(other);
      scored.push({ plan: other, fit, prefs: op, otherOwner });
    }
    scored.sort((a, b) => b.fit - a.fit);
    const best = scored[0];
    const surfaceFor = (b) =>
      !b
        ? 'P0_NONE'
        : matchSurfaceFromPrefs(myPrefs.pickBeforeInviteEnabled, b.prefs.pickBeforeInviteEnabled);
    const revealFor = (b) =>
      !b ? myPrefs.strangerRevealSeconds : mergedRevealSeconds(myPrefs, b.prefs);

    if (!best || best.fit < minInv) {
      return {
        ok: true,
        matched: false,
        bestScore: best ? best.fit : 0,
        minAuto,
        minInvite: minInv,
        surface: surfaceFor(best),
        revealSeconds: revealFor(best)
      };
    }

    const otherPid = String(best.plan._id);
    const pairKey = sortedPairKey(planId, otherPid);
    const block = await findBlockingDoc(pairKey);
    if (block) {
      return {
        ok: true,
        matched: false,
        reason: 'blocked_or_cooldown',
        bestScore: best.fit,
        surface: surfaceFor(best),
        revealSeconds: revealFor(best)
      };
    }

    const needInvite =
      myPrefs.pickBeforeInviteEnabled ||
      best.prefs.pickBeforeInviteEnabled ||
      !myPrefs.autoFormRoomEnabled ||
      !best.prefs.autoFormRoomEnabled;

    const surface = surfaceFor(best);
    const revealSeconds = revealFor(best);
    const mineTitle = String(mine.title || '协作计划').slice(0, 80);
    const mineSummary = String(mine.summary || '').slice(0, 500);
    const peerPlanTitle = String(best.plan.title || '协作计划').slice(0, 80);
    const peerPlanSummary = String(best.plan.summary || '').slice(0, 500);
    const pubMap = await loadUserPublicMap([openid, best.otherOwner]);
    const peerPub = pubMap[best.otherOwner] || { nickname: '用户', avatarUrl: '' };

    const title = `协作：${String(mine.title || '').slice(0, 28)} × ${String(best.plan.title || '').slice(0, 28)}`;
    const summary = `【匹配度 ${best.fit}】我方摘要：${String(mine.summary || '').slice(0, 200)}；对方摘要：${String(
      best.plan.summary || ''
    ).slice(0, 200)}`;

    if (!needInvite && best.fit >= minAuto) {
      const oidA = openid <= best.otherOwner ? openid : best.otherOwner;
      const oidB = openid <= best.otherOwner ? best.otherOwner : openid;
      const ownerOpenid = oidA;
      const { planId: bridgePlanId, roomId } = await createBridgeRoomAndPlan(
        ownerOpenid,
        oidA,
        oidB,
        title,
        summary,
        planId,
        otherPid
      );
      await db.collection(XC.STRANGER_MATCH_INVITES).add({
        data: {
          pairKey,
          mode: 'auto',
          status: 'auto_created',
          fromPlanId: planId,
          toPlanId: otherPid,
          inviterOpenid: openid,
          inviteeOpenid: best.otherOwner,
          fitScore: best.fit,
          bridgePlanId,
          roomId,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
      await notifyUser(openid, {
        title: '已为你与对方创建协作群',
        desc: '系统判断双方计划匹配度较高，已自动建群。',
        linkRoomId: String(roomId),
        linkPlanId: String(bridgePlanId),
        notifyKind: 'stranger_match_room'
      });
      await notifyUser(best.otherOwner, {
        title: '已为你与对方创建协作群',
        desc: '系统判断双方计划匹配度较高，已自动建群。',
        linkRoomId: String(roomId),
        linkPlanId: String(bridgePlanId),
        notifyKind: 'stranger_match_room'
      });
      return {
        ok: true,
        matched: true,
        mode: 'auto',
        roomId,
        bridgePlanId,
        fitScore: best.fit,
        surface,
        revealSeconds,
        mineTitle,
        mineSummary,
        peerPlanTitle,
        peerPlanSummary,
        peerOpenid: best.otherOwner,
        peerNickname: peerPub.nickname,
        peerAvatarUrl: peerPub.avatarUrl
      };
    }

    if (needInvite && best.fit >= minInv) {
      const add = await db.collection(XC.STRANGER_MATCH_INVITES).add({
        data: {
          pairKey,
          mode: 'invite',
          status: 'pending',
          fromPlanId: planId,
          toPlanId: otherPid,
          inviterOpenid: openid,
          inviteeOpenid: best.otherOwner,
          fitScore: best.fit,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
      const inviteId = add._id;
      await notifyUser(best.otherOwner, {
        title: '协作邀请',
        desc: `「${String(mine.title || '协作计划').slice(0, 24)}」与您的计划较契合（匹配度 ${best.fit}）。打开通知同意后可建立新协作群。`,
        category: 'match',
        notifyKind: 'stranger_match_invite',
        strangerInviteId: String(inviteId),
        linkPlanId: String(planId)
      });
      await notifyUser(openid, {
        title: '已发送协作邀请',
        desc: `已向「${String(best.plan.title || '对方计划').slice(0, 24)}」发起人发送邀请，待对方同意建群。`,
        category: 'match',
        notifyKind: 'stranger_match_invite_sent',
        strangerInviteId: String(inviteId),
        linkPlanId: String(planId)
      });
      return {
        ok: true,
        matched: true,
        mode: 'invite_pending',
        inviteId: String(inviteId),
        fitScore: best.fit,
        surface,
        revealSeconds,
        mineTitle,
        mineSummary,
        peerPlanTitle,
        peerPlanSummary,
        peerOpenid: best.otherOwner,
        peerNickname: peerPub.nickname,
        peerAvatarUrl: peerPub.avatarUrl
      };
    }

    return {
      ok: true,
      matched: false,
      bestScore: best.fit,
      minAuto,
      minInvite: minInv,
      surface,
      revealSeconds
    };
    } catch (e) {
      console.error('runStrangerMatchScan', e && e.stack ? e.stack : e);
      const miss = inviteDbErrorPayload(e);
      if (miss) return miss;
      return { ok: false, errMsg: (e && e.message) || String(e) };
    }
  }

  async function handleListMyPendingStrangerMatchInvites(openid) {
    const r = await db
      .collection(XC.STRANGER_MATCH_INVITES)
      .where({ inviteeOpenid: openid, status: 'pending' })
      .limit(8)
      .get()
      .catch(() => ({ data: [] }));
    const invites = [];
    for (const doc of r.data || []) {
      const fp = String(doc.fromPlanId || '').trim();
      if (!fp) continue;
      let fromPlanTitle = '协作计划';
      let fromPlanSummary = '';
      try {
        const pr = await db.collection(XC.PLANS).doc(fp).get();
        const p = pr.data;
        if (p) {
          fromPlanTitle = String(p.title || fromPlanTitle).slice(0, 80);
          fromPlanSummary = String(p.summary || '').slice(0, 500);
        }
      } catch (e) {}
      invites.push({
        inviteId: String(doc._id),
        fromPlanId: fp,
        fromPlanTitle,
        fromPlanSummary,
        fitScore: doc.fitScore != null ? Number(doc.fitScore) : 0
      });
    }
    return { ok: true, invites };
  }

  async function handleAcceptStrangerMatchInvite(openid, event) {
    const inviteId = String((event && event.inviteId) || '').trim();
    if (!inviteId) return { ok: false, errMsg: '缺少 inviteId' };

    let doc;
    try {
      const r = await db.collection(XC.STRANGER_MATCH_INVITES).doc(inviteId).get();
      doc = r.data;
    } catch (e) {
      const miss = inviteDbErrorPayload(e);
      if (miss) return miss;
      return { ok: false, errMsg: '邀请不存在' };
    }
    if (!doc) return { ok: false, errMsg: '邀请不存在' };
    if (String(doc.inviteeOpenid || '') !== openid) {
      return { ok: false, errMsg: '仅受邀人可同意' };
    }
    if (String(doc.status || '') !== 'pending') {
      return { ok: false, errMsg: '邀请已处理' };
    }

    let planMine;
    let planOther;
    try {
      planMine = (await db.collection(XC.PLANS).doc(String(doc.fromPlanId)).get()).data;
      planOther = (await db.collection(XC.PLANS).doc(String(doc.toPlanId)).get()).data;
    } catch (e) {
      return { ok: false, errMsg: '计划数据异常' };
    }
    if (!planMine || !planOther) return { ok: false, errMsg: '计划不存在' };

    const oidInviter = String(doc.inviterOpenid || '');
    const oidInvitee = String(doc.inviteeOpenid || '');
    const oidA = oidInviter <= oidInvitee ? oidInviter : oidInvitee;
    const oidB = oidInviter <= oidInvitee ? oidInvitee : oidInviter;
    const ownerOpenid = oidA;
    const title = `协作：${String(planMine.title || '').slice(0, 28)} × ${String(planOther.title || '').slice(0, 28)}`;
    const summary = `【匹配度 ${doc.fitScore || 0}·邀请确认】${String(planMine.summary || '').slice(0, 220)} / ${String(
      planOther.summary || ''
    ).slice(0, 220)}`;

    const { planId: bridgePlanId, roomId } = await createBridgeRoomAndPlan(
      ownerOpenid,
      oidA,
      oidB,
      title,
      summary,
      String(doc.fromPlanId),
      String(doc.toPlanId)
    );

    try {
      await db
        .collection(XC.STRANGER_MATCH_INVITES)
        .doc(inviteId)
        .update({
          data: {
            status: 'accepted',
            bridgePlanId,
            roomId,
            updatedAt: db.serverDate()
          }
        });
    } catch (e) {
      const miss = inviteDbErrorPayload(e);
      if (miss) return miss;
      throw e;
    }

    await notifyUser(oidInviter, {
      title: '对方已接受协作邀请',
      desc: '已建立新协作群，可进入会话查看。',
      linkRoomId: String(roomId),
      linkPlanId: String(bridgePlanId),
      notifyKind: 'stranger_match_room'
    });
    await notifyUser(oidInvitee, {
      title: '协作群已创建',
      desc: '你已同意邀请，新协作群已可用。',
      linkRoomId: String(roomId),
      linkPlanId: String(bridgePlanId),
      notifyKind: 'stranger_match_room'
    });

    return { ok: true, roomId, bridgePlanId };
  }

  async function handleDeclineStrangerMatchInvite(openid, event) {
    const inviteId = String((event && event.inviteId) || '').trim();
    if (!inviteId) return { ok: false, errMsg: '缺少 inviteId' };
    let doc;
    try {
      const r = await db.collection(XC.STRANGER_MATCH_INVITES).doc(inviteId).get();
      doc = r.data;
    } catch (e) {
      const miss = inviteDbErrorPayload(e);
      if (miss) return miss;
      return { ok: false, errMsg: '邀请不存在' };
    }
    if (!doc) return { ok: false, errMsg: '邀请不存在' };
    if (String(doc.inviteeOpenid || '') !== openid) {
      return { ok: false, errMsg: '仅受邀人可操作' };
    }
    if (String(doc.status || '') !== 'pending') {
      return { ok: false, errMsg: '邀请已处理' };
    }
    try {
      await db
        .collection(XC.STRANGER_MATCH_INVITES)
        .doc(inviteId)
        .update({
          data: { status: 'declined', updatedAt: db.serverDate() }
        });
    } catch (e) {
      const miss = inviteDbErrorPayload(e);
      if (miss) return miss;
      throw e;
    }
    const inviter = String(doc.inviterOpenid || '').trim();
    if (inviter) {
      await notifyUser(inviter, {
        title: '协作邀请未接受',
        desc: '对方暂未接受本次协作邀请。',
        category: 'match',
        notifyKind: 'stranger_match_declined'
      });
    }
    return { ok: true };
  }

  const DEMO_PEER_OID = 'oDemoPeer0000000000000000001';
  const DEMO_RUNNER_OID = 'oDemoRunner00000000000000001';

  /**
   * 开发用：写入两条「高州·社区团购」主题演示计划（分属两个演示 openid），便于真实账号扫描陌生人匹配。
   * 需 event.confirm === true；会各建 plan+room+plan_card；重复执行会再插入新行（测试后可在控制台删）。
   */
  async function handleSeedStrangerMatchDemoPlans(_openid, event) {
    if (!event || !event.confirm) {
      return { ok: false, errMsg: '请传 confirm: true 后再写入' };
    }
    const demoTags = ['高州城区', '社区团购', '蔬菜配送', '夜班分拣'];
    for (const [oid, nick] of [
      [DEMO_PEER_OID, '演示用户·张三'],
      [DEMO_RUNNER_OID, '演示用户·李四']
    ]) {
      const ex = await db
        .collection(XC.USERS)
        .where({ _openid: oid })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }));
      if (!ex.data || !ex.data.length) {
        await db.collection(XC.USERS).add({
          data: {
            _openid: oid,
            nickname: nick,
            avatarUrl: '',
            phone: '',
            points: 0,
            tags: demoTags,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
      } else {
        await db
          .collection(XC.USERS)
          .doc(ex.data[0]._id)
          .update({
            data: { tags: demoTags, updatedAt: db.serverDate() }
          })
          .catch(() => {});
      }
    }

    async function onePlan(oid, title, summary) {
      const planAdd = await db.collection(XC.PLANS).add({
        data: {
          _openid: oid,
          title,
          summary,
          status: 'matching',
          reviewStatus: 'approved',
          matchEnabled: true,
          strangerPoolEnabled: true,
          autoFormRoomEnabled: true,
          pickBeforeInviteEnabled: false,
          memberOpenids: [oid],
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
      const roomAdd = await db.collection(XC.CHAT_ROOMS).add({
        data: {
          planId: planAdd._id,
          title,
          memberOpenids: [oid],
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
          _openid: oid,
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
      return { planId: planAdd._id, roomId: roomAdd._id };
    }

    const title1 = '[演示·陌生人] 社区团购蔬菜配送';
    const summary1 =
      '需要高州城区熟悉社群运营的伙伴，帮忙对接菜场货源与夜班分拣，报酬面议。希望对方有电动车、能夜间响应。';
    const title2 = '[演示·陌生人] 团购蔬菜夜间分拣互助';
    const summary2 =
      '本人在高州城区可做夜班分拣，可协助社群接龙统计；有电动车，时间灵活。希望对接团购蔬菜类需求。';

    const p1 = await onePlan(DEMO_PEER_OID, title1, summary1);
    const p2 = await onePlan(DEMO_RUNNER_OID, title2, summary2);

    return {
      ok: true,
      message:
        '已写入两条演示计划（张三/李四）。请用你的真实账号在 AI 对话里整理类似主题计划书并创建协作计划，打开计划书页点「扫描陌生人匹配」。',
      plans: [p1, p2]
    };
  }

  return {
    handleRunStrangerMatchScan,
    handleListMyPendingStrangerMatchInvites,
    handleAcceptStrangerMatchInvite,
    handleDeclineStrangerMatchInvite,
    handleSeedStrangerMatchDemoPlans
  };
};
