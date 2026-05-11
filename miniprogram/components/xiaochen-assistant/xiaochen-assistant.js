const { call } = require('../../utils/cloud');
const tokenMgr = require('../../utils/token-manager');

const MSG_KEY = 'xc_xiaochen_assistant_messages';
const PLAN_KEY = 'xc_xiaochen_assistant_plan';

function loadPlan() {
  try {
    return String(wx.getStorageSync(PLAN_KEY) || '').trim();
  } catch (e) {
    return '';
  }
}

function savePlan(t) {
  try {
    wx.setStorageSync(PLAN_KEY, t);
  } catch (e) {}
}

function loadMsgs() {
  try {
    const raw = wx.getStorageSync(MSG_KEY);
    if (!raw) return null;
    const a = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(a) ? a : null;
  } catch (e) {
    return null;
  }
}

function saveMsgs(list) {
  try {
    wx.setStorageSync(MSG_KEY, JSON.stringify(list));
  } catch (e) {}
}

function buildHistoryFromMsgs(msgs) {
  const hist = [];
  for (const m of msgs) {
    if (!m || (m.role !== 'user' && m.role !== 'ai')) continue;
    const c = String(m.content || '').trim();
    if (!c) continue;
    hist.push({ role: m.role === 'user' ? 'user' : 'assistant', content: c.slice(0, 2000) });
  }
  return hist.length > 20 ? hist.slice(-20) : hist;
}

Component({
  properties: {
    /** 为 true 时不渲染 */
    disabled: { type: Boolean, value: false }
  },
  data: {
    dialogOpen: false,
    messages: [],
    inputValue: '',
    canSend: false,
    isLoading: false,
    scrollToId: '',
    fabBottom: 260
  },
  lifetimes: {
    attached() {
      let list = loadMsgs();
      if (!list || !list.length) {
        list = [
          {
            id: Date.now(),
            role: 'ai',
            content:
              '你好，我是小陈助手。可以直接在下面提问；要记计划、开协作，请点「进入完整对话」。'
          }
        ];
        saveMsgs(list);
      }
      this.setData({ messages: list });
    }
  },
  methods: {
    noop() {},
    onFabTap() {
      if (this.properties.disabled) return;
      this.setData({ dialogOpen: true });
      this.scrollBottom();
    },
    onMaskTap() {
      this.closeDialog();
    },
    closeDialog() {
      this.setData({ dialogOpen: false });
    },
    /** 供页面 this.selectComponent('#xiaochen-assistant').openDialog('…') */
    openDialog(prefill) {
      if (this.properties.disabled) return;
      const p = prefill != null ? String(prefill).trim() : '';
      this.setData({
        dialogOpen: true,
        inputValue: p,
        canSend: !!p
      });
      this.scrollBottom();
    },
    onInput(e) {
      const v = e.detail.value != null ? String(e.detail.value) : '';
      this.setData({ inputValue: v, canSend: !!v.trim() });
    },
    scrollBottom() {
      setTimeout(() => {
        this.setData({ scrollToId: 'xc-msg-bottom' });
      }, 80);
    },
    onSend() {
      const text = (this.data.inputValue || '').trim();
      if (!text || this.data.isLoading) return;
      tokenMgr.checkVip();
      const info = tokenMgr.getInfo();
      if (!info.isVip && info.balance <= 0) {
        wx.showModal({
          title: 'AI 次数不足',
          content: '今日次数已用完，可前往「我的」获取演示额度。',
          confirmText: '去我的',
          success: (res) => {
            if (res.confirm) wx.switchTab({ url: '/pages/profile/profile' });
          }
        });
        return;
      }

      const msgs = (this.data.messages || []).slice();
      msgs.push({ id: Date.now() + Math.random(), role: 'user', content: text });
      const history = buildHistoryFromMsgs(msgs.slice(0, -1));

      this.setData({
        messages: msgs,
        inputValue: '',
        canSend: false,
        isLoading: true
      });
      saveMsgs(msgs);
      this.scrollBottom();

      const planDocPrevious = loadPlan();
      call('chat', {
        message: text,
        imageFileId: '',
        history,
        planDocPrevious
      })
        .then((data) => {
          this.setData({ isLoading: false });
          if (!data || !data.reply) {
            wx.showToast({ title: '未返回内容', icon: 'none' });
            return;
          }
          tokenMgr.consume();
          const aiMsg = {
            id: Date.now() + Math.random(),
            role: 'ai',
            content: String(data.reply).trim()
          };
          const next = (this.data.messages || []).concat([aiMsg]);
          this.setData({ messages: next });
          saveMsgs(next);
          if (data.planDoc && String(data.planDoc).trim()) {
            savePlan(String(data.planDoc).trim().slice(0, 12000));
          }
          this.scrollBottom();
        })
        .catch((e) => {
          this.setData({ isLoading: false });
          wx.showToast({
            title: (e && e.errMsg) || '请求失败',
            icon: 'none',
            duration: 2500
          });
        });
    },
    openFullChat() {
      const draft = (this.data.inputValue || '').trim();
      if (draft) {
        try {
          wx.setStorageSync('xiaochen_assistant_input', draft);
        } catch (err) {}
      }
      this.closeDialog();
      wx.navigateTo({
        url: '/pages/chat/chat?startAi=1'
      });
    }
  }
});
