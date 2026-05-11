const { call } = require('../../utils/cloud');

Page({
  data: {
    loading: true,
    errMsg: '',
    roomId: '',
    planId: '',
    planTitle: '',
    planSummary: '',
    roomTitle: '',
    isOwner: false,
    replyDraft: '',
    draftLoading: false,
    willingLoading: false
  },

  onLoad(q) {
    const roomId = String((q && q.roomId) || '').trim();
    const planId = String((q && q.planId) || '').trim();
    if (!roomId) {
      this.setData({ loading: false, errMsg: '缺少群信息，请从通知进入。' });
      return;
    }
    this.setData({ roomId, planId });
    this.loadContext();
  },

  async loadContext() {
    this.setData({ loading: true, errMsg: '' });
    try {
      const res = await call('getCollabMatchTipContext', {
        roomId: this.data.roomId,
        planId: this.data.planId
      });
      if (!res.ok) {
        this.setData({
          loading: false,
          errMsg: res.errMsg || '加载失败'
        });
        return;
      }
      this.setData({
        loading: false,
        planId: res.planId || this.data.planId,
        planTitle: res.planTitle || '',
        planSummary: res.planSummary || '',
        roomTitle: res.roomTitle || '',
        isOwner: !!res.isOwner
      });
    } catch (e) {
      this.setData({
        loading: false,
        errMsg: (e && e.errMsg) || '加载失败'
      });
    }
  },

  async onSuggestDraft() {
    if (this.data.isOwner) return;
    this.setData({ draftLoading: true });
    try {
      const res = await call('suggestCollabReply', { roomId: this.data.roomId });
      if (!res.ok) {
        wx.showToast({ title: res.errMsg || '生成失败', icon: 'none' });
        return;
      }
      this.setData({ replyDraft: res.draft || '' });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '生成失败', icon: 'none' });
    } finally {
      this.setData({ draftLoading: false });
    }
  },

  onCopyDraft() {
    const t = String(this.data.replyDraft || '').trim();
    if (!t) return;
    wx.setClipboardData({
      data: t,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  async onWilling() {
    if (this.data.isOwner) return;
    this.setData({ willingLoading: true });
    try {
      const res = await call('setCollabMatchWilling', {
        roomId: this.data.roomId,
        willing: true
      });
      if (!res.ok) {
        wx.showToast({ title: res.errMsg || '提交失败', icon: 'none' });
        return;
      }
      wx.showToast({ title: '已通知发起人', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '提交失败', icon: 'none' });
    } finally {
      this.setData({ willingLoading: false });
    }
  },

  onEnterRoom() {
    const rid = String(this.data.roomId || '').trim();
    if (!rid) return;
    const title = encodeURIComponent(this.data.roomTitle || '协作群');
    wx.navigateTo({
      url: `/pages/chat/chat?openRoomId=${encodeURIComponent(rid)}&roomTitle=${title}`
    });
  }
});
