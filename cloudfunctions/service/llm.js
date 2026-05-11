/**
 * 大模型接入（OpenAI 兼容 Chat Completions）
 * 在云开发控制台为本云函数配置环境变量后生效，见 README。
 */
const https = require('https');

function postJson(urlString, headers, jsonBody) {
  const body = JSON.stringify(jsonBody);
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      reject(e);
      return;
    }
    const opts = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(raw ? raw.slice(0, 800) : `HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(raw.slice(0, 500)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(55000, () => {
      req.destroy(new Error('LLM timeout'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * 默认聊天 system：偏日常助手；产品事实仅作「被问到小程序本身时」的备忘，避免每轮都像说明书。
 * 覆盖路径：未配置 LLM_SYSTEM_PROMPT，或 LLM_FORCE_DEFAULT_SYSTEM 开启。
 */
const DEFAULT_CHAT_SYSTEM_PROMPT = `你在微信小程序「即DAO」的聊天里陪用户说话。像日常用的助手就行：接话自然、长短随话题走，不必固定人设，也不必刻意简短或「客服腔」。

默认就当普通聊天：闲聊、吐槽、写作、解题、查资料、帮想点子……按常识正常答，不要每句都扯回「协作」「计划」「匹配」；更不要主动开场做产品宣讲。

只有当用户**明确在问**本小程序能干什么、某个入口在哪、流程怎么走时，再用下面事实、用自己的话简要说明即可（不要整段照抄成列表念给用户）：
- 聊天页右下角「P」打开计划书面板；记要点、建计划、和匹配相关的开关主要在那边。
- 和真人的协作群一般在匹配或邀请等流程之后，会出现在「会话」里；不是随手一点就进陌生群，以计划书和系统通知为准。
- 平台不托管资金、不为线下履约担保；价格和成交用户自己跟对方约定。
- 已下架的旧能力（如发帖、广场等入口）别提，别让用户去找不存在的功能。`;

/**
 * 聊天 system：环境变量可删可空；空白等价于未配置。
 * 若需紧急绕过控制台里删不掉的旧 LLM_SYSTEM_PROMPT，可设 LLM_FORCE_DEFAULT_SYSTEM=1。
 */
function getEffectiveChatSystemPrompt() {
  const force = process.env.LLM_FORCE_DEFAULT_SYSTEM;
  if (force === '1' || force === 'true' || force === 'yes') {
    return DEFAULT_CHAT_SYSTEM_PROMPT;
  }
  const raw = process.env.LLM_SYSTEM_PROMPT;
  if (raw != null && String(raw).trim()) {
    return String(raw).trim();
  }
  return DEFAULT_CHAT_SYSTEM_PROMPT;
}

/**
 * @param {string} userMessage
 * @param {Array<{role:string,content:string}>} history
 * @param {{ imageUrls?: string[] }} [options] 可公开访问的图片 URL（如云存储临时链接），OpenAI 兼容多模态
 * @returns {Promise<string>} 空字符串表示未配置 Key、调用失败或不支持识图
 */
async function tryLlmChat(userMessage, history, options) {
  const key = process.env.LLM_API_KEY;
  if (!key || !String(key).trim()) return '';

  const apiUrl =
    process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.LLM_MODEL || 'deepseek-chat';

  const system = getEffectiveChatSystemPrompt();

  const opts = options || {};
  const imageUrls = Array.isArray(opts.imageUrls)
    ? opts.imageUrls.map((u) => String(u || '').trim()).filter(Boolean)
    : [];

  const messages = [{ role: 'system', content: system }];
  if (Array.isArray(history)) {
    for (const h of history.slice(-24)) {
      const role = h.role === 'assistant' ? 'assistant' : h.role === 'user' ? 'user' : null;
      if (!role || !h.content) continue;
      messages.push({ role, content: String(h.content).slice(0, 2000) });
    }
  }

  const userText =
    String(userMessage || '').trim() ||
    (imageUrls.length ? '请结合图片理解和回答；若看不清请简要说明。' : '');
  if (!userText && !imageUrls.length) return '';

  if (imageUrls.length > 0) {
    const parts = [
      { type: 'text', text: userText.slice(0, 4000) },
      ...imageUrls.slice(0, 4).map((url) => ({
        type: 'image_url',
        image_url: { url: url.slice(0, 2048) }
      }))
    ];
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({ role: 'user', content: userText.slice(0, 4000) });
  }

  try {
    const data = await postJson(apiUrl, { Authorization: 'Bearer ' + key.trim() }, {
      model,
      messages,
      temperature: Number(process.env.LLM_CHAT_TEMPERATURE || process.env.LLM_TEMPERATURE) || 0.65,
      max_tokens: Number(process.env.LLM_CHAT_MAX_TOKENS || process.env.LLM_MAX_TOKENS) || 900
    });

    const text =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    return (text && String(text).trim()) || '';
  } catch (e) {
    console.error('tryLlmChat', e.message || e);
    return '';
  }
}

function extractJsonObject(text) {
  const s = String(text || '').trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} system
 * @param {string} userContent
 * @param {number} maxTokens
 */
async function llmCompletion(system, userContent, maxTokens) {
  const key = process.env.LLM_API_KEY;
  if (!key || !String(key).trim()) return '';

  const apiUrl =
    process.env.LLM_API_URL || 'https://api.deepseek.com/v1/chat/completions';
  const model = process.env.LLM_MODEL || 'deepseek-chat';

  const data = await postJson(apiUrl, { Authorization: 'Bearer ' + key.trim() }, {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: String(userContent).slice(0, 8000) }
    ],
    temperature: 0.3,
    max_tokens: maxTokens || 512
  });

  const text =
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;
  return (text && String(text).trim()) || '';
}

/**
 * 根据对话与上一轮计划书合并更新「项目计划书」Markdown（非聊天、无称呼）
 */
async function tryLlmMergePlanNotebook(previousMarkdown, conversationSnippet, latestAssistantReply) {
  const system =
    '你是「即DAO」协作产品的文档编辑。根据对话与上一份文稿，输出更新后的「项目计划书」Markdown。\n' +
    '读者可能是陌生人（例如扫码、在匹配列表里浏览）：语气正式、客观、可独立读懂；不要用聊天称呼、不用「你/我」寒暄、不写系统操作指引。\n' +
    '默认风格：短句与条列为主；去掉空话；不重复堆砌同义表述；能合并成一条的不要拆成多条。\n' +
    '内容边界：严格依据对话与上一份文稿，不编造未出现的关键事实；不写手机号/微信号/具体门牌等敏感隐私（若用户主动写了可原样保留其表述，否则用「线下沟通」等中性说法替代）。\n' +
    '版式：用二级标题组织（## 需求概述、## 时间与地点、## 交付与标准、## 费用与方式、## 待确认事项 等），无信息的章节直接省略，不要写「暂无」占位。\n' +
    '首段用一两句概括协作主题；全文控制在可读长度内，避免超长流水账。\n' +
    '只输出 Markdown 正文，不要代码围栏，不要前后解释。';
  const user =
    '【上一份计划书】\n' +
    String(previousMarkdown || '').slice(0, 8000) +
    '\n\n【对话摘录】\n' +
    String(conversationSnippet || '').slice(0, 6000) +
    '\n\n【本轮助手回复】\n' +
    String(latestAssistantReply || '').slice(0, 4000);
  const raw = await llmCompletion(system, user.slice(0, 14000), 2400);
  return String(raw || '').trim();
}

/**
 * 从对话摘录或计划书全文提取协作计划 title/summary（JSON）
 */
async function tryLlmPlanDraftFromChat(conversationSnippet) {
  const system =
    '你是协作产品的文案编辑。输入可能是「用户与助手」对话摘录，也可能是「项目计划书」全文；请提取一条协作计划的标题与摘要，供列表、分享卡片、匹配预览等对外展示。\n' +
    '只输出一个合法 JSON 对象，不要 markdown 代码块，不要其它解释。\n' +
    '字段：title（字符串，不超过40字，概括协作主题，避免口号式空话）、summary（字符串，不超过400字）。\n' +
    'summary 要求：第三人称或无主语句；不写「你可以…」；用分号或顿号串起地点、时间、标的、价格或报酬意向、交付标准等已出现信息；信息不足时写清已知项与待补充项，不杜撰。\n' +
    'title、summary 均勿含手机号、微信号；若原文仅有联系方式而无主题，title 仍给中性主题（如「协作需求待补充」）并在 summary 中说明待补充点。\n' +
    '风格：简洁、像产品列表文案，便于路人十秒内理解是否相关。';
  const raw = await llmCompletion(system, String(conversationSnippet || '').slice(0, 6000), 640);
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj.title !== 'string') return null;
  const title = String(obj.title || '').trim();
  if (title.length < 2) return null;
  return {
    title: title.slice(0, 80),
    summary: String(obj.summary || '').trim().slice(0, 500)
  };
}

/**
 * 根据自然语言生成「发现」页 layout JSON（与小程序 discover-layout v1 对齐）
 * @returns {{ layout: object|null, reply: string }}
 */
async function tryLlmDiscoverLayout(userPrompt, previousLayoutJson) {
  const system =
    '你是微信小程序「即DAO」里「发现」Tab 的界面配置生成器。根据用户自然语言，输出一个 JSON 对象（不要 markdown 代码围栏，不要其它解释文字）。\n' +
    '根对象必须含两个字段：\n' +
    '- reply：字符串，给用户看的简短说明（一两句中文）。\n' +
    '- layout：对象，version 必须为数字 1，且含：\n' +
    '  - hero：string，页顶导语。\n' +
    '  - chips：数组，每项 { id, name }，2～6 个；id 只用小写英文与下划线。\n' +
    '  - panels：对象，键名必须覆盖每个 chip.id；每个面板两种形态二选一：\n' +
    '    （1）卡片：{ title, subtitle?, cards }，cards 为 { id, title, sub?, tag?, tapAction? } 的数组；\n' +
    '    （2）话题：{ title, subtitle?, tags }，tags 为短字符串数组（可含#）。\n' +
    '  - footerNote：{ title, lines }，lines 为字符串数组（每行一条，不要加「·」前缀）。\n' +
    'tapAction 可选；仅当用户明确要可点按钮时用，只能是以下形状之一：\n' +
    '{"kind":"toast","text":"提示"}\n' +
    '{"kind":"switchTab","path":"/pages/chat/chat"} — path 只能是：/pages/chat/chat、/pages/conversations/conversations、/pages/notify/notify、/pages/profile/profile、/pages/friends/friends\n' +
    '{"kind":"navigate","url":"/pages/...} — url 必须以 /pages/ 开头且为本应用内路径。\n' +
    '若提供了「当前 layout JSON」，在其基础上修改；不要编造不存在的业务数据为「已上线」。';

  const user =
    '【用户需求】\n' +
    String(userPrompt || '').trim().slice(0, 3000) +
    (String(previousLayoutJson || '').trim()
      ? '\n\n【当前 layout JSON】\n' + String(previousLayoutJson).trim().slice(0, 8000)
      : '');
  const raw = await llmCompletion(system, user, 3200);
  const obj = extractJsonObject(raw);
  if (!obj || typeof obj !== 'object') return { layout: null, reply: '' };
  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : '';
  const layout = obj.layout;
  if (!layout || typeof layout !== 'object') return { layout: null, reply };
  return { layout, reply };
}

module.exports = {
  postJson,
  tryLlmChat,
  tryLlmMergePlanNotebook,
  tryLlmPlanDraftFromChat,
  tryLlmDiscoverLayout
};
