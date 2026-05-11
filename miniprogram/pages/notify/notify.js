const { call } = require('../../utils/cloud');

Page({
  data: {
    systemNotifications: [],
    subscribeNotifications: [],
    notifyMatchEnabled: true,
    loading: false
  },

  onLoad() {
    this.loadAll();
  },

  onShow() {
    this.loadAll();
  },

  async loadAll() {
    this.setData({ loading: true });
    try {
      await this.loadNotifications();
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadNotifications() {
    const notifyMatchEnabled = wx.getStorageSync('setting_notify_match') !== false;
    try {
      const notifyRes = await call('notifications', {});
      let notifications = notifyRes.notifications || [];
      notifications = notifications.filter((n) => {
        const c = n.category || 'general';
        if (c === 'order') return false;
        if (c === 'match' && notifyMatchEnabled === false) return false;
        return true;
      });
      notifications = notifications.map((n) => {
        const c = n.category || 'general';
        const categoryLabel = c === 'match' ? '订阅' : '系统';
        return Object.assign({}, n, {
          content: n.content != null ? n.content : n.desc,
          createTime: n.createTime != null ? n.createTime : n.time,
          categoryLabel,
          _cat: c
        });
      });
      const systemNotifications = notifications.filter((n) => n._cat !== 'match');
      const subscribeNotifications = notifications.filter((n) => n._cat === 'match');
      this.setData({
        systemNotifications,
        subscribeNotifications,
        notifyMatchEnabled
      });
    } catch (e) {
      this.setData({
        systemNotifications: [],
        subscribeNotifications: [],
        notifyMatchEnabled
      });
    }
  },

  async onNotifyTap(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const id = ds.id;
    const kind = String(ds.notifyKind || '').trim();
    const inviteId = String(ds.strangerInviteId || '').trim();
    const linkRoomId = String(ds.linkRoomId || '').trim();
    const linkPlanId = String(ds.linkPlanId || '').trim();

    if (id) {
      try {
        await call('markNotifyRead', { notifyId: id });
        await this.loadNotifications();
      } catch (err) {
        /* 忽略 */
      }
    }

    if (inviteId && kind === 'stranger_match_invite') {
      wx.navigateTo({
        url: '/pages/chat/chat?focusStrangerInviteId=' + encodeURIComponent(inviteId)
      });
      return;
    }

    if (inviteId && kind === 'stranger_match_invite_sent' && linkPlanId) {
      wx.navigateTo({
        url: '/pages/plan-board/plan-board?planId=' + encodeURIComponent(linkPlanId)
      });
      return;
    }

    if (linkRoomId) {
      wx.navigateTo({
        url:
          '/pages/chat/chat?openRoomId=' +
          encodeURIComponent(linkRoomId) +
          '&roomTitle=' +
          encodeURIComponent('协作群')
      });
    }
  }
});
