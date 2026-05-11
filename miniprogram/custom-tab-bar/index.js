Component({
  data: {
    selected: 0
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const cur = pages.length ? pages[pages.length - 1] : null;
      const route = cur && cur.route ? String(cur.route) : '';
      let selected = 0;
      if (route.indexOf('notify/notify') !== -1) selected = 1;
      else if (route.indexOf('friends/friends') !== -1) selected = 2;
      else if (route.indexOf('profile/profile') !== -1) selected = 3;
      else if (route.indexOf('conversations/conversations') !== -1) selected = 0;
      this.setData({ selected });
    },

    onSwitchTab(e) {
      const i = Number((e.currentTarget.dataset || {}).i);
      if (Number.isNaN(i)) return;
      const urls = [
        '/pages/conversations/conversations',
        '/pages/notify/notify',
        '/pages/friends/friends',
        '/pages/profile/profile'
      ];
      const url = urls[i];
      if (!url) return;
      wx.switchTab({ url });
    },

    openCreatePlan() {
      wx.navigateTo({
        url: '/pages/chat/chat?startAi=1',
        fail: () => {
          wx.showToast({ title: '打开失败', icon: 'none' });
        }
      });
    }
  }
});
