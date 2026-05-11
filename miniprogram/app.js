const { call } = require('./utils/cloud');
const cloudEnv = require('./config/cloudEnv');

App({
  globalData: {
    didAutoOpenChatOnce: false
  },

  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({
        traceUser: true,
        env: cloudEnv.envId ? cloudEnv.envId : wx.cloud.DYNAMIC_CURRENT_ENV
      });
      call('login', {})
        .then((res) => {
          if (!res || !res.user) return;
          try {
            wx.setStorageSync('userInfo', {
              nickname: res.user.nickname || '',
              avatar: res.user.avatarUrl || '',
              phone: res.user.phone || ''
            });
          } catch (e) {}
          if (res.openid) {
            try {
              wx.setStorageSync('openid', res.openid);
            } catch (e2) {}
          }
        })
        .catch(() => {});
    }
  },

  /** 个人页 getUserProfile 后同步头像昵称 */
  syncUserProfile(nickname, avatarUrl) {
    if (!wx.cloud) {
      return Promise.reject({ errMsg: '未开通云开发', errCode: 'NO_WX_CLOUD' });
    }
    return call('login', {
      nickname: nickname || '',
      avatarUrl: avatarUrl || ''
    }).then((res) => {
      if (res && res.user) {
        try {
          wx.setStorageSync('userInfo', {
            nickname: res.user.nickname || '',
            avatar: res.user.avatarUrl || '',
            phone: res.user.phone || ''
          });
        } catch (e) {}
      }
      return res;
    });
  }
});
