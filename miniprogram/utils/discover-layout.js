/** 发现页自定义布局（v1），与云函数 generateDiscoverLayout 约定一致 */

const STORAGE_KEY = 'xc_discover_layout_v1';

function clampStr(s, max) {
  const t = String(s == null ? '' : s).trim();
  return t.length > max ? t.slice(0, max) : t;
}

function safeChipId(id) {
  const s = String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  return s.slice(0, 24) || 'tab';
}

function safeChips(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (let i = 0; i < arr.length && out.length < 8; i++) {
    const x = arr[i];
    if (!x || typeof x !== 'object') continue;
    const id = safeChipId(x.id);
    const name = clampStr(x.name, 12) || id;
    if (!out.find((c) => c.id === id)) out.push({ id, name });
  }
  return out.length ? out : null;
}

function safeCards(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length && out.length < 24; i++) {
    const x = arr[i];
    if (!x || typeof x !== 'object') continue;
    const id = clampStr(x.id, 32) || 'c' + i;
    out.push({
      id,
      tag: clampStr(x.tag, 16),
      title: clampStr(x.title, 80) || '未命名',
      sub: clampStr(x.sub, 120),
      tapAction: sanitizeTapAction(x.tapAction)
    });
  }
  return out;
}

const SWITCH_TAB_ALLOW = {
  '/pages/chat/chat': true,
  '/pages/conversations/conversations': true,
  '/pages/notify/notify': true,
  '/pages/profile/profile': true,
  '/pages/friends/friends': true
};

const NAV_PREFIX_ALLOW = [
  '/pages/chat/chat',
  '/pages/conversations/conversations',
  '/pages/plan-board/plan-board',
  '/pages/settings/settings',
  '/pages/about/about',
  '/pages/collab-history/collab-history',
  '/pages/notify/notify',
  '/pages/profile/profile',
  '/pages/friends/friends'
];

function sanitizeTapAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || '').trim();
  if (kind === 'toast') {
    return { kind: 'toast', text: clampStr(raw.text, 200) || '已收到' };
  }
  if (kind === 'switchTab') {
    const path = String(raw.path || '').trim();
    if (SWITCH_TAB_ALLOW[path]) return { kind: 'switchTab', path };
    return null;
  }
  if (kind === 'navigate') {
    let url = String(raw.url || '').trim();
    if (!url.startsWith('/')) return null;
    const ok = NAV_PREFIX_ALLOW.some((p) => url === p || url.indexOf(p + '?') === 0);
    if (!ok) return null;
    return { kind: 'navigate', url: url.slice(0, 512) };
  }
  return null;
}

function safeTags(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length && out.length < 24; i++) {
    const t = clampStr(arr[i], 24);
    if (t) out.push(t);
  }
  return out;
}

function safePanel(panel, fallback) {
  const p = panel && typeof panel === 'object' ? panel : {};
  const fb = fallback || {};
  if (Array.isArray(p.tags) || (p.tags && typeof p.tags === 'object')) {
    const tags = safeTags(Array.isArray(p.tags) ? p.tags : []);
    const fbTags = (fb && fb.tags) || [];
    return {
      title: clampStr(p.title, 40) || fb.title || '话题',
      subtitle: clampStr(p.subtitle, 200) || fb.subtitle || '',
      tags: tags.length ? tags : fbTags
    };
  }
  const cards = safeCards(p.cards);
  const fbCards = (fb && fb.cards) || [];
  return {
    title: clampStr(p.title, 40) || fb.title || '',
    subtitle: clampStr(p.subtitle, 200) || fb.subtitle || '',
    cards: cards.length ? cards : fbCards
  };
}

function getDefaultDiscoverLayout() {
  return {
    version: 1,
    hero: '留白一点，把精彩留给真实发生：先看附近与大家在关心什么。',
    chips: [
      { id: 'nearby', name: '附近' },
      { id: 'hot', name: '热门' },
      { id: 'topics', name: '话题' }
    ],
    panels: {
      nearby: {
        title: '附近',
        subtitle: '需位置授权后精准排序；当前为演示文案',
        cards: [
          { id: 'n1', title: '社区周末义剪', sub: '约 1.2km · 缺 2 名志愿者', tag: '公益' },
          { id: 'n2', title: '同城帮取快递', sub: '约 800m · 顺路可接单', tag: '跑腿' },
          { id: 'n3', title: '小区团购接龙统计', sub: '约 2km · 今晚截止', tag: '协作' }
        ]
      },
      hot: {
        title: '热门',
        subtitle: '可按浏览、参与、完成率综合排序',
        cards: [
          { id: 'h1', title: '毕业季行李互助', sub: '本周 328 人浏览', tag: '热门' },
          { id: 'h2', title: '新手「先聊清再建群」', sub: '官方整理 · 模板计划', tag: '精选' },
          { id: 'h3', title: '邻里工具共享清单', sub: '电钻、梯子、露营…', tag: '话题' }
        ]
      },
      topics: {
        title: '话题',
        subtitle: '点标签筛选计划与动态（筹备中）',
        tags: ['#搬家', '#宠物寄养', '#技能交换', '#自习搭子', '#社区团购', '#周末徒步']
      }
    },
    footerNote: {
      title: '还能展示什么（产品想象）',
      lines: [
        '同城小活动：读书会、徒步、市集摊位拼团。',
        '公益与互助榜：本周可报名志愿、物资流转。',
        '技能交换：我会摄影 / 你需要修图，轻撮合。',
        '新手任务：第一次发计划、第一次进群引导。',
        '官方精选：合规案例、优质协作模板。',
        '时间与地图：按「今晚」「本周末」或地图聚合展示。',
        '信任信号：高履约用户/计划（脱敏）增强决策信心。'
      ]
    }
  };
}

/**
 * 校验并裁剪 AI 或本地存储的布局，缺字段时回落默认。
 * @param {unknown} incoming
 * @returns {ReturnType<typeof getDefaultDiscoverLayout>}
 */
function sanitizeDiscoverLayout(incoming) {
  const def = getDefaultDiscoverLayout();
  if (!incoming || typeof incoming !== 'object' || Number(incoming.version) !== 1) {
    return def;
  }
  const chips = safeChips(incoming.chips) || def.chips;
  const panels = {};
  const defPanels = def.panels || {};
  for (const c of chips) {
    const rawPanel = incoming.panels && incoming.panels[c.id];
    panels[c.id] = safePanel(rawPanel, defPanels[c.id] || {});
  }
  const footer = incoming.footerNote && typeof incoming.footerNote === 'object' ? incoming.footerNote : {};
  const lines = Array.isArray(footer.lines)
    ? footer.lines.map((l) => clampStr(l, 200)).filter(Boolean).slice(0, 16)
    : def.footerNote.lines;
  return {
    version: 1,
    hero: clampStr(incoming.hero, 500) || def.hero,
    chips,
    panels,
    footerNote: {
      title: clampStr(footer.title, 60) || def.footerNote.title,
      lines: lines.length ? lines : def.footerNote.lines
    }
  };
}

function loadStoredDiscoverLayout() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return sanitizeDiscoverLayout(parsed);
  } catch (e) {
    return null;
  }
}

function saveDiscoverLayout(layout) {
  const clean = sanitizeDiscoverLayout(layout);
  try {
    wx.setStorageSync(STORAGE_KEY, JSON.stringify(clean));
  } catch (e) {}
  return clean;
}

function clearStoredDiscoverLayout() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {}
}

module.exports = {
  STORAGE_KEY,
  getDefaultDiscoverLayout,
  sanitizeDiscoverLayout,
  loadStoredDiscoverLayout,
  saveDiscoverLayout,
  clearStoredDiscoverLayout
};
