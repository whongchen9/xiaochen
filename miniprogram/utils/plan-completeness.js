/**
 * 本地「计划书完整度」估算（0–100），用于达标后自动触发陌生人匹配扫描。
 * 不调用模型，仅启发式；可按产品再调权重。
 */
const STRANGER_SCAN_MIN_COMPLETENESS = 52;

function scorePlanCompleteness(raw) {
  const s = String(raw || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!s.length) return 0;
  let score = 0;
  score += Math.min(38, Math.floor(s.length / 7));
  const lines = s.split(/\n/).map((x) => x.trim()).filter(Boolean);
  if (lines.length >= 2) score += 10;
  if (lines.length >= 4) score += 8;
  if (s.split(/\n\s*\n/).filter((x) => x.trim()).length >= 2) score += 8;
  const keys = ['要点', '目标', '时间', '地点', '预算', '分工', '交付', '需求', '背景', '摘要', '范围'];
  let kw = 0;
  for (const k of keys) {
    if (s.includes(k)) kw += 3;
  }
  score += Math.min(18, kw);
  return Math.min(100, Math.round(score));
}

function crossedStrangerScanThreshold(prevScore, nextScore) {
  return nextScore >= STRANGER_SCAN_MIN_COMPLETENESS && prevScore < STRANGER_SCAN_MIN_COMPLETENESS;
}

module.exports = {
  scorePlanCompleteness,
  STRANGER_SCAN_MIN_COMPLETENESS,
  crossedStrangerScanThreshold
};
