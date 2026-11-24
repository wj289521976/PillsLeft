// date.js 单测：formatDate/parseDate/daysBetween/addDays 边界（跨月/跨年/闰年/负向）。
// 约定：日期一律本地时区，测试用 new Date(y, m, d) 构造，避免字符串 UTC 解析偏差。
const assert = require('assert');
const { test, summary } = require('../helper');
const { formatDate, parseDate, daysBetween, addDays, isToday, getTodayDate } = require('../../src/utils/date');

test('formatDate 补零：2026-01-05', () => {
  assert.strictEqual(formatDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('formatDate 接受时间戳', () => {
  assert.strictEqual(formatDate(new Date(2026, 3, 18).getTime()), '2026-04-18');
});

test('parseDate 生成本地时区日期', () => {
  const d = parseDate('2026-04-18');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 3);
  assert.strictEqual(d.getDate(), 18);
});

test('daysBetween 同日为 0', () => {
  assert.strictEqual(daysBetween('2026-04-18', '2026-04-18'), 0);
});

test('daysBetween 跨月：01-31 → 02-01 = 1', () => {
  assert.strictEqual(daysBetween('2026-01-31', '2026-02-01'), 1);
});

test('daysBetween 跨年：2025-12-31 → 2026-01-01 = 1', () => {
  assert.strictEqual(daysBetween('2025-12-31', '2026-01-01'), 1);
});

test('daysBetween v1 示例：04-10 → 04-18 = 8', () => {
  assert.strictEqual(daysBetween('2026-04-10', '2026-04-18'), 8);
});

test('daysBetween 支持负向（日期参数交换）', () => {
  assert.strictEqual(daysBetween('2026-04-18', '2026-04-10'), -8);
});

test('addDays 跨月：01-31 + 1 = 02-01', () => {
  assert.strictEqual(addDays('2026-01-31', 1), '2026-02-01');
});

test('addDays 闰年：2024-02-28 + 1 = 2024-02-29', () => {
  assert.strictEqual(addDays('2024-02-28', 1), '2024-02-29');
});

test('addDays 平年：2026-02-28 + 1 = 2026-03-01', () => {
  assert.strictEqual(addDays('2026-02-28', 1), '2026-03-01');
});

test('addDays 跨年：2026-12-31 + 1 = 2027-01-01', () => {
  assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
});

test('addDays 负向：04-18 − 3 = 04-15', () => {
  assert.strictEqual(addDays('2026-04-18', -3), '2026-04-15');
});

test('isToday 当日为真、昨日为假', () => {
  assert.strictEqual(isToday(getTodayDate()), true);
  assert.strictEqual(isToday(addDays(new Date(), -1)), false);
});

test('getTodayDate 与 formatDate(new Date()) 一致', () => {
  assert.strictEqual(getTodayDate(), formatDate(new Date()));
});

summary('date.test.js');
