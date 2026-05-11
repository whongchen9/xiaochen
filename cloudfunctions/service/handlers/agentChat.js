'use strict';

/**
 * Agent 通道（预留）。小程序当前主路径使用 action: chat。
 * @param {{ db: any, _: any, XC: Record<string, string>, postJson: Function }} deps
 */
module.exports = function createAgentChat(deps) {
  const { db, _, XC, postJson } = deps;
  void db;
  void _;
  void XC;
  void postJson;

  return {
    async handleAgentChat(openid, event) {
      void openid;
      void event;
      return {
        ok: false,
        errMsg: 'AGENT_CHAT_DISABLED',
        hint: 'Agent 通道暂未开放；请使用对话页的 AI（action: chat）。'
      };
    }
  };
};
