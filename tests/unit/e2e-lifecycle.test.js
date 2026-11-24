// 端到端生命周期测试（任务书 S3=模块集成联调）：以 Node 等价层串联完整业务链，
// 覆盖 冷启动注入/迁移 → 三问式添加 → 今日分组 → 停药(今日消失/记录出现/流水冻结)
// → 恢复(推算续接) → 导出。页面交互层另由 automator 走查覆盖（MCP）。
// wx 以内存 mock 替代（storage.js 是唯一允许依赖 wx 的模块）。
const assert = require('assert');
const { test, summary } = require('../helper');

function mockWx(initial) {
  const store = { ...initial };
  global.wx = {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; }
  };
  return store;
}

const storage = require('../../src/utils/storage');
const { v2Medicines } = require('../fixtures/medicines');
const { deriveTodaySchedule, buildUsageTime } = require('../../src/utils/schedule');
const { deriveMedicineStatus, applyRestock } = require('../../src/utils/medicine');
const { formatDate, addDays } = require('../../src/utils/date');
const records = require('../../src/utils/records');

// 冷启动等价（app.js onLaunch，2026-11-12 负责人决定后语义）：空库保持空箱（不注入预置数据）+ 幂等迁移照常
test('e2e 冷启动：空库保持空箱不注入；v1 存量数据迁移为 v2 结构', () => {
  mockWx({});
  storage.migrateToV2();
  assert.deepStrictEqual(storage.loadMedicines(), [], '首启不得注入预置药品');

  // 老用户 v1 存量 → 迁移补 timeSlots、今日页全部落固定时段组
  const { rawMedicines } = require('../fixtures/medicines');
  mockWx({ medicines: rawMedicines() });
  storage.migrateToV2();
  const list = storage.loadMedicines();
  assert.strictEqual(list.length, 14);
  list.forEach((m) => {
    assert.ok(Array.isArray(m.timeSlots), `${m.name} 缺 timeSlots`);
    assert.ok(m.timeSlots.length > 0, `${m.name} timeSlots 为空（usageTime=${m.usageTime}）`);
  });
  const { unscheduled } = deriveTodaySchedule(list, new Date(2026, 10, 11, 8, 0), null);
  assert.strictEqual(unscheduled.length, 0);
});

test('e2e 三问式添加 → 落库字段 → 今日页正确分组（路径A）', () => {
  mockWx({ medicines: v2Medicines(), schemaVersion: 2 });

  // 模拟 medicine-add 提交（早1.5晚1、60粒/盒×1盒 → 与 S3 走查样例一致）
  const timeSlots = [
    { slot: 'morning', dose: 1.5 },
    { slot: 'evening', dose: 1 }
  ];
  const added = storage.addMedicine({
    name: '联调测试药',
    usageTime: buildUsageTime(timeSlots),
    timeSlots,
    specPerBox: 60,
    dailyDose: 2.5,
    lastRestockDate: '2026-11-11',
    lastRestockStock: 60
  });

  const stored = storage.getMedicineById(added.id);
  assert.strictEqual(stored.usageTime, '早1.5晚1');
  assert.deepStrictEqual(stored.timeSlots, timeSlots);
  assert.strictEqual(stored.dailyDose, 2.5);

  const list = storage.loadMedicines();
  const morning = deriveTodaySchedule(list, new Date(2026, 10, 11, 8, 0), null)
    .groups.find((g) => g.slot === 'morning');
  const item = morning.items.find((i) => i.id === added.id);
  assert.ok(item, '新药未进早上组');
  assert.strictEqual(item.dose, 1.5);
});

test('e2e 停药 → 今日页/推算冻结 → 记录与流水联动（路径B/D）', () => {
  mockWx({ medicines: v2Medicines(), schemaVersion: 2 });

  // 日期锚点相对真实"今天"（2026-11-12 跨天暴露原硬编码 11-11 的脆弱性，改为永不过时的相对锚）
  const today = new Date();
  const todayStr = formatDate(today);
  const anchor = formatDate(addDays(today, -6)); // 6 天前基准 10 粒 → 今天剩 4 粒

  const before = storage.addMedicine({
    name: '停药链测试药', usageTime: '早1', timeSlots: [{ slot: 'morning', dose: 1 }],
    specPerBox: 30, dailyDose: 1,
    lastRestockDate: anchor, lastRestockStock: 10
  });

  // 停药（stopMedicine 内部取真实今天）
  const stopped = storage.stopMedicine(before.id, '换药');
  assert.strictEqual(stopped.archived, true);
  assert.strictEqual(stopped.stoppedDate, todayStr);

  const list = storage.loadMedicines();
  // ① 今日页消失
  const groups = deriveTodaySchedule(list, new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0), null).groups;
  assert.ok(!groups.some((g) => g.items.some((i) => i.id === before.id)));
  // ② 详情页冻结口径：推算至停药日 → 剩 4 粒（而非按明天继续掉）
  const frozen = deriveMedicineStatus(storage.getMedicineById(before.id), today);
  assert.strictEqual(frozen.remainingPills, 4);
  // ③ 记录页出现"起—止（原因）"
  const rec = records.deriveMedicationRecords(list).find((r) => r.id === before.id);
  assert.strictEqual(rec.endDate, todayStr);
  assert.strictEqual(rec.reason, '换药');
  // ④ 消耗流水：停药日（含）之后不再计耗，停药前一天仍有
  const flow = records.deriveConsumptionFlow(list, [formatDate(addDays(today, -2)), formatDate(addDays(today, -1)), todayStr]);
  const mine = flow.filter((f) => f.name === '停药链测试药');
  assert.deepStrictEqual(mine.map((f) => f.date), [formatDate(addDays(today, -1)), formatDate(addDays(today, -2))]);
});

test('e2e 恢复 → 基准=停药日推算剩余 → 回到今日页且推算无缝续接（路径B 回程）', () => {
  mockWx({ medicines: v2Medicines(), schemaVersion: 2 });

  const today = new Date();
  const anchor = formatDate(addDays(today, -6)); // 6 天前基准 10 粒 → 停药时（今天）剩 4

  const m = storage.addMedicine({
    name: '恢复链测试药', usageTime: '早1', timeSlots: [{ slot: 'morning', dose: 1 }],
    specPerBox: 30, dailyDose: 1,
    lastRestockDate: anchor, lastRestockStock: 10
  });
  storage.stopMedicine(m.id, '疗程结束');

  const resumed = storage.resumeMedicine(m.id);
  assert.strictEqual(resumed.archived, false);
  assert.strictEqual(resumed.lastRestockStock, 4); // 停药日推算剩余（负值截 0 语义见 migration 单测）
  assert.strictEqual(resumed.lastRestockDate, formatDate(today)); // 基准日=恢复当天

  // 回到今日页
  const groups = deriveTodaySchedule(storage.loadMedicines(), new Date(today.getFullYear(), today.getMonth(), today.getDate(), 8, 0), null).groups;
  assert.ok(groups.some((g) => g.items.some((i) => i.id === m.id)));
  // 推算无缝续接：恢复日基准 4 粒，当天推算剩余=4
  const s = deriveMedicineStatus(storage.getMedicineById(m.id), today);
  assert.strictEqual(s.remainingPills, 4);
  // 记录回到"服用中"
  const rec = records.deriveMedicationRecords(storage.loadMedicines()).find((r) => r.id === m.id);
  assert.strictEqual(rec.active, true);
  assert.strictEqual(rec.endDate, null);
});

test('e2e 补货 → 导出联动（路径A/C）：复制文本与 CSV 均含新基准药', () => {
  mockWx({ medicines: v2Medicines(), schemaVersion: 2 });

  const m = storage.getMedicineById('med_001');
  const old = deriveMedicineStatus(m);
  const updated = applyRestock(m, 2); // 推算剩余(负截0) + 2 盒×30
  storage.updateMedicine('med_001', updated);
  assert.strictEqual(
    storage.getMedicineById('med_001').lastRestockStock,
    Math.max(0, old.remainingPills) + 60
  );

  const recs = records.deriveMedicationRecords(storage.loadMedicines());
  const text = records.buildRecordText(recs);
  const csv = records.buildRecordCsv(recs);
  assert.ok(text.includes('示例药品01'));
  assert.ok(text.startsWith('药品'));
  assert.ok(csv.startsWith('\uFEFF药品,开始,停止,原因'));
  assert.ok(csv.includes('示例药品01'));
});

summary('e2e-lifecycle.test.js');
