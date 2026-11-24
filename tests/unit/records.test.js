// records.js 单测（R10 验收）：用药记录派生（起止日期/至今/原因/排序）；
// 导出文本表格（表头齐全、列对齐）与 CSV（UTF-8 BOM、逗号分隔、含引号转义）；
// 消耗流水派生（S4 上收 + 停药日当天起不计耗）。
const assert = require('assert');
const { test, summary } = require('../helper');
const {
  STOP_REASONS,
  deriveMedicationRecords,
  deriveConsumptionFlow,
  deriveConsumptionByMedicine,
  filterMedicationRecords,
  buildRecordText,
  buildRecordCsv
} = require('../../src/utils/records');

const d = (y, m, day) => new Date(y, m - 1, day).getTime();
const medicines = () => [
  { name: '示例丁药', createdAt: d(2026, 4, 10), archived: true, stoppedDate: '2026-08-01', stoppedReason: '疗程结束' },
  { name: '示例药品甲', createdAt: d(2026, 4, 10), archived: false },
  { name: '示例乙药', createdAt: d(2026, 3, 1), archived: true, stoppedDate: '2026-09-15', stoppedReason: '换药' },
  { name: '示例丙药', createdAt: d(2026, 5, 20), archived: false }
];

test('停药原因枚举导出', () => {
  assert.deepStrictEqual(STOP_REASONS, ['停药', '换药', '疗程结束']);
});

test('派生：开始日期取 createdAt 日期部分', () => {
  const r = deriveMedicationRecords(medicines().slice(0, 1));
  assert.strictEqual(r[0].startDate, '2026-04-10');
});

test('派生：id 透传（S4 记录页"重新启用"按钮定位药品用）', () => {
  const r = deriveMedicationRecords([{ id: 'med_9', name: 'X', createdAt: d(2026, 1, 1) }]);
  assert.strictEqual(r[0].id, 'med_9');
});

test('派生：服用中 endDate=null、原因"服用中"；停药显示日期与原因', () => {
  const r = deriveMedicationRecords(medicines());
  const byName = Object.fromEntries(r.map(x => [x.name, x]));
  assert.strictEqual(byName['示例药品甲'].endDate, null);
  assert.strictEqual(byName['示例药品甲'].reason, '服用中');
  assert.strictEqual(byName['示例丁药'].endDate, '2026-08-01');
  assert.strictEqual(byName['示例丁药'].reason, '疗程结束');
});

test('派生排序：服用中在前（组内新开始在前），停药在后（组内新停药在前）', () => {
  const names = deriveMedicationRecords(medicines()).map(x => x.name);
  assert.deepStrictEqual(names, ['示例丙药', '示例药品甲', '示例乙药', '示例丁药']);
});

test('派生：stoppedReason 缺省回退"停药"', () => {
  const r = deriveMedicationRecords([{ name: 'X', createdAt: d(2026, 1, 1), archived: true, stoppedDate: '2026-02-01' }]);
  assert.strictEqual(r[0].reason, '停药');
});

// ---- 消耗流水（S4：v1 页面逻辑上收 + R10 停药截断）----

const med = (over) => ({
  id: 'med_x', name: '测试药', usageTime: '早1', specPerBox: 30, dailyDose: 1,
  lastRestockDate: '2026-11-01', lastRestockStock: 30, createdAt: d(2026, 11, 1), updatedAt: 1,
  ...over
});

test('流水：正常推算（11-01 补货 30 粒日耗 1，11-01..03 各 1 粒），日期新→旧排序', () => {
  const flow = deriveConsumptionFlow([med()], ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepStrictEqual(flow.map(f => f.date), ['2026-11-03', '2026-11-02', '2026-11-01']);
  flow.forEach(f => {
    assert.strictEqual(f.consumed, 1);
    assert.strictEqual(f.name, '测试药');
    assert.strictEqual(f.dailyDose, 1);
  });
});

test('流水：停药日当天起不计耗（R10 冻结语义），停药日前照常', () => {
  const stopped = med({ archived: true, stoppedDate: '2026-11-02', stoppedReason: '换药' });
  const flow = deriveConsumptionFlow([stopped], ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepStrictEqual(flow.map(f => f.date), ['2026-11-01']); // 仅停药前一天有消耗
});

test('流水：耗尽后为 0 不出条目（v1 模型保留），停药日之后即使未耗尽也不出条目', () => {
  // 11-01 补 2 粒日耗 1：11-01、11-02 各 1，11-03 起耗尽为 0
  const small = med({ lastRestockStock: 2 });
  assert.deepStrictEqual(
    deriveConsumptionFlow([small], ['2026-11-03', '2026-11-04']).map(f => f.date),
    []
  );
});

test('流水：archived 但 stoppedDate 缺失（异常数据）不截断，保持 v1 行为', () => {
  const odd = med({ archived: true });
  const flow = deriveConsumptionFlow([odd], ['2026-11-02']);
  assert.strictEqual(flow.length, 1);
});

test('流水：空输入安全（无药品/无日期）', () => {
  assert.deepStrictEqual(deriveConsumptionFlow([], ['2026-11-01']), []);
  assert.deepStrictEqual(deriveConsumptionFlow([med()], []), []);
});

test('导出文本：表头齐全、服用中显示"至今"、四行数据列动态对齐', () => {
  const text = buildRecordText(deriveMedicationRecords(medicines()));
  const lines = text.split('\n');
  assert.strictEqual(lines.length, 5);
  for (const h of ['药品', '开始', '停止', '原因']) {
    assert.ok(lines[0].includes(h), `表头缺 ${h}`);
  }
  assert.ok(text.includes('至今'));
  assert.ok(text.includes('服用中'));
  // 列对齐：开始日期列在所有数据行的起始列号一致（宽度按最长单元格动态计算）
  const startCols = lines.slice(1).map(l => l.indexOf('2026-'));
  assert.ok(new Set(startCols).size === 1, `开始列未对齐：${startCols}`);
});

test('导出文本：两药样例精确匹配（列宽=最长单元格，中文按字符计数）', () => {
  const records = deriveMedicationRecords([
    { name: '示例丁药', createdAt: d(2026, 4, 10), archived: true, stoppedDate: '2026-08-01', stoppedReason: '疗程结束' },
    { name: '示例药品甲', createdAt: d(2026, 4, 10), archived: false }
  ]);
  assert.strictEqual(
    buildRecordText(records),
    '药品     开始          停止          原因\n' +
    '示例药品甲  2026-04-10  至今          服用中\n' +
    '示例丁药   2026-04-10  2026-08-01  疗程结束'
  );
});

test('导出 CSV：UTF-8 BOM 开头、含表头与至今、逗号分隔', () => {
  const csv = buildRecordCsv(deriveMedicationRecords(medicines()));
  assert.ok(csv.startsWith('\uFEFF'), '缺 BOM');
  const lines = csv.split('\n');
  assert.strictEqual(lines[0].replace(/^\uFEFF/, ''), '药品,开始,停止,原因');
  assert.ok(lines.some(l => l.includes('至今') && l.includes('服用中')));
  assert.ok(lines[1].split(',').length === 4);
});

test('导出 CSV：字段含逗号/引号时正确转义', () => {
  const csv = buildRecordCsv([
    { name: '维生素C,复合型', startDate: '2026-01-01', endDate: null, reason: '服用中', active: true }
  ]);
  assert.ok(csv.includes('"维生素C,复合型"'), '含逗号字段应加引号');
});

test('导出 CSV：字段含英文双引号时按 RFC4180 双写转义（审核修复 F-07 补断言）', () => {
  const csv = buildRecordCsv([
    { name: '维C"加强"', startDate: '2026-01-01', endDate: null, reason: '服用中', active: true }
  ]);
  assert.ok(csv.includes('"维C""加强"""'), '内部引号应双写且整字段加引号');
});

// ---- 按药分组 + 导出范围过滤（2026-11-12 负责人反馈）----

test('按药分组：合计/天数正确、组内日期新→旧、按合计降序', () => {
  const a = med({ name: '来特莫韦', lastRestockDate: '2026-11-10', lastRestockStock: 10, dailyDose: 2 });
  const b = med({ name: '碳酸钙', lastRestockDate: '2026-11-10', lastRestockStock: 10, dailyDose: 1 });
  const groups = deriveConsumptionByMedicine([a, b], ['2026-11-10', '2026-11-11', '2026-11-12']);
  assert.strictEqual(groups.length, 2);
  assert.strictEqual(groups[0].name, '来特莫韦'); // 合计 6 > 3 → 在前
  assert.strictEqual(groups[0].totalConsumed, 6);
  assert.strictEqual(groups[0].days.length, 3);
  assert.deepStrictEqual(groups[0].days.map(x => x.date), ['2026-11-12', '2026-11-11', '2026-11-10']);
  assert.strictEqual(groups[1].name, '碳酸钙');
  assert.strictEqual(groups[1].totalConsumed, 3);
});

test('按药分组：区间内无消耗的药不出组；停药截断语义继承；补货当日足额', () => {
  const stopped = med({ name: '已停药', lastRestockDate: '2026-11-01', lastRestockStock: 60, dailyDose: 1,
    archived: true, stoppedDate: '2026-11-02', stoppedReason: '换药' });
  const todayNew = med({ name: '今日新补', lastRestockDate: '2026-11-12', lastRestockStock: 30, dailyDose: 1 });
  const groups = deriveConsumptionByMedicine([stopped, todayNew], ['2026-11-10', '2026-11-11', '2026-11-12']);
  assert.strictEqual(groups.length, 1); // 停药 11-02 截断不出组；今日新补按"补货当日足额"出 1 粒（今日·预计）
  assert.strictEqual(groups[0].name, '今日新补');
  assert.strictEqual(groups[0].totalConsumed, 1);
  assert.strictEqual(groups[0].days.length, 1);
});

test('按药分组：今日行计入（全天预计口径，页面负责标注「今日·预计」）', () => {
  const m = med({ name: '来特莫韦', lastRestockDate: '2026-11-11', lastRestockStock: 10, dailyDose: 2 });
  const groups = deriveConsumptionByMedicine([m], ['2026-11-11', '2026-11-12']);
  assert.strictEqual(groups[0].totalConsumed, 4); // 11 日 2 + 12 日（今日）2
  assert.strictEqual(groups[0].days[0].date, '2026-11-12');
});

test('导出范围过滤：null=全部保留；7 天剔除停药日早于范围的记录', () => {
  const recs = [
    { name: '服用中', startDate: '2026-04-10', endDate: null, reason: '服用中', active: true },
    { name: '早停', startDate: '2026-04-10', endDate: '2026-10-01', reason: '停药', active: false },
    { name: '近停', startDate: '2026-04-10', endDate: '2026-11-10', reason: '换药', active: false }
  ];
  assert.strictEqual(filterMedicationRecords(recs, null, '2026-11-12').length, 3);
  const filtered = filterMedicationRecords(recs, '2026-11-06', '2026-11-12');
  assert.deepStrictEqual(filtered.map(r => r.name), ['服用中', '近停']); // 早停（10-01 < 11-06）剔除
});

test('导出范围过滤：未来开始/异常缺日期记录的防御口径（缺日期保留、未来开始剔除）', () => {
  const recs = [
    { name: '未来开始', startDate: '2026-11-20', endDate: null, reason: '服用中', active: true },
    { name: '缺开始', startDate: '', endDate: '2026-11-10', reason: '换药', active: false }
  ];
  const filtered = filterMedicationRecords(recs, '2026-11-06', '2026-11-12');
  assert.deepStrictEqual(filtered.map(r => r.name), ['缺开始']); // 缺开始不剔（宁可多导出），未来开始剔除
});

test('自选区间过滤（toDate）：开始晚于区间结束的剔除、区间后停药的保留（区间内有交集）', () => {
  const recs = [
    { name: '区间内停', startDate: '2026-11-01', endDate: '2026-11-05', reason: '换药', active: false },
    { name: '区间后停', startDate: '2026-11-01', endDate: '2026-11-20', reason: '停药', active: false },
    { name: '区间后始', startDate: '2026-11-15', endDate: null, reason: '服用中', active: true },
    { name: '早于区间停', startDate: '2026-10-01', endDate: '2026-10-31', reason: '疗程结束', active: false }
  ];
  // 自选区间 11-01 ~ 11-10（today=11-12）：区间后始（11-15>11-10）与早于区间停（10-31<11-01）剔除
  const filtered = filterMedicationRecords(recs, '2026-11-01', '2026-11-12', '2026-11-10');
  assert.deepStrictEqual(filtered.map(r => r.name), ['区间内停', '区间后停']);
});

test('自选区间过滤：toDate 缺省回落 today（与既有三档行为完全一致，向后兼容）', () => {
  const recs = [
    { name: '服用中', startDate: '2026-04-10', endDate: null, reason: '服用中', active: true },
    { name: '早停', startDate: '2026-04-10', endDate: '2026-10-01', reason: '停药', active: false }
  ];
  const noToDate = filterMedicationRecords(recs, '2026-11-06', '2026-11-12');
  const withToday = filterMedicationRecords(recs, '2026-11-06', '2026-11-12', '2026-11-12');
  assert.deepStrictEqual(noToDate, withToday);
});

test('自选区间过滤：fromDate=null 仍为全部（toDate 不生效），保持"全部历史"语义', () => {
  const recs = [
    { name: '任意', startDate: '2026-01-01', endDate: '2026-01-02', reason: '停药', active: false }
  ];
  assert.strictEqual(filterMedicationRecords(recs, null, '2026-11-12', '2026-11-10').length, 1);
});

summary('records.test.js');
