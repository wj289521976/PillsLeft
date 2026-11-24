// medicine.js 单测：库存推算对照 v1 文档第十节示例（今天=2026-04-18）：
//   阿莫西林 剩24粒/1盒/8天/预警；碳酸钙 剩56粒/0.9盒/28天/充足；降压药 剩-5粒/0盒/-5天/断药
// 另覆盖状态阈值边界与 dailyConsumptionOn（按真实调用形态传 YYYY-MM-DD 字符串，见 records.js）。
const assert = require('assert');
const { test, summary } = require('../helper');
const { formatDate } = require('../../src/utils/date');
const {
  deriveMedicineStatus,
  getStatus,
  getStatusLabel,
  dailyConsumptionOn,
  applyRestock,
  applyCalibration
} = require('../../src/utils/medicine');

const TODAY = new Date(2026, 3, 18); // 2026-04-18，本地时区

const amoxicillin = { // v1 文档示例 med_001
  id: 'med_001', name: '阿莫西林胶囊', specPerBox: 24, dailyDose: 3,
  lastRestockDate: '2026-04-10', lastRestockStock: 48
};
const calcium = { // v1 文档示例 med_002
  id: 'med_002', name: '碳酸钙D3片', specPerBox: 60, dailyDose: 2,
  lastRestockDate: '2026-04-16', lastRestockStock: 60
};
const antihypertensive = { // v1 文档示例 med_003
  id: 'med_003', name: '降压药', specPerBox: 30, dailyDose: 1,
  lastRestockDate: '2026-03-14', lastRestockStock: 30
};

test('阿莫西林：剩 24 粒 / 1 盒 / 8 天（8 > 7 → 充足；v1 参考文档示例标"预警"为早期示意稿，以 R01 冻结规则 ≤7 预警为准）', () => {
  const s = deriveMedicineStatus(amoxicillin, TODAY);
  assert.strictEqual(s.remainingPills, 24);
  assert.strictEqual(s.remainingBoxes, 1);
  assert.strictEqual(s.remainingDays, 8);
  assert.strictEqual(s.status, 'sufficient');
});

test('剩余天数恰为 7 时进入预警（R01：≤7 预警）', () => {
  // 2026-04-15 补货 30 粒、日耗 3：至 04-18 消耗 9，剩 21 粒 = 7 天 → 预警
  const s = deriveMedicineStatus({ ...amoxicillin, lastRestockDate: '2026-04-15', lastRestockStock: 30 }, TODAY);
  assert.strictEqual(s.remainingDays, 7);
  assert.strictEqual(s.status, 'warning');
});

test('碳酸钙：剩 56 粒 / 0.9 盒 / 28 天 / 充足', () => {
  const s = deriveMedicineStatus(calcium, TODAY);
  assert.strictEqual(s.remainingPills, 56);
  assert.strictEqual(s.remainingBoxes, 0.9);
  assert.strictEqual(s.remainingDays, 28);
  assert.strictEqual(s.status, 'sufficient');
});

test('降压药：剩 -5 粒 / 0 盒 / -5 天 / 断药（负库存正常展示）', () => {
  const s = deriveMedicineStatus(antihypertensive, TODAY);
  assert.strictEqual(s.remainingPills, -5);
  assert.strictEqual(s.remainingBoxes, 0);
  assert.strictEqual(s.remainingDays, -5);
  assert.strictEqual(s.status, 'out');
});

test('状态阈值边界：0→断药，7→预警，8→充足', () => {
  assert.strictEqual(getStatus(0), 'out');
  assert.strictEqual(getStatus(7), 'warning');
  assert.strictEqual(getStatus(8), 'sufficient');
});

test('getStatusLabel：预警文案与颜色', () => {
  const label = getStatusLabel('warning');
  assert.strictEqual(label.text, '预警');
  assert.strictEqual(label.color, '#FAAD14');
});

test('dailyConsumptionOn：补货当日正常消耗', () => {
  assert.strictEqual(dailyConsumptionOn(amoxicillin, '2026-04-10'), 3);
});

test('dailyConsumptionOn：补货日之前为 0', () => {
  assert.strictEqual(dailyConsumptionOn(amoxicillin, '2026-04-09'), 0);
});

test('dailyConsumptionOn：耗尽日部分消耗（5 粒存底、日耗 2）', () => {
  const m = { specPerBox: 10, dailyDose: 2, lastRestockDate: '2026-04-10', lastRestockStock: 5 };
  assert.strictEqual(dailyConsumptionOn(m, '2026-04-10'), 2); // 第 1 天足额
  assert.strictEqual(dailyConsumptionOn(m, '2026-04-11'), 2); // 第 2 天足额
  assert.strictEqual(dailyConsumptionOn(m, '2026-04-12'), 1); // 第 3 天耗尽，只剩 1 粒
  assert.strictEqual(dailyConsumptionOn(m, '2026-04-13'), 0); // 已耗尽
});

test('dailyConsumptionOn：耗尽之后恒为 0（降压药 04-18）', () => {
  assert.strictEqual(dailyConsumptionOn(antihypertensive, '2026-04-18'), 0);
});

test('applyRestock：基准=推算剩余+盒数×规格，日期=今天', () => {
  // applyRestock 内部以真实"今天"推算，故基准日取当天保证确定性：当天剩余 = 24
  const m = { ...amoxicillin, lastRestockDate: formatDate(new Date()), lastRestockStock: 24 };
  const updated = applyRestock(m, 2); // 推算剩余 24 + 2×24 = 72
  assert.strictEqual(updated.lastRestockStock, 72);
  assert.strictEqual(updated.lastRestockDate, formatDate(new Date()));
});

test('applyRestock：可传入实测剩余覆盖推算值', () => {
  const m = { ...amoxicillin, lastRestockDate: formatDate(new Date()), lastRestockStock: 24 };
  const updated = applyRestock(m, 1, 20); // 实测 20 + 1×24 = 44
  assert.strictEqual(updated.lastRestockStock, 44);
});

test('applyCalibration：基准重置为实测粒数', () => {
  const updated = applyCalibration(amoxicillin, 30);
  assert.strictEqual(updated.lastRestockStock, 30);
});

summary('medicine.test.js');
