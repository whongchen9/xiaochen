const { call } = require('../../utils/cloud');
const aiLocal = require('../../utils/ai-local-sessions');
const {
  scorePlanCompleteness,
  STRANGER_SCAN_MIN_COMPLETENESS,
  crossedStrangerScanThreshold
} = require('../../utils/plan-completeness');
const strangerDockStore = require('../../utils/stranger-match-dock');

function nickCharOf(p) {
  return String((p && p.nickname) || '用').trim().charAt(0) || '?';
}

function decorateParticipantRows(list, roomId) {
  return (list || []).map((p) =>
    Object.assign({}, p, {
      nickChar: nickCharOf(p),
      showInvite: !!roomId
    })
  );
}

/** 云端正文常为「标题 + 摘要」拼接；版心已单独展示标题/摘要时，去掉重复前缀得到「补充正文」 */
function narrativeAfterMeta(title, summary, combined) {
  let r = String(combined || '').trim();
  const stripPrefix = (block) => {
    const b = String(block || '').trim();
    if (!b || !r) return;
    if (r === b) {
      r = '';
      return;
    }
    if (r.startsWith(b)) {
      r = r.slice(b.length).replace(/^[\s\n\r\u2028\u2029]+/, '').trim();
    }
  };
  stripPrefix(String(title || '').trim());
  stripPrefix(String(summary || '').trim());
  return r.trim();
}

/** 草稿：首条非空行已在 digestTitle 展示，其余为正文区 */
function narrativeFromDraftBody(full) {
  const parts = String(full || '')
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return '';
  return parts.slice(1).join('\n').trim();
}

function prefsFromBoardRes(res) {
  return {
    matchEnabled: res.matchEnabled !== false,
    strangerPoolEnabled: res.strangerPoolEnabled !== false,
    autoFormRoomEnabled: res.autoFormRoomEnabled !== false,
    pickBeforeInviteEnabled: res.pickBeforeInviteEnabled === true,
    strangerRevealSeconds:
      res.strangerRevealSeconds != null && Number(res.strangerRevealSeconds) > 0
        ? Number(res.strangerRevealSeconds)
        : 60
  };
}

/** 从本地计划正文生成计划书页草稿区所需字段（单次 setData，避免 digest 未写入） */
function buildDraftBoardPatch(aiSessionId) {
  const body = String(aiLocal.loadPlanDoc(aiSessionId) || '').trim();
  const lines = body.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const digestTitle = lines.length ? lines[0].slice(0, 48) : '协作草稿';
  const digestSummary =
    body.length > 120 ? body.slice(0, 240) + (body.length > 240 ? '…' : '') : body || '可在对话中补充需求，计划书会自动更新。';
  const user = wx.getStorageSync('userInfo') || {};
  const oid = wx.getStorageSync('openid') || '';
  const brief =
    digestSummary.replace(/\s+/g, ' ').trim() ||
    (body ? body.replace(/\s+/g, ' ').trim().slice(0, 120) : '（暂无摘要）');
  const participantRows = decorateParticipantRows(
    [
      {
        openid: oid || 'self',
        nickname: user.nickname || '我',
        avatarUrl: user.avatar || '',
        matchBrief: brief,
        fullPlanText: body || '（暂无正文，请回到对话补充）'
      }
    ],
    ''
  );
  const planNarrative = narrativeFromDraftBody(body);
  return { planBody: body, digestTitle, digestSummary, participantRows, planNarrative };
}

Page({
  data: {
    mode: 'draft',
    aiSessionId: '',
    roomId: '',
    planId: '',
    planBody: '',
    digestTitle: '',
    digestSummary: '',
    planNarrative: '',
    participantRows: [],
    loading: false,
    matchEnabled: true,
    strangerPoolEnabled: true,
    autoFormRoomEnabled: true,
    pickBeforeInviteEnabled: false,
    isPlanOwner: false,
    showMatchSheet: false,
    sheetMatchEnabled: true,
    sheetStrangerPool: true,
    sheetAutoForm: true,
    sheetPickBefore: false,
    sheetRevealSec: 60,
    draftCreateChecked: false,
    planCompleteness: 0,
    minStrangerCompleteness: STRANGER_SCAN_MIN_COMPLETENESS,
    strangerRevealSeconds: 60,
    pendingStrangerRoomId: '',
    pendingStrangerBridgePlanId: '',
    /** 已向他人发出陌生人协作邀请后的提示（本页） */
    strangerOutboundHint: false,
    coverImageFileId: '',
    coverImageTempUrl: ''
  },

  onLoad(options) {
    const q = options || {};
    const aiSessionId = String(q.aiSessionId || '').trim();
    const roomId = String(q.roomId || '').trim();
    const planId = String(q.planId || '').trim();
    if (roomId || planId) {
      this.setData({ roomId, planId, mode: 'active', loading: true });
      this.loadCloudBoard();
      return;
    }
    if (aiSessionId) {
      this.setData({ aiSessionId, mode: 'draft' });
      this.loadDraftBoard();
      return;
    }
    wx.showToast({ title: '缺少参数', icon: 'none' });
    setTimeout(() => wx.navigateBack(), 400);
  },

  onShow() {
    if (this.data.mode !== 'draft' || !this.data.aiSessionId) return;
    const patch = buildDraftBoardPatch(this.data.aiSessionId);
    const body = patch.planBody;
    if (body && body !== this.data.planBody) {
      this.setData({
        planBody: body,
        digestTitle: patch.digestTitle,
        digestSummary: patch.digestSummary,
        planNarrative: patch.planNarrative,
        participantRows: patch.participantRows
      });
    }
  },

  loadDraftBoard() {
    const { aiSessionId } = this.data;
    const patch = buildDraftBoardPatch(aiSessionId);
    this.setData(
      Object.assign({}, patch, {
        draftCreateChecked: false,
        isPlanOwner: true,
        roomId: '',
        planId: '',
        coverImageFileId: '',
        coverImageTempUrl: ''
      })
    );
  },

  async loadCloudBoard() {
    this.setData({ loading: true });
    try {
      const res = await call('getPlanBoard', {
        roomId: this.data.roomId,
        planId: this.data.planId
      });
      if (!res.ok) {
        wx.showToast({ title: res.errMsg || '加载失败', icon: 'none' });
        this.setData({ loading: false });
        return;
      }
      const title = res.title || '协作计划';
      const summary = String(res.summary || '').trim();
      const body = [title, summary].filter(Boolean).join('\n\n');
      const planNarrative = narrativeAfterMeta(title, summary, body);
      const rid = res.roomId || this.data.roomId;
      const owner = !!res.isPlanOwner;
      const rowsSrc = Array.isArray(res.matchRows) ? res.matchRows : [];
      const prefs = prefsFromBoardRes(res);
      const c = scorePlanCompleteness(body);
      const prevC = this._prevPlanCompletenessScore != null ? this._prevPlanCompletenessScore : -1;
      const crossed = crossedStrangerScanThreshold(prevC, c);
      this._prevPlanCompletenessScore = c;
      this.setData({
        loading: false,
        roomId: rid,
        planId: res.planId || this.data.planId,
        planBody: body,
        digestTitle: title,
        digestSummary: summary,
        planNarrative,
        participantRows: decorateParticipantRows(rowsSrc, rid),
        isPlanOwner: owner,
        matchEnabled: prefs.matchEnabled,
        strangerPoolEnabled: prefs.strangerPoolEnabled,
        autoFormRoomEnabled: prefs.autoFormRoomEnabled,
        pickBeforeInviteEnabled: prefs.pickBeforeInviteEnabled,
        strangerRevealSeconds: prefs.strangerRevealSeconds,
        planCompleteness: c,
        coverImageFileId: String(res.coverImageFileId || '').trim(),
        coverImageTempUrl: String(res.coverImageTempUrl || '').trim()
      });
      this.maybeAutoStrangerScan(crossed);
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
    }
  },

  onBriefTap(e) {
    const idx = Number((e.currentTarget.dataset || {}).index);
    if (Number.isNaN(idx)) return;
    const row = this.data.participantRows[idx];
    if (!row) return;
    const content = String(row.fullPlanText || row.matchBrief || '').trim() || '暂无正文';
    wx.showModal({
      title: row.nickname || '成员',
      content,
      showCancel: false
    });
  },

  onShareAppMessage(res) {
    const ds = (res && res.target && res.target.dataset) || {};
    const rid = String(ds.roomId || '').trim();
    if (rid) {
      const t = String(ds.shareTitle || this.data.digestTitle || '协作群').trim();
      return {
        title: `邀请你加入协作：${t}`,
        path: `/pages/chat/chat?roomId=${encodeURIComponent(rid)}`
      };
    }
    const pid = String(this.data.planId || '').trim();
    if (pid) {
      const t = String(this.data.digestTitle || '协作计划').trim();
      return {
        title: `邀请查看协作计划：${t}`,
        path: `/pages/plan-board/plan-board?planId=${encodeURIComponent(pid)}`
      };
    }
    return {
      title: '即DAO · 协作',
      path: '/pages/chat/chat'
    };
  },

  async onDraftCreateSwitch(e) {
    const want = !!(e.detail && e.detail.value);
    if (!want) {
      this.setData({ draftCreateChecked: false });
      return;
    }
    this.setData({ draftCreateChecked: false });
    const notebook = String(this.data.planBody || '').trim();
    if (notebook.length < 12) {
      wx.showToast({ title: '请先在对话中补充计划要点', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '创建中…', mask: true });
    try {
      const res = await call('createPlanFromNotebook', { notebook });
      if (res.ok && res.planId) {
        wx.showToast({ title: '已创建计划', icon: 'success' });
        wx.redirectTo({
          url: '/pages/plan-board/plan-board?planId=' + encodeURIComponent(String(res.planId))
        });
      } else {
        wx.showToast({ title: (res && res.errMsg) || '创建失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: (err && err.errMsg) || '创建失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  openMatchSheet() {
    if (!this.data.isPlanOwner) return;
    this.setData({
      showMatchSheet: true,
      sheetMatchEnabled: this.data.matchEnabled,
      sheetStrangerPool: this.data.strangerPoolEnabled,
      sheetAutoForm: this.data.autoFormRoomEnabled,
      sheetPickBefore: this.data.pickBeforeInviteEnabled,
      sheetRevealSec: this.data.strangerRevealSeconds || 60
    });
  },

  closeMatchSheet() {
    this.setData({ showMatchSheet: false });
  },

  noop() {},

  onSheetMatchEnabled(e) {
    this.setData({ sheetMatchEnabled: !!(e.detail && e.detail.value) });
  },

  onSheetStrangerPool(e) {
    this.setData({ sheetStrangerPool: !!(e.detail && e.detail.value) });
  },

  onSheetAutoForm(e) {
    this.setData({ sheetAutoForm: !!(e.detail && e.detail.value) });
  },

  onSheetPickBefore(e) {
    this.setData({ sheetPickBefore: !!(e.detail && e.detail.value) });
  },

  onSheetRevealChange(e) {
    const v = e.detail && e.detail.value != null ? Number(e.detail.value) : 60;
    this.setData({ sheetRevealSec: Number.isFinite(v) ? v : 60 });
  },

  async saveMatchSheet() {
    const pid = String(this.data.planId || '').trim();
    if (!pid) {
      wx.showToast({ title: '缺少计划信息', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中…', mask: true });
    try {
      await call('setPlanMatchPreferences', {
        planId: pid,
        matchEnabled: this.data.sheetMatchEnabled,
        strangerPoolEnabled: this.data.sheetStrangerPool,
        autoFormRoomEnabled: this.data.sheetAutoForm,
        pickBeforeInviteEnabled: this.data.sheetPickBefore,
        strangerRevealSeconds: Math.round(Number(this.data.sheetRevealSec) || 60)
      });
      this.setData({ showMatchSheet: false });
      await this.loadCloudBoard();
      if (this.data.strangerPoolEnabled) this.maybeAutoStrangerScan(true);
      this.setData({ strangerOutboundHint: false });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.errMsg) || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  maybeAutoStrangerScan(force) {
    if (this.data.mode !== 'active' || !this.data.isPlanOwner || !this.data.planId) return;
    if (!this.data.strangerPoolEnabled) return;
    const c = scorePlanCompleteness(this.data.planBody);
    if (c < STRANGER_SCAN_MIN_COMPLETENESS) return;
    const now = Date.now();
    if (!force && this._lastStrangerScanAt && now - this._lastStrangerScanAt < 35000) return;
    this._lastStrangerScanAt = now;
    this.runStrangerScan(false);
  },

  async runStrangerScan(showErrors) {
    const pid = String(this.data.planId || '').trim();
    if (!pid) return;
    try {
      const r = await call('runStrangerMatchScan', { planId: pid });
      if (!r || !r.ok) {
        if (showErrors) wx.showToast({ title: (r && r.errMsg) || '扫描失败', icon: 'none' });
        return;
      }
      if (r.matched && r.mode === 'auto' && r.roomId) {
        const pid = String(this.data.planId || '').trim();
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
        if (pid) strangerDockStore.saveStrangerDockState(pid, Object.assign({ revealDeadlineMs: deadline }, dock));
        this.setData({
          pendingStrangerRoomId: String(r.roomId),
          pendingStrangerBridgePlanId: String(r.bridgePlanId || '')
        });
        wx.showToast({ title: '已匹配成功，正在打开协作会话…', icon: 'none', duration: 1800 });
        wx.navigateTo({
          url: '/pages/chat/chat?strangerDockPlanId=' + encodeURIComponent(pid)
        });
        return;
      }
      if (r.matched && r.mode === 'invite_pending') {
        this.setData({ strangerOutboundHint: true });
        wx.showToast({ title: '已向对方发送协作邀请', icon: 'none' });
        return;
      }
      if (showErrors) {
        if (r.skipped && r.reason === 'pool_off') {
          wx.showToast({ title: '请先开启陌生人协作池', icon: 'none' });
        } else if (r.skipped && r.reason === 'bridge_plan') {
          wx.showToast({ title: '当前为协作群计划，无需扫描', icon: 'none' });
        } else {
          wx.showToast({ title: '暂无合适匹配', icon: 'none' });
        }
      }
    } catch (err) {
      if (showErrors || (err && err.errCode === 'STRANGER_INVITES_DB')) {
        wx.showToast({ title: (err && err.errMsg) || '扫描失败', icon: 'none', duration: err && err.errCode === 'STRANGER_INVITES_DB' ? 4000 : 2500 });
      }
    }
  },

  openNotifyFromPlan() {
    wx.switchTab({ url: '/pages/notify/notify' });
  },

  dismissStrangerOutboundHint() {
    this.setData({ strangerOutboundHint: false });
  },

  enterPendingStrangerFromPlan() {
    const rid = String(this.data.pendingStrangerRoomId || '').trim();
    if (!rid) return;
    const pid = String(this.data.planId || '').trim();
    if (pid) strangerDockStore.clearStrangerDockState(pid);
    this.setData({ pendingStrangerRoomId: '', pendingStrangerBridgePlanId: '' });
    wx.redirectTo({
      url:
        '/pages/chat/chat?openRoomId=' +
        encodeURIComponent(rid) +
        '&roomTitle=' +
        encodeURIComponent('协作群')
    });
  },

  previewPlanCover() {
    const u = String(this.data.coverImageTempUrl || '').trim();
    if (!u) return;
    wx.previewImage({ urls: [u], current: u });
  },

  choosePlanCover() {
    if (this.data.mode !== 'active' || !this.data.isPlanOwner || !this.data.planId) return;
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const path = res.tempFilePaths && res.tempFilePaths[0];
        if (!path) return;
        wx.showLoading({ title: '上传中…', mask: true });
        try {
          const extMatch = /\.(\w+)$/.exec(path);
          const ext = extMatch ? extMatch[1] : 'jpg';
          const cloudPath = `xc-plan-covers/${this.data.planId}/${Date.now()}.${ext}`;
          const up = await wx.cloud.uploadFile({ cloudPath, filePath: path });
          await call('setPlanCoverImage', {
            planId: this.data.planId,
            coverImageFileId: up.fileID
          });
          wx.showToast({ title: '已更新配图', icon: 'success' });
          await this.loadCloudBoard();
        } catch (e) {
          wx.showToast({ title: (e && e.errMsg) || '上传失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  clearPlanCover() {
    if (this.data.mode !== 'active' || !this.data.isPlanOwner || !this.data.planId) return;
    wx.showModal({
      title: '移除计划配图',
      content: '确定移除当前配图？',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await call('setPlanCoverImage', { planId: this.data.planId, coverImageFileId: '' });
          wx.showToast({ title: '已移除', icon: 'success' });
          await this.loadCloudBoard();
        } catch (e) {
          wx.showToast({ title: (e && e.errMsg) || '失败', icon: 'none' });
        }
      }
    });
  }
});
