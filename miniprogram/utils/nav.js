/**
 * 统一页面导航：Tab 页用 switchTab，其它页 navigateTo
 */
const ROUTE_MAP = {
  conversations: '/pages/conversations/conversations',
  chat: '/pages/chat/chat',
  friends: '/pages/friends/friends',
  profile: '/pages/profile/profile',
  notify: '/pages/notify/notify',
  settings: '/pages/settings/settings',
  address: '/pages/address/address'
};

const TAB_URLS = new Set([
  '/pages/conversations/conversations',
  '/pages/notify/notify',
  '/pages/friends/friends',
  '/pages/profile/profile'
]);

function goPage(e) {
  const page = e.currentTarget.dataset.page;
  const url = ROUTE_MAP[page];
  if (!url) return;
  if (TAB_URLS.has(url)) {
    wx.switchTab({ url });
    return;
  }
  wx.navigateTo({ url });
}

module.exports = { ROUTE_MAP, goPage };
