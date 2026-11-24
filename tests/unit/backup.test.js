// storage.js 应用内全量备份/恢复单测（F5，S5 设置页整合落地）：
// buildBackupPayload 结构 / parseBackupPayload 防御校验 / applyBackup 落库与迁移统一。
// wx 以内存 mock 替代（仿 migration.test.js）；applyBackup 内部复用幂等迁移（migrateToV2）。
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

// v2 药品样例（已带 timeSlots）
const v2Meds = () => [
  { id: 'med_001', name: '示例药品01', usageTime: '晚1', specPerBox: 30, dailyDose: 1,
    lastRestockDate: '2026-04-10', lastRestockStock: 48, createdAt: 1, updatedAt: 1,
    timeSlots: [{ slot: 'evening', dose: 1 }] },
  { id: 'med_005', name: '示例药品05', usageTime: '早4晚4', specPerBox: 12, dailyDose: 8,
    lastRestockDate: '2026-04-10', lastRestockStock: 96, createdAt: 1, updatedAt: 1,
    timeSlots: [{ slot: 'morning', dose: 4 }, { slot: 'evening', dose: 4 }] }
];

// v1 药品样例（无 timeSlots，恢复时须由迁移补齐）
const v1Meds = () => [
  { id: 'med_002', name: '示例药品02', usageTime: '晚1', specPerBox: 10, dailyDose: 1,
    lastRestockDate: '2026-04-16', lastRestockStock: 60, createdAt: 1, updatedAt: 1 }
];

test('buildBackupPayload：五字段结构齐全，exportedAt/schemaVersion 可注入（测试确定性）', () => {
  const { buildBackupPayload, BACKUP_APP_ID } = require('../../src/utils/storage');
  const p = buildBackupPayload(v2Meds(), { reminderOn: false }, 2, '2026-11-11T08:00:00.000Z');
  assert.strictEqual(p.app, BACKUP_APP_ID);
  assert.strictEqual(p.exportedAt, '2026-11-11T08:00:00.000Z');
  assert.strictEqual(p.schemaVersion, 2);
  assert.strictEqual(p.medicines.length, 2);
  assert.deepStrictEqual(p.settings, { reminderOn: false });
});

test('parseBackupPayload：合法 v2 载荷通过，settings 归一化、exportedAt 透传', () => {
  const { buildBackupPayload, parseBackupPayload } = require('../../src/utils/storage');
  const raw = buildBackupPayload(v2Meds(), { slotTimes: { morning: '06:00' }, reminderOn: false }, 2, '2026-11-11T08:00:00.000Z');
  const parsed = parseBackupPayload(raw);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.medicines.length, 2);
  assert.strictEqual(parsed.dropped, 0);
  assert.strictEqual(parsed.exportedAt, '2026-11-11T08:00:00.000Z');
  assert.deepStrictEqual(parsed.settings, {
    slotTimes: { morning: '06:00', noon: '12:00', evening: '18:00', bedtime: '22:00' },
    reminderOn: false
  });
});

test('parseBackupPayload：app 标识不符 / 非对象 / medicines 非数组 → 拒绝不抛错', () => {
  const { parseBackupPayload } = require('../../src/utils/storage');
  assert.strictEqual(parseBackupPayload({ app: 'other-app', medicines: [] }).ok, false);
  assert.strictEqual(parseBackupPayload(null).ok, false);
  assert.strictEqual(parseBackupPayload('text').ok, false);
  assert.strictEqual(parseBackupPayload([1, 2]).ok, false);
  assert.strictEqual(parseBackupPayload({ app: 'wj-medicine-box', medicines: 'x' }).ok, false);
});

test('parseBackupPayload：全部条目无效（缺 name/非字符串/空串）→ 拒绝；部分无效 → 剔除并计数', () => {
  const { BACKUP_APP_ID, parseBackupPayload } = require('../../src/utils/storage');
  const allBad = { app: BACKUP_APP_ID, medicines: [{ specPerBox: 10 }, 'x', { name: '' }] };
  assert.strictEqual(parseBackupPayload(allBad).ok, false);

  const mixed = {
    app: BACKUP_APP_ID,
    medicines: [...v2Meds(), null, { name: 123 }, { name: '' }, 'str']
  };
  const parsed = parseBackupPayload(mixed);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.medicines.length, 2);
  assert.strictEqual(parsed.dropped, 4);
});

test('parseBackupPayload：settings 缺失 → null；settings 为垃圾类型 → 归一化默认', () => {
  const { BACKUP_APP_ID, parseBackupPayload } = require('../../src/utils/storage');
  const noSettings = parseBackupPayload({ app: BACKUP_APP_ID, medicines: v2Meds() });
  assert.strictEqual(noSettings.settings, null);

  const badSettings = parseBackupPayload({ app: BACKUP_APP_ID, medicines: v2Meds(), settings: 'garbage' });
  assert.deepStrictEqual(badSettings.settings, {
    slotTimes: { morning: '07:00', noon: '12:00', evening: '18:00', bedtime: '22:00' },
    reminderOn: true
  });
});

test('applyBackup（v2 备份）：medicines/settings 落库、schemaVersion=2、timeSlots 原样保留', () => {
  const store = mockWx({});
  const storage = require('../../src/utils/storage');
const { v2Medicines } = require('../fixtures/medicines');
  const parsed = storage.parseBackupPayload(
    storage.buildBackupPayload(v2Meds(), { slotTimes: { noon: '13:00' }, reminderOn: false }, 2, '2026-11-11T08:00:00.000Z')
  );
  const count = storage.applyBackup(parsed);
  assert.strictEqual(count, 2);
  assert.strictEqual(store.schemaVersion, 2);
  assert.deepStrictEqual(store.medicines[0].timeSlots, [{ slot: 'evening', dose: 1 }]);
  assert.strictEqual(store.settings.slotTimes.noon, '13:00');
  assert.strictEqual(store.settings.reminderOn, false);
});

test('applyBackup（v1 备份，无 timeSlots）：走幂等迁移补齐 timeSlots 并升版本 2', () => {
  const store = mockWx({});
  const storage = require('../../src/utils/storage');
const { v2Medicines } = require('../fixtures/medicines');
  const parsed = storage.parseBackupPayload({
    app: 'wj-medicine-box', exportedAt: '2026-04-01T00:00:00.000Z', schemaVersion: 1, medicines: v1Meds()
  });
  const count = storage.applyBackup(parsed);
  assert.strictEqual(count, 1);
  assert.strictEqual(store.schemaVersion, 2);
  assert.deepStrictEqual(store.medicines[0].timeSlots, [{ slot: 'evening', dose: 1 }]); // "晚1" 解析补齐
  assert.strictEqual(store.medicines[0].dailyDose, 1); // 库存数字不动
});

test('端到端 roundtrip：默认 14 药 + 自定义设置 → stringify → parse → 恢复 → 数据/设置全还原', () => {
  const store = mockWx({ schemaVersion: 2 });
  const storage = require('../../src/utils/storage');
const { v2Medicines } = require('../fixtures/medicines');

  // 现场准备：14 药 + 自定义时刻/关闭提醒
  store.medicines = v2Medicines();
  storage.saveSettings({ slotTimes: { morning: '06:30', bedtime: '23:00' }, reminderOn: false });

  // 导出（模拟剪贴板/文件通道的序列化）
  const text = JSON.stringify(storage.buildBackupPayload(
    storage.loadMedicines(), storage.loadSettings(), 2, '2026-11-11T12:00:00.000Z'
  ));

  // 破坏现场后恢复
  store.medicines = 'broken-not-array';
  store.settings = { garbage: true };
  const parsed = storage.parseBackupPayload(JSON.parse(text));
  assert.strictEqual(parsed.ok, true);
  const count = storage.applyBackup(parsed);

  assert.strictEqual(count, 14);
  assert.strictEqual(storage.loadMedicines().length, 14);
  // timeSlots 齐全（默认药出厂即 v2，迁移无副作用）
  storage.loadMedicines().forEach((m) => assert.ok(Array.isArray(m.timeSlots)));
  assert.strictEqual(storage.loadSettings().slotTimes.morning, '06:30');
  assert.strictEqual(storage.loadSettings().slotTimes.bedtime, '23:00');
  assert.strictEqual(storage.loadSettings().reminderOn, false);
});

test('导入内容为空药箱备份（medicines=[]）→ 拒绝，防误导入空备份清空数据', () => {
  const { BACKUP_APP_ID, parseBackupPayload } = require('../../src/utils/storage');
  const parsed = parseBackupPayload({ app: BACKUP_APP_ID, medicines: [] });
  assert.strictEqual(parsed.ok, false);
});

// ---- S5 独立审核回归（2026-11-11，修复 F-03/F-02）----

test('畸形字段条目剔除：缺 lastRestockDate/dailyDose≤0/坏日期/坏库存不再进入恢复（防今日页崩溃）', () => {
  const { BACKUP_APP_ID, parseBackupPayload } = require('../../src/utils/storage');
  const parsed = parseBackupPayload({
    app: BACKUP_APP_ID,
    medicines: [
      ...v2Meds(),
      { name: '无日期', dailyDose: 1, specPerBox: 10, lastRestockDate: undefined, lastRestockStock: 10 },
      { name: '零剂量', dailyDose: 0, specPerBox: 10, lastRestockDate: '2026-01-01', lastRestockStock: 10 },
      { name: '坏日期', dailyDose: 1, specPerBox: 10, lastRestockDate: 123, lastRestockStock: 10 },
      { name: '坏库存', dailyDose: 1, specPerBox: 10, lastRestockDate: '2026-01-01', lastRestockStock: 'x' }
    ]
  });
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.medicines.length, 2);
  assert.strictEqual(parsed.dropped, 4);
  // 修复前：无日期/坏日期条目可通过 → 恢复后 deriveMedicineStatus→parseDate(undefined/123) 抛 TypeError
});

test('备份畸形 settings 时刻被 normalizeSettings 拦截回退默认（修复 F-02 联动）', () => {
  const { BACKUP_APP_ID, parseBackupPayload } = require('../../src/utils/storage');
  const parsed = parseBackupPayload({
    app: BACKUP_APP_ID, medicines: v2Meds(),
    settings: { slotTimes: { morning: '99:99', noon: 7 }, reminderOn: false }
  });
  assert.strictEqual(parsed.settings.slotTimes.morning, '07:00');
  assert.strictEqual(parsed.settings.slotTimes.noon, '12:00');
  assert.strictEqual(parsed.settings.reminderOn, false); // 合法字段不受影响
});

summary('backup.test.js');
