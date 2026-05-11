const { call } = require('../../utils/cloud');
const tokenMgr = require('../../utils/token-manager');

const aiLocal = require('../../utils/ai-local-sessions');
const {
  scorePlanCompleteness,
  STRANGER_SCAN_MIN_COMPLETENESS,
  crossedStrangerScanThreshold
} = require('../../utils/plan-completeness');
const strangerDockStore = require('../../utils/stranger-match-dock');
const discoverLayoutUtil = require('../../utils/discover-layout');

/** 冷启动进入本页（无 query）时固定主会话，与列表里「新的会话」同样出现输入区与 P */
const TAB_PRIMARY_AI_SESSION_KEY = 'xc_tab_primary_ai_session_v1';

// AI聊天页面逻辑
Page({
  data: {
    inputValue: '',
    hasAiSendable: false,
    messages: [],
    isLoading: false,
    scrollToId: 'msg-bottom',
    settingsUser: { nickname: '', avatar: '', phone: '' },
    /** 协作群：从首页「会话」、协作记录或分享链接进入后展示 */
    activeRoomId: '',
    activeRoomTitle: '',
    roomMessages: [],
    roomInput: '',
    myOpenid: '',
    /** 已选本地图片待发送（AI 对话） */
    hasPendingAiImage: false,
    /** 未点开始协作对话前：仅展示落地页，不展示 AI 对话区 */
    aiCollaborationStarted: false,
    /** 项目计划书正文（本地 + 云端合并；阅读在独立页 plan-board） */
    planDocText: '',
    /** AI 协作会话对应的云端协作群（会话即群，初始仅你与助手） */
    aiCollabRoomId: '',
    aiCollabPlanId: '',
    /** 当前协作群关联的计划 ID（群内 P → 计划书） */
    activeRoomPlanId: '',
    /** A1b：弱提示条（不含对方身份） */
    strangerWeakStrip: '',
    /** A8b：待处理邀请条（摘要级） */
    strangerInviteBar: null,
    _aiPullRefreshing: false,
    /** 本轮云函数 chat 返回的执行步骤（耗时等），仅 AI 对话区展示 */
    aiTraceSteps: [],
    /** 输入框聚焦时显示快捷话术，失焦后隐藏 */
    showAiQuickPrompts: false,
    /** 发现页布局助手：走 generateDiscoverLayout，不合并计划书 */
    layoutDiscoverMode: false,
    /** P0 自动匹配：黑头像 / 定时揭晓 / 左右滑摘要 / 延迟进群 */
    strangerDock: {
      show: false,
      surface: '',
      revealed: false,
      revealTotalSec: 60,
      revealLeftSec: 0,
      mineTitle: '',
      mineSummaryShort: '',
      mineSummaryFull: '',
      peerTitle: '',
      peerSummaryShort: '',
      peerSummaryFull: '',
      peerOpenid: '',
      peerNickname: '',
      peerAvatarUrl: '',
      peerNickChar: '',
      pendingRoomId: '',
      pendingBridgePlanId: '',
      swipeCurrent: 0
    }
  },

  onLoad(options) {
    const q = options || {};
    if (q.openRoomId) {
      this._pendingOpenRoomId = String(q.openRoomId).trim();
      if (q.roomTitle) {
        try {
          this._pendingRoomTitle = decodeURIComponent(String(q.roomTitle));
        } catch (e) {
          this._pendingRoomTitle = String(q.roomTitle);
        }
      }
    }
    if (q.roomId) {
      this._pendingJoinRoomId = String(q.roomId).trim();
    }
    if (q.strangerDockPlanId) {
      this._strangerDockPlanIdFromQuery = String(q.strangerDockPlanId).trim();
    }
    if (q.focusStrangerInviteId) {
      this._focusStrangerInviteId = String(q.focusStrangerInviteId).trim();
    }
    if (String(q.layoutTarget || '').trim() === 'discover') {
      this._layoutTarget = 'discover';
      this.setData({ layoutDiscoverMode: true });
      wx.setNavigationBarTitle({ title: '发现页 · 布局助手' });
    }
    if (q.aiSessionId) {
      const sid = String(q.aiSessionId).trim();
      if (sid) {
        this._aiSessionId = sid;
        const loaded = aiLocal.loadMessages(sid);
        if (loaded && loaded.length) {
          this.setData({ messages: loaded, aiCollaborationStarted: true });
        }
      }
    }
    if (q.aiNew === '1' || q.startAi === '1' || q.action === 'newPlan') {
      this._aiSessionId = aiLocal.generateId();
      this._pendingStartAi = true;
    }
    const isRoomEntry = !!(q.openRoomId || q.roomId);
    const isExplicitAi =
      !!(q.aiSessionId && String(q.aiSessionId).trim()) ||
      q.aiNew === '1' ||
      q.startAi === '1' ||
      q.action === 'newPlan';
    if (!isRoomEntry && !isExplicitAi && !this._aiSessionId) {
      let sid = wx.getStorageSync(TAB_PRIMARY_AI_SESSION_KEY);
      if (!sid) {
        sid = aiLocal.generateId();
        wx.setStorageSync(TAB_PRIMARY_AI_SESSION_KEY, sid);
      }
      this._aiSessionId = sid;
      const loaded = aiLocal.loadMessages(sid);
      if (loaded && loaded.length) {
        this.setData({ messages: loaded, aiCollaborationStarted: true });
      }
    }
    const myOpenid = wx.getStorageSync('openid') || '';
    this.setData({ myOpenid });
    this.refreshSettingsUser();
    if (!this.data.activeRoomId) {
      if (this._pendingStartAi) {
        this._pendingStartAi = false;
        if (!this._aiSessionId) this._aiSessionId = aiLocal.generateId();
        this.startCollaborationChat();
      } else if (this._aiSessionId && !(this.data.messages && this.data.messages.length)) {
        this.startCollaborationChat();
      }
    }
    this.tryPendingOpenRoom();
    this.tryPendingRoomJoin();
    if (this._aiSessionId && !this.data.activeRoomId) {
      const pd = aiLocal.loadPlanDoc(this._aiSessionId);
      if (pd) {
        this.setData({ planDocText: pd });
        this._prevChatPlanC = scorePlanCompleteness(String(pd).trim());
      }
      const rid0 = wx.getStorageSync('xc_ai_room_' + this._aiSessionId) || '';
      const pid0 = wx.getStorageSync('xc_ai_plan_' + this._aiSessionId) || '';
      if (pid0) {
        this.setData({ aiCollabRoomId: '', aiCollabPlanId: pid0 });
      } else if (rid0) {
        /** 历史缓存：仅 plan 时不再使用「会话即群」roomId */
        wx.removeStorageSync('xc_ai_room_' + this._aiSessionId);
      }
    }
    this.restoreStrangerDockFromStorage();
    void this.refreshPendingStrangerInvites();
  },

  /**
   * AI 对话侧：计划书完整度达标后自动尝试陌生人匹配。
   * P0 自动建群：A7b 延迟进群 + 黑头像定时揭晓（A4b）+ 左右滑摘要（A2a/A3b）。
   * @param {boolean} force 为 true 时忽略 35s 节流（如刚跨过完整度阈值）
   */
  async maybeAutoStrangerFromAi(force) {
    if (this.data.activeRoomId) return;
    const sid = this._aiSessionId;
    if (!sid) return;
    const pid = this.data.aiCollabPlanId || wx.getStorageSync('xc_ai_plan_' + sid) || '';
    if (!pid) return;
    const nb = String(aiLocal.loadPlanDoc(sid) || this.data.planDocText || '').trim();
    const c = scorePlanCompleteness(nb);
    if (c < STRANGER_SCAN_MIN_COMPLETENESS) return;
    const now = Date.now();
    if (!force && this._lastChatStrangerScanAt && now - this._lastChatStrangerScanAt < 35000) return;
    this._lastChatStrangerScanAt = now;
    this.setData({ strangerWeakStrip: '协作匹配处理中…' });
    try {
      const r = await call('runStrangerMatchScan', { planId: pid });
      this.setData({ strangerWeakStrip: '' });
      if (!r || !r.ok) return;
      if (r.matched && r.mode === 'auto' && r.roomId) {
        this.applyStrangerAutoDock(pid, r);
        wx.showToast({ title: '已匹配成功，请查看下方协作卡片', icon: 'none', duration: 2200 });
        return;
      }
      if (r.matched && r.mode === 'invite_pending') {
        this.setData({
          strangerWeakStrip: '已向对方发送协作邀请，待对方同意建群。'
        });
        setTimeout(() => {
          if (this.data.strangerWeakStrip.indexOf('已向对方') === 0) {
            this.setData({ strangerWeakStrip: '' });
          }
        }, 5000);
        return;
      }
    } catch (e) {
      this.setData({ strangerWeakStrip: '' });
      if (e && e.errCode === 'STRANGER_INVITES_DB' && e.errMsg) {
        wx.showToast({ title: e.errMsg, icon: 'none', duration: 4000 });
      }
    }
  },

  clearStrangerDockTimers() {
    if (this._strangerRevealTimer) {
      clearInterval(this._strangerRevealTimer);
      this._strangerRevealTimer = null;
    }
  },

  applyStrangerAutoDock(planId, r) {
    const total = Math.max(15, Number(r.revealSeconds) || 60);
    const deadline = Date.now() + total * 1000;
    const dock = {
      show: true,
      surface: String(r.surface || 'P0_NONE'),
      revealed: false,
      revealTotalSec: total,
      revealLeftSec: total,
      mineTitle: String(r.mineTitle || '我的计划').slice(0, 80),
      mineSummaryShort: strangerDockStore.summarizeShort(r.mineSummary, 96),
      mineSummaryFull: String(r.mineSummary || ''),
      peerTitle: String(r.peerPlanTitle || '对方计划').slice(0, 80),
      peerSummaryShort: strangerDockStore.summarizeShort(r.peerPlanSummary, 96),
      peerSummaryFull: String(r.peerPlanSummary || ''),
      peerOpenid: String(r.peerOpenid || ''),
      peerNickname: String(r.peerNickname || ''),
      peerAvatarUrl: String(r.peerAvatarUrl || ''),
      peerNickChar: (() => {
        const pn = String(r.peerNickname || '友').trim();
        return pn ? pn.charAt(0) : '?';
      })(),
      pendingRoomId: String(r.roomId || ''),
      pendingBridgePlanId: String(r.bridgePlanId || ''),
      swipeCurrent: 0
    };
    strangerDockStore.saveStrangerDockState(planId, Object.assign({ revealDeadlineMs: deadline }, dock));
    this.setData({ strangerDock: dock, strangerInviteBar: null });
    this.clearStrangerDockTimers();
    this._strangerRevealTimer = setInterval(() => this.tickStrangerReveal(planId), 1000);
  },

  tickStrangerReveal(planId) {
    const d = this.data.strangerDock;
    if (!d || !d.show) {
      this.clearStrangerDockTimers();
      return;
    }
    const left = Math.max(0, (d.revealLeftSec || 0) - 1);
    const revealed = left <= 0 ? true : !!d.revealed;
    const next = Object.assign({}, d, {
      revealLeftSec: left,
      revealed
    });
    this.setData({ strangerDock: next });
    if (revealed) {
      strangerDockStore.saveStrangerDockState(
        planId,
        Object.assign({}, next, { revealDeadlineMs: Date.now() })
      );
      this.clearStrangerDockTimers();
    }
  },

  restoreStrangerDockFromStorage() {
    if (this.data.activeRoomId) return;
    const pid = this._effectiveStrangerDockPlanId();
    if (!pid) return;
    const raw = strangerDockStore.loadStrangerDockState(pid);
    if (!raw || !raw.show || !raw.pendingRoomId) return;
    const now = Date.now();
    const deadline = Number(raw.revealDeadlineMs) || 0;
    let revealed = !!raw.revealed;
    let left = Number(raw.revealLeftSec) || 0;
    if (deadline && now < deadline) {
      left = Math.max(0, Math.ceil((deadline - now) / 1000));
      revealed = false;
    } else if (deadline) {
      revealed = true;
      left = 0;
    }
    const dock = Object.assign({}, raw, { revealed, revealLeftSec: left });
    this.setData({ strangerDock: dock });
    if (!revealed) {
      this.clearStrangerDockTimers();
      this._strangerRevealTimer = setInterval(() => this.tickStrangerReveal(pid), 1000);
    }
  },

  dismissStrangerDock() {
    const pid = this._effectiveStrangerDockPlanId();
    this.clearStrangerDockTimers();
    strangerDockStore.clearStrangerDockState(pid);
    this.clearStrangerDockPlanQuery();
    this.setData({
      strangerDock: {
        show: false,
        surface: '',
        revealed: false,
        revealTotalSec: 60,
        revealLeftSec: 0,
        mineTitle: '',
        mineSummaryShort: '',
        mineSummaryFull: '',
        peerTitle: '',
        peerSummaryShort: '',
        peerSummaryFull: '',
        peerOpenid: '',
        peerNickname: '',
        peerAvatarUrl: '',
        peerNickChar: '',
        pendingRoomId: '',
        pendingBridgePlanId: '',
        swipeCurrent: 0
      }
    });
  },

  enterStrangerPendingRoom() {
    const rid = String((this.data.strangerDock && this.data.strangerDock.pendingRoomId) || '').trim();
    if (!rid) {
      wx.showToast({ title: '暂无协作群', icon: 'none' });
      return;
    }
    this.dismissStrangerDock();
    wx.redirectTo({
      url:
        '/pages/chat/chat?openRoomId=' +
        encodeURIComponent(rid) +
        '&roomTitle=' +
        encodeURIComponent('协作群')
    });
  },

  onStrangerDockSwipe(e) {
    const cur = e.detail && e.detail.current != null ? Number(e.detail.current) : 0;
    const d = this.data.strangerDock;
    if (!d || !d.show) return;
    this.setData({ strangerDock: Object.assign({}, d, { swipeCurrent: cur }) });
  },

  openStrangerPeerProfile() {
    const d = this.data.strangerDock;
    if (!d || !d.peerOpenid) return;
    if (!d.revealed) {
      wx.showToast({ title: '头像揭晓后可查看主页', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/user-preview/user-preview?targetOpenid=' + encodeURIComponent(d.peerOpenid)
    });
  },

  async refreshPendingStrangerInvites() {
    if (this.data.activeRoomId) return;
    const oid = wx.getStorageSync('openid') || '';
    if (!oid) return;
    if (this.data.strangerDock && this.data.strangerDock.show) return;
    try {
      const r = await call('listMyPendingStrangerMatchInvites', {});
      const list = (r && r.invites) || [];
      if (!list.length) {
        if (this.data.strangerInviteBar) this.setData({ strangerInviteBar: null });
        this._focusStrangerInviteId = '';
        return;
      }
      const focus = this._focusStrangerInviteId && String(this._focusStrangerInviteId).trim();
      let it = null;
      if (focus) {
        it = list.find((x) => String((x && x.inviteId) || '') === focus) || null;
        if (!it) {
          this._focusStrangerInviteId = '';
          wx.showToast({ title: '该邀请已处理或已过期', icon: 'none' });
          it = list[0];
        } else {
          this._focusStrangerInviteId = '';
        }
      } else {
        it = list[0];
      }
      this.setData({
        strangerInviteBar: {
          inviteId: String(it.inviteId || ''),
          title: strangerDockStore.summarizeShort(it.fromPlanTitle, 40),
          summaryShort: strangerDockStore.summarizeShort(it.fromPlanSummary, 120),
          summaryFull: String(it.fromPlanSummary || '')
        }
      });
    } catch (e) {}
  },

  onStrangerInviteBarTap() {
    const bar = this.data.strangerInviteBar;
    if (!bar || !bar.inviteId) return;
    wx.showModal({
      title: '协作邀请',
      content:
        `${bar.title}\n\n${bar.summaryShort || ''}\n\n同意后将建立新协作群（可在通知中查看详情）。`,
      confirmText: '同意',
      cancelText: '稍后再说',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中…', mask: true });
        try {
          const out = await call('acceptStrangerMatchInvite', { inviteId: bar.inviteId });
          wx.hideLoading();
          if (out && out.ok && out.roomId) {
            this.setData({ strangerInviteBar: null });
            wx.redirectTo({
              url:
                '/pages/chat/chat?openRoomId=' +
                encodeURIComponent(String(out.roomId)) +
                '&roomTitle=' +
                encodeURIComponent('协作群')
            });
          } else {
            wx.showToast({ title: (out && out.errMsg) || '处理失败', icon: 'none' });
          }
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: (err && err.errMsg) || '处理失败', icon: 'none' });
        }
      }
    });
  },

  onDeclineStrangerInvite() {
    const bar = this.data.strangerInviteBar;
    if (!bar || !bar.inviteId) return;
    wx.showModal({
      title: '拒绝邀请',
      content: '拒绝后对方会收到通知，且本条邀请关闭。确定拒绝？',
      confirmText: '拒绝',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中…', mask: true });
        try {
          await call('declineStrangerMatchInvite', { inviteId: bar.inviteId });
          this.setData({ strangerInviteBar: null });
          wx.showToast({ title: '已拒绝', icon: 'none' });
          void this.refreshPendingStrangerInvites();
        } catch (err) {
          wx.showToast({ title: (err && err.errMsg) || '操作失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  async onAiPullRefresh() {
    if (this.data.activeRoomId) {
      this.setData({ _aiPullRefreshing: false });
      return;
    }
    this.setData({ _aiPullRefreshing: true });
    try {
      await this.maybeAutoStrangerFromAi(true);
      await this.refreshPendingStrangerInvites();
    } finally {
      setTimeout(() => this.setData({ _aiPullRefreshing: false }), 400);
    }
  },

  openPlanBoardFromCard(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const pid = String(ds.planid || '').trim();
    const rid = String(this.data.activeRoomId || '').trim();
    if (!pid || !rid) {
      wx.showToast({ title: '缺少计划或群信息', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url:
        '/pages/plan-board/plan-board?roomId=' +
        encodeURIComponent(rid) +
        '&planId=' +
        encodeURIComponent(pid)
    });
  },

  openPlanBoard() {
    const rid = String(this.data.activeRoomId || '').trim();
    const roomPid = String(this.data.activeRoomPlanId || '').trim();
    if (rid && roomPid) {
      wx.navigateTo({
        url:
          '/pages/plan-board/plan-board?roomId=' +
          encodeURIComponent(rid) +
          '&planId=' +
          encodeURIComponent(roomPid)
      });
      return;
    }
    const sid = this._aiSessionId;
    if (!sid) {
      wx.showToast({ title: '暂无计划书', icon: 'none' });
      return;
    }
    const pid =
      this.data.aiCollabPlanId || wx.getStorageSync('xc_ai_plan_' + sid) || '';
    if (pid) {
      wx.navigateTo({
        url: '/pages/plan-board/plan-board?planId=' + encodeURIComponent(pid)
      });
      return;
    }
    wx.navigateTo({
      url: '/pages/plan-board/plan-board?aiSessionId=' + encodeURIComponent(sid)
    });
  },

  /** 落地页：用户手动点「开始」进入对话流 */
  onLandingStart() {
    if (this.data.activeRoomId) return;
    this.startCollaborationChat();
  },

  /** 进入 AI 协作对话；云端仅幂等创建与会话绑定的计划（不写「会话即群」）。协作群由陌生人匹配（A1–A8）等流程创建。 */
  startCollaborationChat() {
    if (this.data.activeRoomId) return;
    if (this.data.aiCollaborationStarted) return;
    if (!this._aiSessionId) this._aiSessionId = aiLocal.generateId();
    this.setData({ aiCollaborationStarted: true });
    setTimeout(() => this.ensureAiCollabBackend(), 400);
  },

  scheduleEnsureAiCollabDebounced() {
    if (this.data.activeRoomId || !this.data.aiCollaborationStarted || !this._aiSessionId) return;
    clearTimeout(this._ensureAiDebounced);
    this._ensureAiDebounced = setTimeout(() => this.ensureAiCollabBackend(), 1200);
  },

  async ensureAiCollabBackend() {
    if (this.data.activeRoomId || !this._aiSessionId || !this.data.aiCollaborationStarted) return;
    if (this._ensureAiCollabBusy) return;
    this._ensureAiCollabBusy = true;
    try {
      const sid = this._aiSessionId;
      const notebook = aiLocal.loadPlanDoc(sid) || '';
      const msgs = aiLocal.loadMessages(sid) || [];
      const history = msgs
        .filter((m) => !m.type || m.type !== 'draft')
        .filter((m) => m.role === 'user' || m.role === 'ai')
        .map((m) => {
          let c = String(m.content || '').trim();
          if (m.imageFileId) {
            if (!c) c = '[图片]';
            else c = `[图片] ${c}`;
          }
          return {
            role: m.role === 'user' ? 'user' : 'assistant',
            content: c.slice(0, 2000)
          };
        })
        .filter((h) => h.content);
      const res = await call('ensureAiCollabRoom', {
        aiSessionId: sid,
        notebook,
        history: history.slice(-40)
      });
      if (res.ok && res.planId) {
        wx.setStorageSync('xc_ai_plan_' + sid, res.planId);
        wx.removeStorageSync('xc_ai_room_' + sid);
        this.setData({
          aiCollabRoomId: '',
          aiCollabPlanId: res.planId
        });
        const nb = String(aiLocal.loadPlanDoc(sid) || '').trim();
        const c = scorePlanCompleteness(nb);
        const prev = this._prevChatPlanC != null ? this._prevChatPlanC : -1;
        const crossed = crossedStrangerScanThreshold(prev, c);
        this._prevChatPlanC = c;
        void this.maybeAutoStrangerFromAi(crossed);
      }
    } catch (e) {
      /* 未登录/弱网：不影响本地对话 */
    } finally {
      this._ensureAiCollabBusy = false;
    }
  },

  onShareAppMessage() {
    let rid = this.data.activeRoomId;
    const sid = this._aiSessionId;
    const pid =
      this.data.aiCollabPlanId ||
      (sid ? wx.getStorageSync('xc_ai_plan_' + sid) : '') ||
      '';
    const title =
      this.data.activeRoomTitle ||
      (this.data.aiCollaborationStarted ? '协作对话' : '协作群');
    if (rid) {
      return {
        title: `邀请你加入协作：${title}`,
        path: `/pages/chat/chat?roomId=${rid}`
      };
    }
    if (pid) {
      return {
        title: `邀请查看协作计划：${title}`,
        path: `/pages/plan-board/plan-board?planId=${encodeURIComponent(pid)}`
      };
    }
    return {
      title: '即DAO · 协作',
      path: '/pages/chat/chat'
    };
  },

  onShow() {
    this.refreshSettingsUser();
    const oid = wx.getStorageSync('openid') || '';
    if (oid !== this.data.myOpenid) this.setData({ myOpenid: oid });
    this.tryPendingOpenRoom();
    this.tryPendingRoomJoin();
    if (this.data.activeRoomId) this.loadRoomMessages();
    else if (this.data.aiCollaborationStarted && this._aiSessionId) {
      this.ensureAiCollabBackend();
    }
    if (!this.data.activeRoomId) {
      this.restoreStrangerDockFromStorage();
      void this.refreshPendingStrangerInvites();
    }
  },

  async tryPendingOpenRoom() {
    const rid = this._pendingOpenRoomId;
    if (!rid || this._pendingOpenBusy) return;
    const oid = wx.getStorageSync('openid') || '';
    if (!oid) return;
    this._pendingOpenBusy = true;
    this._pendingOpenRoomId = '';
    wx.showLoading({ title: '加载群聊…', mask: true });
    try {
      const t = this._pendingRoomTitle || '协作群';
      this._pendingRoomTitle = '';
      this.setData({
        activeRoomId: rid,
        activeRoomTitle: t,
        activeRoomPlanId: '',
        roomMessages: [],
        roomInput: ''
      });
      await this.loadRoomMessages();
    } catch (err) {
      this._pendingOpenRoomId = rid;
      wx.showToast({ title: (err && err.errMsg) || '打开失败', icon: 'none' });
    } finally {
      this._pendingOpenBusy = false;
      wx.hideLoading();
    }
  },

  async tryPendingRoomJoin() {
    const rid = this._pendingJoinRoomId;
    if (!rid || this._pendingJoinBusy) return;
    const oid = wx.getStorageSync('openid') || '';
    if (!oid) return;

    this._pendingJoinBusy = true;
    this._pendingJoinRoomId = '';

    wx.showLoading({ title: '加入协作群…', mask: true });
    try {
      const res = await call('joinChatRoom', { roomId: rid });
      if (!res.alreadyMember) {
        wx.showToast({ title: '已加入协作群', icon: 'success' });
      }
      const t = String((res && res.roomTitle) || '').trim() || '协作群';
      this.setData({
        activeRoomId: rid,
        activeRoomTitle: t,
        activeRoomPlanId: '',
        roomMessages: [],
        roomInput: ''
      });
      await this.loadRoomMessages();
    } catch (err) {
      this._pendingJoinRoomId = rid;
      wx.showToast({ title: (err && err.errMsg) || '加入失败', icon: 'none' });
    } finally {
      this._pendingJoinBusy = false;
      wx.hideLoading();
    }
  },

  /** 匹配坞状态键：URL 带入的 planId 优先于 AI 会话绑定的 plan */
  _effectiveStrangerDockPlanId() {
    const q = this._strangerDockPlanIdFromQuery;
    if (q) return String(q).trim();
    const sid = this._aiSessionId;
    if (!sid) return '';
    return String(this.data.aiCollabPlanId || wx.getStorageSync('xc_ai_plan_' + sid) || '').trim();
  },

  clearStrangerDockPlanQuery() {
    this._strangerDockPlanIdFromQuery = '';
  },

  backToRoomList() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }
    this.setData({
      activeRoomId: '',
      activeRoomTitle: '',
      activeRoomPlanId: '',
      roomMessages: [],
      roomInput: ''
    });
    wx.switchTab({ url: '/pages/conversations/conversations' });
  },

  /** @param {Array|undefined} snapshot 传入时使用快照；勿依赖 setData 后立即读 this.data（异步未刷新） */
  persistAiSession(snapshot) {
    if (this.data.activeRoomId) return;
    if (!this.data.aiCollaborationStarted) return;
    if (!this._aiSessionId) return;
    const msgs = snapshot !== undefined ? snapshot : this.data.messages;
    aiLocal.saveSession(this._aiSessionId, msgs);
  },

  onHide() {
    this.clearQuickPromptHideTimer();
    this.setData({ showAiQuickPrompts: false });
    setTimeout(() => this.persistAiSession(), 0);
    this.markRoomLastSeenIfAny();
  },

  onUnload() {
    this.clearQuickPromptHideTimer();
    this.clearStrangerDockTimers();
    this.markRoomLastSeenIfAny();
  },

  /** 离开群聊页时写入本地「已看到」时间，供会话列表推断新消息圆点（单机有效） */
  markRoomLastSeenIfAny() {
    const rid = String(this.data.activeRoomId || '').trim();
    if (!rid) return;
    try {
      wx.setStorageSync('xc_room_last_seen_' + rid, Date.now());
    } catch (e) {}
  },

  async loadRoomMessages() {
    const rid = this.data.activeRoomId;
    if (!rid) return;
    wx.showLoading({ title: '加载中…', mask: false });
    try {
      const res = await call('getRoomMessages', { roomId: rid });
      const oid = this.data.myOpenid || wx.getStorageSync('openid') || '';
      const list = (res.messages || []).map((m) => {
          const mt = m.msgType || 'text';
          return {
            ...m,
            msgType: mt,
            imageFileId: m.imageFileId || '',
            imageTempUrl: m.imageTempUrl || '',
            isAssistant: !!m.isAssistant,
            isMine: !!(m.senderOpenid && m.senderOpenid === oid && !m.isAssistant)
          };
        });
      const pid = String((res && res.planId) || '').trim();
      this.setData({
        roomMessages: list,
        activeRoomTitle: res.title || this.data.activeRoomTitle,
        activeRoomPlanId: pid
      });
      this.scrollToBottom();
    } catch (err) {
      wx.showToast({ title: (err && err.errMsg) || '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onRoomInput(e) {
    this.setData({ roomInput: e.detail.value });
  },

  async sendRoomChat() {
    const rid = this.data.activeRoomId;
    const content = (this.data.roomInput || '').trim();
    if (!rid || !content) return;
    try {
      await call('sendRoomMessage', { roomId: rid, content });
      this.setData({ roomInput: '' });
      await this.loadRoomMessages();
    } catch (err) {
      wx.showToast({ title: (err && err.errMsg) || '发送失败', icon: 'none' });
    }
  },

  chooseRoomImage() {
    const rid = this.data.activeRoomId;
    if (!rid) return;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempPath = res.tempFilePaths[0];
        wx.showLoading({ title: '上传中…', mask: true });
        try {
          const extMatch = /\.(\w+)$/.exec(tempPath);
          const ext = extMatch ? extMatch[1] : 'jpg';
          const cloudPath = `xc-room-images/${rid}/${Date.now()}.${ext}`;
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
          await call('sendRoomMessage', {
            roomId: rid,
            msgType: 'image',
            imageFileId: up.fileID
          });
          await this.loadRoomMessages();
        } catch (e) {
          wx.showToast({ title: (e && e.errMsg) || '图片发送失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  applyChatSuccess(reply, meta) {
    if (!reply) {
      this.setData({ isLoading: false, aiTraceSteps: [] });
      wx.showToast({ title: 'AI 未返回内容', icon: 'none', duration: 2500 });
      return;
    }
    tokenMgr.consume();
    this.setData({
      isLoading: false,
      aiTraceSteps: meta && Array.isArray(meta.trace) ? meta.trace : []
    });
    this.addMessage('ai', reply);
    if (meta && typeof meta.planDoc === 'string') {
      const doc = meta.planDoc.trim();
      if (doc.length > 0) {
        this.setData({ planDocText: doc });
        if (this._aiSessionId) aiLocal.savePlanDoc(this._aiSessionId, doc);
        const sid = this._aiSessionId;
        const nb = String(aiLocal.loadPlanDoc(sid) || doc).trim();
        const c = scorePlanCompleteness(nb);
        const prev = this._prevChatPlanC != null ? this._prevChatPlanC : -1;
        const crossed = crossedStrangerScanThreshold(prev, c);
        this._prevChatPlanC = c;
        void this.maybeAutoStrangerFromAi(crossed);
      }
    }

    this._lastAiUserInput = '';
    this._lastAiUserHadImage = false;
    if (!(meta && meta.skipPlan)) {
      this.scheduleEnsureAiCollabDebounced();
    }
  },

  refreshSettingsUser() {
    const user = wx.getStorageSync('userInfo');
    if (user) {
      this.setData({ settingsUser: user });
    }
  },

  takePhoto() {
    const that = this;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success(res) {
        const tempPath = res.tempFilePaths[0];
        wx.setStorageSync('chat_temp_image', tempPath);
        that.setData({ hasPendingAiImage: true, hasAiSendable: true });
        wx.showToast({ title: '已选图片，可补充说明后发送', icon: 'none' });
      }
    });
  },

  onInput(e) {
    const v = e.detail.value != null ? String(e.detail.value) : '';
    const hasText = !!v.trim();
    this.setData({
      inputValue: v,
      hasAiSendable: hasText || !!this.data.hasPendingAiImage
    });
  },

  onQuickPrompt(e) {
    if (!this.data.aiCollaborationStarted || this.data.activeRoomId) return;
    if (this.data.isLoading) {
      wx.showToast({ title: '请稍候…', icon: 'none' });
      return;
    }
    const t = String((e.currentTarget.dataset || {}).text || '').trim();
    if (!t) return;
    this.clearQuickPromptHideTimer();
    this.setData({ showAiQuickPrompts: false });
    this.sendMessage(t);
  },

  clearQuickPromptHideTimer() {
    if (this._hideQuickPromptsTimer) {
      clearTimeout(this._hideQuickPromptsTimer);
      this._hideQuickPromptsTimer = null;
    }
  },

  onAiInputFocus() {
    if (!this.data.aiCollaborationStarted || this.data.activeRoomId) return;
    this.clearQuickPromptHideTimer();
    this.setData({ showAiQuickPrompts: true });
  },

  onAiInputBlur() {
    this.clearQuickPromptHideTimer();
    this._hideQuickPromptsTimer = setTimeout(() => {
      this._hideQuickPromptsTimer = null;
      this.setData({ showAiQuickPrompts: false });
    }, 260);
  },

  sendMessage(eOrText) {
    const override =
      typeof eOrText === 'string' ? String(eOrText).trim() : '';
    const value = override || (this.data.inputValue || '').trim();
    const tempImage = wx.getStorageSync('chat_temp_image') || '';
    if (!value && !tempImage) return;

    const textForModel = value.replace(/\[图片\]/g, '').trim();
    this._lastAiUserInput = textForModel;

    const displayText = value || (tempImage ? '[图片]' : '');
    this.clearQuickPromptHideTimer();
    this.setData({ showAiQuickPrompts: false, aiTraceSteps: [] });
    this.addMessage('user', displayText, tempImage);
    this.setData({ inputValue: '', hasPendingAiImage: false, hasAiSendable: false });

    this.setData({ isLoading: true });
    this.handleAIResponse(textForModel, tempImage);
  },

  buildChatHistoryForCloud() {
    const msgs = this.data.messages || [];
    if (msgs.length < 2) return [];
    const prior = msgs.slice(0, -1);
    const history = [];
    for (const m of prior) {
      if (m.type === 'draft') continue;
      if (m.role === 'user') {
        let c = String(m.content || '').trim();
        if (m.imageFileId) {
          if (!c) c = '[图片]';
          else c = `[图片] ${c}`;
        }
        if (!c) continue;
        history.push({ role: 'user', content: c.slice(0, 2000) });
      } else if (m.role === 'ai') {
        history.push({ role: 'assistant', content: String(m.content || '').slice(0, 2000) });
      }
    }
    const max = 24;
    return history.length > max ? history.slice(-max) : history;
  },

  async handleAIResponse(input, localImagePath) {
    tokenMgr.checkVip();
    const info = tokenMgr.getInfo();
    if (!info.isVip && info.balance <= 0) {
      this._lastAiUserInput = '';
      this._lastAiUserHadImage = false;
      this.setData({ isLoading: false });
      wx.showModal({
        title: '⛽ AI 次数不足',
        content:
          '今日免费次数已用完。\n「我的」页：看广告 / VIP 均为演示逻辑（本地模拟），不产生真实扣款；正式版需接入激励广告与微信支付。',
        confirmText: '去获取',
        success: (res) => {
          if (res.confirm) wx.reLaunch({ url: '/pages/profile/profile' });
        }
      });
      return;
    }

    if (this._layoutTarget === 'discover' && localImagePath) {
      this._lastAiUserInput = '';
      this._lastAiUserHadImage = false;
      this.setData({ isLoading: false });
      wx.showToast({ title: '布局助手请用文字描述，暂不支持发图', icon: 'none' });
      return;
    }

    let imageFileId = '';
    if (localImagePath) {
      wx.showLoading({ title: '上传图片…', mask: true });
      try {
        const extMatch = /\.(\w+)$/.exec(localImagePath);
        const ext = extMatch ? extMatch[1] : 'jpg';
        const up = await wx.cloud.uploadFile({
          cloudPath: `xc-ai-chat/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
          filePath: localImagePath
        });
        imageFileId = up.fileID;
        wx.removeStorageSync('chat_temp_image');
        this._lastAiUserHadImage = true;
        const msgs = (this.data.messages || []).slice();
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'user') {
          last.imageFileId = imageFileId;
          this.setData({ messages: msgs });
          this.persistAiSession(msgs);
        }
      } catch (uploadErr) {
        this._lastAiUserInput = '';
        this._lastAiUserHadImage = false;
        this.setData({ isLoading: false });
        wx.showToast({ title: '图片上传失败', icon: 'none' });
        wx.hideLoading();
        return;
      } finally {
        wx.hideLoading();
      }
    } else {
      this._lastAiUserHadImage = false;
    }

    try {
      if (this._layoutTarget === 'discover') {
        const prevRaw = wx.getStorageSync(discoverLayoutUtil.STORAGE_KEY);
        const data = await call('generateDiscoverLayout', {
          message: (input || '').trim(),
          previousLayout: typeof prevRaw === 'string' ? prevRaw : ''
        });
        discoverLayoutUtil.saveDiscoverLayout(data.layout);
        this.applyChatSuccess(
          data.reply || '已更新发现页布局，返回「发现」即可查看。',
          { trace: data.trace, skipPlan: true }
        );
        return;
      }
      const data = await call('chat', {
        message: (input || '').trim(),
        imageFileId,
        history: this.buildChatHistoryForCloud(),
        planDocPrevious: this.data.planDocText || ''
      });
      if (data && data.reply) {
        this.applyChatSuccess(data.reply, data);
        return;
      }
      this._lastAiUserInput = '';
      this._lastAiUserHadImage = false;
      this.setData({ isLoading: false, aiTraceSteps: Array.isArray(data.trace) ? data.trace : [] });
      wx.showToast({ title: 'AI 未返回内容', icon: 'none', duration: 2500 });
    } catch (e) {
      this._lastAiUserInput = '';
      this._lastAiUserHadImage = false;
      const rawTrace = e && e.raw && Array.isArray(e.raw.trace) ? e.raw.trace : [];
      this.setData({ isLoading: false, aiTraceSteps: rawTrace });
      const msg = (e && e.errMsg) || 'AI 暂不可用';
      const hint =
        msg === 'NO_AI_REPLY'
          ? '请配置云函数 LLM_API_KEY 后重试'
          : msg === 'LAYOUT_PARSE_FAIL'
            ? (e.raw && e.raw.hint) || '模型输出无法解析，请换种说法再试'
            : msg === 'empty_prompt'
              ? (e.raw && e.raw.hint) || '请先输入描述'
              : msg;
      wx.showToast({ title: hint, icon: 'none', duration: 2800 });
    }
  },

  addMessage(role, content, imageFileId = '') {
    const msgs = (this.data.messages || []).slice();
    msgs.push({
      id: Date.now() + Math.random(),
      role: role,
      content: content || '',
      imageFileId: imageFileId || ''
    });
    this.setData({ messages: msgs });
    this.persistAiSession(msgs);
    this.scheduleEnsureAiCollabDebounced();
    this.scrollToBottom();
  },

  scrollToBottom() {
    setTimeout(() => {
      this.setData({ scrollToId: 'msg-bottom' });
    }, 100);
  }
});
