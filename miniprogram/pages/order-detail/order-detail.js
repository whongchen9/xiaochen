const { call } = require('../../utils/cloud');

Page({
  data: {
    orderNo: '',
    order: null,
    loading: true,
    ratingScore: 0,
    acting: false
  },

  onLoad(query) {
    const orderNo = query.orderNo;
    if (!orderNo) {
      wx.showToast({ title: '缺少订单号', icon: 'none' });
      return;
    }
    this.setData({ orderNo });
    this.loadOrder();
  },

  onShow() {
    if (this.data.orderNo) this.loadOrder();
  },

  loadOrder() {
    const orderNo = this.data.orderNo;
    if (!orderNo) return;
    this.setData({ loading: true });
    call('getOrder', { orderNo })
      .then((res) => {
        this.setData({
          order: res.order,
          ratingScore: 0,
          loading: false
        });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: (e && e.errMsg) || '加载失败', icon: 'none' });
      });
  },

  async cancelOrderTap() {
    const orderNo = this.data.orderNo;
    const ok = await new Promise((resolve) => {
      wx.showModal({
        title: '取消订单',
        content: '确认取消该订单？（仅待支付/待接单可取消）',
        success: (r) => resolve(r.confirm)
      });
    });
    if (!ok) return;
    this.setData({ acting: true });
    try {
      await call('cancelOrder', { orderNo });
      wx.showToast({ title: '已取消', icon: 'success' });
      this.loadOrder();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '取消失败', icon: 'none' });
    } finally {
      this.setData({ acting: false });
    }
  },

  async markDeliveredTap() {
    const orderNo = this.data.orderNo;
    this.setData({ acting: true });
    try {
      await call('markOrderDelivered', { orderNo });
      wx.showToast({ title: '已标记送达', icon: 'success' });
      this.loadOrder();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      this.setData({ acting: false });
    }
  },

  async confirmCompleteTap() {
    const orderNo = this.data.orderNo;
    this.setData({ acting: true });
    try {
      await call('confirmOrderComplete', { orderNo });
      wx.showToast({ title: '感谢确认', icon: 'success' });
      this.loadOrder();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '操作失败', icon: 'none' });
    } finally {
      this.setData({ acting: false });
    }
  },

  pickRating(e) {
    const score = Number(e.currentTarget.dataset.score) || 0;
    this.setData({ ratingScore: score });
  },

  async submitRatingTap() {
    const orderNo = this.data.orderNo;
    const score = this.data.ratingScore;
    if (!score) {
      wx.showToast({ title: '请先点选星级', icon: 'none' });
      return;
    }
    this.setData({ acting: true });
    try {
      const res = await call('submitRating', { orderNo, score });
      wx.showToast({
        title: res.duplicate ? '已评过分' : '感谢评价',
        icon: 'success'
      });
      this.loadOrder();
    } catch (e) {
      wx.showToast({ title: (e && e.errMsg) || '提交失败', icon: 'none' });
    } finally {
      this.setData({ acting: false });
    }
  },

  goPayHelp() {
    wx.showModal({
      title: '支付说明',
      content: '请在对话页订单卡片使用「模拟支付」。真实环境可替换为 wx.requestPayment。',
      showCancel: false
    });
  }
});
