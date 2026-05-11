const { call } = require('../../utils/cloud');
const tokenMgr = require('../../utils/token-manager');

const BADGE_DEFS = [
  { id: 'pioneer', name: '原始人', icon: '🦴', desc: '即DAO首批用户', bg: '#e1f5ee', color: '#0f6e56' },
  { id: 'welfare', name: '公益之星', icon: '🌟', desc: '参与过公益协作', bg: '#fff3e0', color: '#c77600' },
  { id: 'runner', name: '活跃撮合', icon: '🏃', desc: '完成计划较多', bg: '#e8edff', color: '#1a4fd0' },
  { id: 'earlybird', name: '早鸟', icon: '🐦', desc: '注册前100名', bg: '#fbeaf0', color: '#993556' },
  { id: 'speedy', name: '效率王', icon: '⚡', desc: '多次成功协作', bg: '#faede6', color: '#993c1d' },
  { id: 'social', name: '社交达人', icon: '🗣️', desc: '活跃群聊成员', bg: '#eaf3de', color: '#3b6d11' },
  { id: 'vip', name: 'VIP会员', icon: '👑', desc: '付费会员', bg: '#fff3e0', color: '#b8860b' }
];

Page({
  data: {
    userInfo: { nickname: '', avatar: '', phone: '' },
    badges: [],
    tokenInfo: { balance: 0, isVip: false, adsLeft: 0, vipExpire: '' },
    creditStats: { score: 85, fulfillRate: 95, rating: 4.8, totalPlans: 12, completedPlans: 11, breachCount: 0 },
    userTags: [],
    medalsExpanded: false,
    tagEditorVisible: false,
    tagDraft: '',
    medalPreviewEmpty: true,
    showVipSheet: false
  },

  noop() {},

  onLoad() {
    this.loadLocalUser();
    this.loadTokenInfo();
    this.loadProfileData();
  },

  onShow() {
    this.loadLocalUser();
    this.loadTokenInfo();
    this.loadProfileData();
  },

  loadTokenInfo() {
    tokenMgr.checkVip();
    this.setData({ tokenInfo: tokenMgr.getInfo() });
  },

  loadLocalUser() {
    const user = wx.getStorageSync('userInfo');
    if (user) this.setData({ userInfo: user });
  },

  async loadProfileData() {
    try {
      const res = await call('profile', {});
      const creditStats = {
        score: res.creditScore ?? 85,
        fulfillRate: res.fulfillRate ?? 95,
        rating: res.rating ?? 4.8,
        totalPlans: res.totalPlans ?? 0,
        completedPlans: res.completedPlans ?? 0,
        breachCount: res.breachCount ?? 0
      };
      const userTags = Array.isArray(res.tags) ? res.tags : [];
      this.setData({ creditStats, userTags }, () => this.computeBadges());
    } catch (e) {
      this.computeBadges();
    }
  },

  computeBadges() {
    const saved = wx.getStorageSync('userBadges') || [];
    const newlyEarned = [];
    function earnIf(id, condition) {
      if (condition && !saved.includes(id)) {
        saved.push(id);
        newlyEarned.push(id);
      }
    }
    earnIf('pioneer', true);
    earnIf('welfare', (this.data.creditStats.completedPlans || 0) >= 1);
    earnIf('runner', (this.data.creditStats.completedPlans || 0) >= 5);
    earnIf('speedy', (this.data.creditStats.completedPlans || 0) >= 3);
    earnIf('social', (this.data.creditStats.totalPlans || 0) >= 3);
    earnIf('vip', this.data.tokenInfo && this.data.tokenInfo.isVip);

    if (newlyEarned.length > 0) {
      wx.setStorageSync('userBadges', saved);
      const badge = BADGE_DEFS.find((b) => b.id === newlyEarned[0]);
      wx.showToast({ title: `🏅 获得「${badge.name}」勋章`, icon: 'none', duration: 2000 });
    }
    const badges = BADGE_DEFS.map((b) => ({
      ...b,
      earned: saved.includes(b.id),
      bg: saved.includes(b.id) ? b.bg : '#f0f0f0',
      color: saved.includes(b.id) ? b.color : '#ccc'
    }));
    const medalPreviewEmpty = !badges.some((b) => b.earned);
    this.setData({ badges, medalPreviewEmpty });
  },

  enhanceProfile() {
    wx.getUserProfile({
      desc: '用于展示头像昵称',
      success: (res) => {
        const u = res.userInfo;
        getApp()
          .syncUserProfile(u.nickName, u.avatarUrl)
          .then(() => {
            this.loadLocalUser();
            wx.showToast({ title: '已更新', icon: 'success' });
          })
          .catch(() => wx.showToast({ title: '同步失败', icon: 'none' }));
      },
      fail: () => wx.showToast({ title: '取消', icon: 'none' })
    });
  },

  async doCharity() {
    try {
      const res = await call('creditRepair', { type: 'charity' });
      if (res.gained) {
        wx.showToast({ title: `信用分 +${res.gained}`, icon: 'success' });
        await this.loadProfileData();
      }
    } catch (e) {
      const msg = (e && e.errMsg) || '';
      wx.showToast({
        title: msg === 'DAILY_CAP' ? '今日加分已达上限' : '暂不可加分',
        icon: 'none'
      });
    }
  },

  async doHelp() {
    try {
      const res = await call('creditRepair', { type: 'help' });
      if (res.gained) {
        wx.showToast({ title: `信用分 +${res.gained}`, icon: 'success' });
        await this.loadProfileData();
      }
    } catch (e) {
      const msg = (e && e.errMsg) || '';
      wx.showToast({
        title: msg === 'DAILY_CAP' ? '今日加分已达上限' : '暂不可加分',
        icon: 'none'
      });
    }
  },

  editTags() {
    const draft = (this.data.userTags || []).join('，');
    this.setData({ tagEditorVisible: true, tagDraft: draft });
  },

  closeTagEditor() {
    this.setData({ tagEditorVisible: false });
  },

  onTagDraftInput(e) {
    this.setData({ tagDraft: e.detail.value });
  },

  async saveTags() {
    const parts = String(this.data.tagDraft || '')
      .split(/[,，、\n]/g)
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = await call('saveUserTags', { tags: parts });
      const tags = Array.isArray(res.tags) ? res.tags : parts;
      this.setData({ userTags: tags, tagEditorVisible: false });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  viewAllHistory() {
    wx.navigateTo({ url: '/pages/collab-history/collab-history' });
  },

  toggleMedals() {
    this.setData({ medalsExpanded: !this.data.medalsExpanded });
  },

  watchAd() {
    const that = this;
    let videoAd;
    try {
      videoAd = wx.createRewardedVideoAd({ adUnitId: 'adunit-xxxxxxxxxxxx' });
    } catch (e) {
      that.mockAdReward();
      return;
    }
    videoAd.onLoad(() => {
      videoAd.show();
    });
    videoAd.onError(() => {
      wx.showToast({ title: '广告加载失败', icon: 'none' });
    });
    videoAd.onClose((res) => {
      if (res && res.isEnded) {
        const result = tokenMgr.earnFromAd();
        if (result.ok) {
          wx.showToast({ title: `+${result.earned} 次数`, icon: 'success' });
          that.setData({ tokenInfo: tokenMgr.getInfo() });
        } else {
          wx.showToast({ title: result.reason, icon: 'none' });
        }
      } else {
        wx.showToast({ title: '看完广告才奖励哦', icon: 'none' });
      }
    });
  },

  mockAdReward() {
    wx.showModal({
      title: '📺 模拟广告',
      content: '演示模式：点击确认模拟看完广告',
      success: (res) => {
        if (res.confirm) {
          const result = tokenMgr.earnFromAd();
          if (result.ok) {
            wx.showToast({ title: `+${result.earned} 次数（模拟）`, icon: 'success' });
            this.setData({ tokenInfo: tokenMgr.getInfo() });
          } else {
            wx.showToast({ title: result.reason, icon: 'none' });
          }
        }
      }
    });
  },

  goVip() {
    this.setData({ showVipSheet: true });
  },

  closeVipSheet() {
    this.setData({ showVipSheet: false });
  },

  onVipPlanTap(e) {
    const type = String((e.currentTarget.dataset.type || '').trim());
    if (type !== 'monthly' && type !== 'yearly') return;
    this.setData({ showVipSheet: false });
    this.mockPayAndVip(type);
  },

  mockPayAndVip(type) {
    const label = type === 'yearly' ? '年卡 ¥99' : '月卡 ¥9.9';
    wx.showModal({
      title: '💳 模拟支付',
      content: `演示模式：点击确认模拟支付 ${label}`,
      confirmText: '确认支付',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          const info = tokenMgr.activateVip(type);
          wx.showToast({ title: '🎉 开通成功！', icon: 'success' });
          this.setData({ tokenInfo: info });
          this.computeBadges();
        }
      }
    });
  },

  goToAddress() {
    wx.navigateTo({ url: '/pages/address/address' });
  },
  goToSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
  goToAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  }
});
