'use strict';

function pad(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * 将数据库里的时间字段格式化为可读字符串（云函数侧展示用）。
 * @param {Date|string|number|{ _seconds?: number }|null|undefined} v
 */
function fmtTime(v) {
  if (v == null || v === '') return '';
  let d = null;
  if (v instanceof Date) {
    d = v;
  } else if (typeof v === 'number' && !Number.isNaN(v)) {
    d = new Date(v);
  } else if (typeof v === 'string') {
    d = new Date(v);
  } else if (typeof v === 'object' && v._seconds != null) {
    d = new Date(Number(v._seconds) * 1000);
  } else {
    try {
      d = new Date(v);
    } catch (e) {
      return '';
    }
  }
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

module.exports = { fmtTime };
