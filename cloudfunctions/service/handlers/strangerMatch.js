/**
 * 陌生人计划匹配：扫描池、自动建群（S1 新群）或邀请后同意建群。
 * 依赖集合 xc_stranger_match_invites（需在云控制台创建）。
 * 扫描池条数上限：环境变量 STRANGER_MATCH_POOL_LIMIT（40–200，默认 120）。
 */
'use strict';

const { roughFitScore, clamp, sortedPairKey } = require('../lib/utils');
const { match: matchConfig } = require('../config');

module.exports = function createStrangerMatchHandlers(deps) {
  const { db, _, XC, fmtTime } = deps;

  function clampRevealSeconds(raw) {
    const def = matchConfig.revealSeconds;
    const n = Number(raw);
    return clamp(n, 15, 600, def);
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

  function planHay(p) {
    return `${String(p.title || '').trim()}\n${String(p.summary || '').trim()}`;
  }

  function minAutoScore() {
    return matchConfig.minAutoScore;
  }

  function minInviteScore() {
    return matchConfig.minInviteScore;
  }

  /** 扫描池单次拉取上限；可用云函数环境变量 STRANGER_MATCH_POOL_LIMIT 覆盖（40–200，默认 120） */
  function strangerPoolQueryLimit() {
    return matchConfig.poolLimit;
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
        errMsg: '匹配邀请功能尚未开启（需在云控制台创建集合 xc_stranger_match_invites）',
        errCode: 'COLLECTION_NOT_EXIST'
      };
    }
    return null;
  }

  /** 保存匹配邀请记录 */
  async function saveStrangerMatchInvite(inviterOpenid, inviteeOpenid, planId, planTitle, surface) {
    try {
      await db.collection(XC.STRANGER_MATCH_INVITES).add({
        data: {
          inviterOpenid,
          inviteeOpenid,
          planId,
          planTitle,
          surface,
          status: 'pending',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
      return { ok: true };
    } catch (e) {
      const payload = inviteDbErrorPayload(e);
      if (payload) return payload;
      console.error('saveStrangerMatchInvite', e);
      return { ok: false, errMsg: '保存失败' };
    }
  }

  /** 撤回匹配邀请 */
  async function cancelStrangerMatchInvite(inviterOpenid, inviteeOpenid, planId) {
    try {
      const r = await db
        .collection(XC.STRANGER_MATCH_INVITES)
        .where({
          inviterOpenid,
          inviteeOpenid,
          planId,
          status: 'pending'
        })
        .get();
      if (!r.data || !r.data.length) {
        return { ok: false, errMsg: '未找到待处理的邀请' };
      }
      await db
        .collection(XC.STRANGER_MATCH_INVITES)
        .doc(r.data[0]._id)
        .update({
          data: {
            status: 'cancelled',
            updatedAt: db.serverDate()
          }
        });
      return { ok: true };
    } catch (e) {
      console.error('cancelStrangerMatchInvite', e);
      return { ok: false, errMsg: '撤回失败' };
    }
  }

  /** 接受匹配邀请 */
  async function acceptStrangerMatchInvite(inviteeOpenid, inviteId) {
    try {
      const r = await db.collection(XC.STRANGER_MATCH_INVITES).doc(inviteId).get();
      if (!r.data) {
        return { ok: false, errMsg: '邀请不存在' };
      }
      const invite = r.data;
      if (invite.inviteeOpenid !== inviteeOpenid) {
        return { ok: false, errMsg: '无权操作此邀请' };
      }
      if (invite.status !== 'pending') {
        return { ok: false, errMsg: '邀请已处理' };
      }

      await db
        .collection(XC.STRANGER_MATCH_INVITES)
        .doc(inviteId)
        .update({
          data: {
            status: 'accepted',
            updatedAt: db.serverDate()
          }
        });

      return { ok: true, invite };
    } catch (e) {
      console.error('acceptStrangerMatchInvite', e);
      return { ok: false, errMsg: '操作失败' };
    }
  }

  /** 获取用户收到的匹配邀请列表 */
  async function getStrangerMatchInvites(openid) {
    try {
      const r = await db
        .collection(XC.STRANGER_MATCH_INVITES)
        .where({ inviteeOpenid: openid, status: 'pending' })
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
      return { ok: true, invites: r.data || [] };
    } catch (e) {
      const payload = inviteDbErrorPayload(e);
      if (payload) return payload;
      console.error('getStrangerMatchInvites', e);
      return { ok: false, errMsg: '获取失败' };
    }
  }

  /** 获取用户发出的匹配邀请列表 */
  async function getStrangerMatchSentInvites(openid) {
    try {
      const r = await db
        .collection(XC.STRANGER_MATCH_INVITES)
        .where({ inviterOpenid: openid })
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();
      return { ok: true, invites: r.data || [] };
    } catch (e) {
      const payload = inviteDbErrorPayload(e);
      if (payload) return payload;
      console.error('getStrangerMatchSentInvites', e);
      return { ok: false, errMsg: '获取失败' };
    }
  }

  /** 扫描陌生人匹配池，返回匹配结果 */
  async function scanStrangerMatchPool(openid, planId) {
    try {
      const pr = await db.collection(XC.PLANS).doc(planId).get();
      if (!pr.data) {
        return { ok: false, errMsg: '计划不存在' };
      }
      const plan = pr.data;
      if (plan._openid !== openid) {
        return { ok: false, errMsg: '无权操作' };
      }

      const prefs = normalizePlanPrefs(plan);
      if (!prefs.matchEnabled || !prefs.strangerPoolEnabled) {
        return { ok: false, errMsg: '未开启陌生人匹配' };
      }

      const limit = strangerPoolQueryLimit();
      const r = await db
        .collection(XC.PLANS)
        .where({
          _openid: _.neq(openid),
          status: 'matching',
          matchEnabled: true,
          strangerPoolEnabled: true
        })
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      const candidates = r.data || [];
      const myHay = planHay(plan);

      const results = candidates.map((otherPlan) => {
        const otherHay = planHay(otherPlan);
        const score = roughFitScore(myHay, otherHay);
        return {
          planId: otherPlan._id,
          title: otherPlan.title,
          summary: otherPlan.summary,
          fitScore: score,
          canAutoMatch: score >= minAutoScore(),
          canInvite: score >= minInviteScore()
        };
      });

      results.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));

      return { ok: true, matches: results };
    } catch (e) {
      console.error('scanStrangerMatchPool', e);
      return { ok: false, errMsg: '扫描失败' };
    }
  }

  return {
    saveStrangerMatchInvite,
    cancelStrangerMatchInvite,
    acceptStrangerMatchInvite,
    getStrangerMatchInvites,
    getStrangerMatchSentInvites,
    scanStrangerMatchPool
  };
};