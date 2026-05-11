const discoverLayout = require('../../utils/discover-layout');

const DEF_LAYOUT = discoverLayout.getDefaultDiscoverLayout();
const DEF_CHIP = DEF_LAYOUT.chips[0] ? DEF_LAYOUT.chips[0].id : 'nearby';

Page({
  data: {
    layout: DEF_LAYOUT,
    activeChip: DEF_CHIP,
    currentPanel: DEF_LAYOUT.panels[DEF_CHIP] || null
  },

  onLoad() {
    this.loadDiscoverLayout();
  },

  onShow() {
    this.loadDiscoverLayout();
  },

  loadDiscoverLayout() {
    const layout = discoverLayout.loadStoredDiscoverLayout() || discoverLayout.getDefaultDiscoverLayout();
    const clean = discoverLayout.sanitizeDiscoverLayout(layout);
    const chips = clean.chips || [];
    let activeChip = this.data.activeChip;
    if (!chips.find((c) => c.id === activeChip)) {
      activeChip = chips[0] ? chips[0].id : 'nearby';
    }
    const currentPanel = clean.panels && clean.panels[activeChip] ? clean.panels[activeChip] : null;
    this.setData({ layout: clean, activeChip, currentPanel });
  },

  onChipTap(e) {
    const id = String((e.currentTarget.dataset.id || '').trim());
    if (!id || !this.data.layout) return;
    const currentPanel = this.data.layout.panels[id] || null;
    this.setData({ activeChip: id, currentPanel });
  },

  onLayoutCardTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const cards = (this.data.currentPanel && this.data.currentPanel.cards) || [];
    const card = cards[idx];
    const act = card && card.tapAction;
    if (!act || act.kind === 'toast') {
      wx.showToast({
        title: (act && act.text) || '内容接入筹备中',
        icon: 'none'
      });
      return;
    }
    if (act.kind === 'switchTab' && act.path) {
      wx.switchTab({ url: act.path });
      return;
    }
    if (act.kind === 'navigate' && act.url) {
      wx.navigateTo({ url: act.url });
    }
  },

  onTopicTap(e) {
    const t = String((e.currentTarget.dataset.tag || '').trim());
    if (!t) return;
    wx.showToast({ title: t + ' · 筹备中', icon: 'none' });
  },

  goLayoutChat() {
    wx.navigateTo({
      url: '/pages/chat/chat?layoutTarget=discover&aiNew=1'
    });
  },

  resetDiscoverLayout() {
    wx.showModal({
      title: '恢复默认版面',
      content: '将清除本地保存的发现页布局，确定吗？',
      success: (res) => {
        if (!res.confirm) return;
        discoverLayout.clearStoredDiscoverLayout();
        this.loadDiscoverLayout();
        wx.showToast({ title: '已恢复默认', icon: 'success' });
      }
    });
  }
});
