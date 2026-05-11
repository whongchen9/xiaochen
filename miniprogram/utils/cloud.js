function call(action, data = {}) {
  if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.reject({
      errMsg: '当前环境不支持 wx.cloud.callFunction，请确认已开通云开发且基础库版本足够新',
      errCode: 'NO_WX_CLOUD'
    });
  }
  return wx.cloud
    .callFunction({
      name: 'service',
      data: { action, ...data }
    })
    .then((res) => {
      const result = res && res.result;
      if (!result || result.ok === false) {
        const msg = (result && result.errMsg) || '请求失败';
        return Promise.reject({
          errMsg: msg,
          errCode: result && result.errCode,
          raw: result
        });
      }
      return result;
    })
    .catch((err) => {
      const detail =
        (err && err.errMsg) ||
        (err && err.message) ||
        (typeof err === 'string' ? err : '') ||
        'callFunction 失败';
      const code = err && (err.errCode != null ? err.errCode : err.errno);
      try {
        console.error('[cloud]', action, 'errCode=', code, 'detail=', detail, err);
        if (String(detail).indexOf('system error') >= 0 || String(detail).indexOf('SystemError') >= 0) {
          console.error(
            '[cloud] system error 常见原因：① 云开发控制台未开通或当前 AppID 未关联该云环境；② 云函数 service 未在本环境「上传并安装依赖」；③ miniprogram/config/cloudEnv.js 的 envId 与控制台「环境 ID」不一致（可改为填死 envId 再试）。'
          );
        }
      } catch (e) {}
      return Promise.reject({
        errMsg: detail,
        errCode: code,
        raw: err
      });
    });
}

module.exports = {
  call
};
