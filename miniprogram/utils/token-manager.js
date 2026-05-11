/**
 * AI 对话本地计次（客户端 Storage，非微信官方计费）
 * 1 次额度 ≈ 1 次首页 AI 对话消耗；协作群主线路发帖能力已收敛，勿再绑定「发帖扣次」叙事。
 * 每日免费额度、看广告奖励、VIP：仓库内均为演示向逻辑（当前默认每日 28 次、单次广告 +5、每日广告奖励上限 50）；正式上架请接激励视频广告与微信支付并替换模拟分支。
 */

// 配置
const CONFIG = {
  FREE_DAILY: 28,         // 每日免费 Token（演示期略放宽）
  AD_REWARD: 5,          // 每次广告奖励 Token
  AD_DAILY_MAX: 50,      // 每日广告奖励累计上限（演示期略放宽）
  VIP_MONTHLY_PRICE: 9.9, // 月卡价格 ¥
  VIP_YEARLY_PRICE: 99,   // 年卡价格 ¥
  STORAGE_KEY: 'token_data'
};

function getDefaultData() {
  const now = new Date();
  return {
    balance: CONFIG.FREE_DAILY,
    date: now.toISOString().slice(0, 10),
    adsToday: 0,
    isVip: false,
    vipExpire: '',
    totalEarned: 0,
    totalSpent: 0
  };
}

/** 读取 Token 数据 */
function load() {
  try {
    const raw = wx.getStorageSync(CONFIG.STORAGE_KEY);
    if (!raw) return getDefaultData();
    return Object.assign(getDefaultData(), raw);
  } catch (e) {
    return getDefaultData();
  }
}

/** 保存 Token 数据 */
function save(data) {
  wx.setStorageSync(CONFIG.STORAGE_KEY, data);
}

/** 检查并重置每日额度 */
function checkDaily(data) {
  const today = new Date().toISOString().slice(0, 10);
  if (data.date !== today) {
    data.date = today;
    data.adsToday = 0;
    // VIP 用户也重置（纯展示，不消耗 Token）
    data.balance = data.isVip ? 9999 : CONFIG.FREE_DAILY;
    save(data);
  }
  return data;
}

/** 获取当前 Token 信息 */
function getInfo() {
  const data = checkDaily(load());
  return {
    balance: data.balance,
    isVip: data.isVip,
    vipExpire: data.vipExpire,
    adsLeft: Math.max(0, Math.floor((CONFIG.AD_DAILY_MAX - data.adsToday) / CONFIG.AD_REWARD)),
    adEarnedToday: data.adsToday,
    adEarnedMax: CONFIG.AD_DAILY_MAX,
    adRewardPerView: CONFIG.AD_REWARD,
    freeDaily: CONFIG.FREE_DAILY,
    totalEarned: data.totalEarned,
    totalSpent: data.totalSpent
  };
}

/** 消费 1 Token（调用 AI 前检查） */
function consume() {
  const data = checkDaily(load());
  if (data.isVip) return true;   // VIP 无限制
  if (data.balance <= 0) return false; // 余额不足
  data.balance -= 1;
  data.totalSpent += 1;
  save(data);
  return true;
}

/** 看广告赚 Token（由广告回调调用） */
function earnFromAd() {
  const data = checkDaily(load());
  if (data.adsToday >= CONFIG.AD_DAILY_MAX) return { ok: false, reason: '今日广告已达上限' };
  if (data.isVip) return { ok: false, reason: 'VIP 无需看广告' };
  data.balance += CONFIG.AD_REWARD;
  data.adsToday += CONFIG.AD_REWARD;
  data.totalEarned += CONFIG.AD_REWARD;
  save(data);
  return { ok: true, earned: CONFIG.AD_REWARD, balance: data.balance };
}

/** 开通 VIP */
function activateVip(type) {
  // type: 'monthly' | 'yearly'
  const now = new Date();
  const expireDate = new Date(now);
  if (type === 'yearly') {
    expireDate.setFullYear(expireDate.getFullYear() + 1);
  } else {
    expireDate.setMonth(expireDate.getMonth() + 1);
  }
  const data = load();
  data.isVip = true;
  data.vipExpire = expireDate.toISOString().slice(0, 10);
  data.balance = 9999; // VIP 标记
  save(data);
  return getInfo();
}

/** 检查 VIP 是否过期 */
function checkVip() {
  const data = load();
  if (!data.isVip) return;
  if (data.vipExpire && data.vipExpire < new Date().toISOString().slice(0, 10)) {
    data.isVip = false;
    data.balance = CONFIG.FREE_DAILY;
    save(data);
  }
}

module.exports = {
  CONFIG,
  getInfo,
  consume,
  earnFromAd,
  activateVip,
  checkVip
};
