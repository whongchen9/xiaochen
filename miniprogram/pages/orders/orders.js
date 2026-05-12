const { call } = require('../../utils/cloud');

Page({
  data: {
    activeTab: 'all',
    orders: [],
    filteredOrders: []
  },

  onLoad() {
    this.loadOrders();
  },

  onShow() {
    this.loadOrders();
  },

  async loadOrders() {
    try {
      const res = await call('listOrders', {});
      this.setData({ orders: res.orders || [] }, () => this.filterOrders());
    } catch (e) {
      wx.showToast({ title: '加载订单失败', icon: 'none' });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    this.filterOrders();
  },

  filterOrders() {
    let list = this.data.orders;
    if (this.data.activeTab === 'ongoing') {
      list = list.filter(
        (o) =>
          o.statusKey === 'pending_pay' ||
          o.statusKey === 'accepted' ||
          o.statusKey === 'delivering'
      );
    } else if (this.data.activeTab === 'done') {
      list = list.filter((o) => o.statusKey === 'completed');
    }
    this.setData({ filteredOrders: list });
  },

  viewOrderDetail(e) {
    const order = e.currentTarget.dataset.order;
    if (!order || !order.orderNo) return;
    wx.navigateTo({
      url: `/pages/order-detail/order-detail?orderNo=${order.orderNo}`
    });
  }
});
