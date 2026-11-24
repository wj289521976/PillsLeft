// 服用时间结构化（R07/F07）：usageTime 自由文本 → timeSlots 结构化时段。
// 纯函数、不依赖 wx，Node 可测。解析规则见 docs/01-design/data/medicine-data-model.md 第 6 节：
//   关键词 早|中|晚|睡前|睡 → morning|noon|evening|bedtime
//   剂量 整数 / 小数 / ½(0.5) / ¼(0.25) / n/m 分数（全半角括号均可、可省略）
// 任意片段无法解析（含空串、非法字符、剂量 ≤0、分母为 0）一律返回 []，
// 由调用方保留 usageTime 原文展示（降级不阻断，见 ARCHITECTURE.md 错误处理基线）。
const { deriveMedicineStatus } = require('./medicine');

const SLOT_BY_KEYWORD = { 早: 'morning', 中: 'noon', 晚: 'evening', 睡前: 'bedtime', 睡: 'bedtime' };
const SLOT_ORDER = ['morning', 'noon', 'evening', 'bedtime'];
const SLOT_LABELS = { morning: '早上', noon: '中午', evening: '晚上', bedtime: '睡前' };
const DEFAULT_SLOT_TIMES = { morning: '07:00', noon: '12:00', evening: '18:00', bedtime: '22:00' };

// 一段 = 关键词 + 可选括号 + 剂量。sticky 正则逐段消费整串，不允许遗漏字符。
const SEGMENT_RE = /(早|中|晚|睡前|睡)[（(]?(½|¼|\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)[）)]?/y;

function parseDose(raw) {
  if (raw === '½') return 0.5;
  if (raw === '¼') return 0.25;
  if (raw.includes('/')) {
    const slash = raw.indexOf('/');
    const n = Number(raw.slice(0, slash));
    const m = Number(raw.slice(slash + 1));
    if (!(n > 0) || !(m > 0)) return 0; // 分子/分母必须为正
    return n / m;
  }
  const v = Number(raw);
  return v > 0 ? v : 0;
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function parseUsageTime(text) {
  if (typeof text !== 'string') return [];
  const s = text.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  if (s === '') return [];

  const slots = {};
  let pos = 0;
  while (pos < s.length) {
    SEGMENT_RE.lastIndex = pos;
    const m = SEGMENT_RE.exec(s);
    if (!m || m.index !== pos) return []; // 有解析不了的片段 → 整体失败
    const slot = SLOT_BY_KEYWORD[m[1]];
    const dose = parseDose(m[2]);
    if (!(dose > 0)) return [];
    slots[slot] = round4(dose); // 同一时段重复出现：后值覆盖（如"早1早2"→早 2）
    pos += m[0].length;
  }

  return SLOT_ORDER.filter((k) => slots[k] !== undefined).map((k) => ({ slot: k, dose: slots[k] }));
}

// ---- 今日时刻表（R08，S2）----

// Date/时间戳 → 本地时区 'HH:MM'（与 slotTimes 同为零填充格式，可直接字符串比较）。
function hhmm(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 今日用药时刻表（纯函数）：
//   输入：medicines 事实列表 · now（Date/时间戳，缺省当前时刻）· settings（loadSettings() 结果，缺省默认时刻）
//   处理：archived 停药药排除（R08）；timeSlots 有效条目（slot 已知且 dose>0）按时段归组，
//         条目全无效或缺失的药归"未排程"（降级不阻断，由页面展示 usageTime 原文）；
//         每药 status 用 deriveMedicineStatus(m, now) 实时派生（断药品由页面红色标注）
//   输出：{ groups, unscheduled, currentSlot }
//     groups 固定 4 组（含空组，顺序 morning→bedtime）：{ slot, time, label, current, items:[{id,name,dose,status}] }
//     unscheduled：[{ id, name, usageTime, status }]
//     currentSlot = 已开始（time ≤ now）时段中**时间最晚**者：首时段之前为 null（尚无当前时段），
//     末时段持续到午夜；时刻并列时取 SLOT_ORDER 靠前者（S5 审核修复 F-01：乱序配置下按开始时间
//     判定，而非固定迭代序——否则"早13:00/中12:00"在 13:30 会错误选中中午组）
function deriveTodaySchedule(medicines, now, settings) {
  // now 显式传入 0（epoch）也按有效时间处理（审核修复 F-08：原 falsy 判断会把 0 当缺省）
  const at = (now !== undefined && now !== null)
    ? (now instanceof Date ? now : new Date(now))
    : new Date();
  const slotTimes = { ...DEFAULT_SLOT_TIMES, ...((settings && settings.slotTimes) || {}) };
  const nowTime = hhmm(at);

  const bySlot = { morning: [], noon: [], evening: [], bedtime: [] };
  const unscheduled = [];

  (Array.isArray(medicines) ? medicines : []).forEach((m) => {
    if (!m || m.archived) return; // 停药药不出现（R08）
    const status = deriveMedicineStatus(m, at).status;
    const entries = (Array.isArray(m.timeSlots) ? m.timeSlots : []).filter(
      (t) => t && SLOT_ORDER.includes(t.slot) && t.dose > 0
    );

    if (entries.length === 0) {
      unscheduled.push({ id: m.id, name: m.name, usageTime: m.usageTime || '', status });
      return;
    }
    entries.forEach((t) => bySlot[t.slot].push({ id: m.id, name: m.name, dose: t.dose, status }));
  });

  let currentSlot = null;
  let latestStarted = null;
  SLOT_ORDER.forEach((k) => {
    const t = slotTimes[k];
    if (t <= nowTime && (latestStarted === null || t > latestStarted)) {
      latestStarted = t;
      currentSlot = k;
    }
  });

  const groups = SLOT_ORDER.map((k) => ({
    slot: k,
    time: slotTimes[k],
    label: SLOT_LABELS[k],
    current: k === currentSlot,
    items: bySlot[k]
  }));

  return { groups, unscheduled, currentSlot };
}

// ---- 三问式生成（R11，S3）----

// 剂量 → usageTime 片段：整数直写、0.5/0.25 用约定符号（与 v1 数据风格一致）、
// 其余小数原样（解析器支持小数，保证 roundtrip）。
function doseSegment(dose) {
  if (Number.isInteger(dose)) return String(dose);
  if (dose === 0.5) return '½';
  if (dose === 0.25) return '（1/4）';
  return String(dose);
}

// timeSlots → usageTime 原文，与 parseUsageTime 互逆（parse(build(x)) === x）。
// 输出按时段固定顺序；无效条目（未知时段/非正剂量）忽略，无有效条目返回 ''。
function buildUsageTime(timeSlots) {
  const KW = { morning: '早', noon: '中', evening: '晚', bedtime: '睡前' };
  const list = Array.isArray(timeSlots) ? timeSlots : [];
  return SLOT_ORDER.reduce((acc, slot) => {
    const t = list.find((x) => x && x.slot === slot && x.dose > 0);
    return t ? acc + KW[slot] + doseSegment(t.dose) : acc;
  }, '');
}

// 剂量展示文案（列表/时刻表页用）：0.5→半粒、0.25→¼粒，其余数字直写。
function formatDose(dose) {
  if (dose === 0.5) return '半粒';
  if (dose === 0.25) return '¼粒';
  return `${dose} 粒`;
}

module.exports = { parseUsageTime, deriveTodaySchedule, buildUsageTime, formatDose };
