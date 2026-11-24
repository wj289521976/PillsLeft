// storage.js v2 扩展单测：migrateToV2 幂等迁移 + stopMedicine/resumeMedicine。
// wx 以内存 mock 替代（storage.js 是唯一允许依赖 wx 的模块）。
const assert = require('assert');
const { test, summary } = require('../helper');
const { formatDate } = require('../../src/utils/date');

function mockWx(initial) {
  const store = { ...initial };
  global.wx = {
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; }
  };
  return store;
}

const v1Medicines = () => [
  { id: 'med_001', name: '示例药品01', usageTime: '晚1', specPerBox: 30, dailyDose: 1,
    lastRestockDate: '2026-04-10', lastRestockStock: 48, createdAt: 1, updatedAt: 1 },
  { id: 'med_004', name: '示例药品04', usageTime: '早（1/4）', specPerBox: 24, dailyDose: 0.25,
    lastRestockDate: '2026-04-10', lastRestockStock: 1, createdAt: 1, updatedAt: 1 },
  { id: 'med_020', name: '无法解析', usageTime: '饭前吃', specPerBox: 10, dailyDose: 2,
    lastRestockDate: '2026-04-10', lastRestockStock: 20, createdAt: 1, updatedAt: 1 }
];

test('v1→v2 迁移：补 timeSlots、库存数字与 usageTime 原文不变、写版本 2', () => {
  const store = mockWx({ medicines: v1Medicines() });
  const storage = require('../../src/utils/storage');
  const before = JSON.parse(JSON.stringify(store.medicines));
  const migrated = storage.migrateToV2();

  assert.strictEqual(migrated, true);
  assert.strictEqual(store.schemaVersion, 2);
  const after = store.medicines;
  assert.deepStrictEqual(after[0].timeSlots, [{ slot: 'evening', dose: 1 }]);
  assert.deepStrictEqual(after[1].timeSlots, [{ slot: 'morning', dose: 0.25 }]);
  assert.deepStrictEqual(after[2].timeSlots, []); // 解析失败 → 空，原文保留
  after.forEach((m, i) => {
    assert.strictEqual(m.dailyDose, before[i].dailyDose);
    assert.strictEqual(m.lastRestockStock, before[i].lastRestockStock);
    assert.strictEqual(m.lastRestockDate, before[i].lastRestockDate);
    assert.strictEqual(m.usageTime, before[i].usageTime);
  });
});

test('迁移幂等：重复执行无副作用、返回 false', () => {
  const store = mockWx({ medicines: v1Medicines() });
  const storage = require('../../src/utils/storage');
  storage.migrateToV2();
  const snapshot = JSON.parse(JSON.stringify(store.medicines));

  assert.strictEqual(storage.migrateToV2(), false);
  assert.deepStrictEqual(store.medicines, snapshot);
  assert.strictEqual(store.schemaVersion, 2);
});

test('timeSlots 已存在不覆盖（用户手动排过程的药）', () => {
  const list = v1Medicines();
  list[0].timeSlots = [{ slot: 'noon', dose: 2 }];
  const store = mockWx({ medicines: list });
  const storage = require('../../src/utils/storage');
  storage.migrateToV2();

  assert.deepStrictEqual(store.medicines[0].timeSlots, [{ slot: 'noon', dose: 2 }]);
});

test('空 medicines 也写版本号（新用户路径）', () => {
  const store = mockWx({ medicines: [] });
  const storage = require('../../src/utils/storage');
  assert.strictEqual(storage.migrateToV2(), true);
  assert.strictEqual(store.schemaVersion, 2);
});

test('stopMedicine：冻结并记录停药日与原因；重复/不存在返回 null', () => {
  const store = mockWx({ medicines: v1Medicines(), schemaVersion: 2 });
  const storage = require('../../src/utils/storage');

  const stopped = storage.stopMedicine('med_001', '换药');
  assert.strictEqual(stopped.archived, true);
  assert.strictEqual(stopped.stoppedDate, formatDate(new Date()));
  assert.strictEqual(stopped.stoppedReason, '换药');
  assert.strictEqual(stopped.lastRestockStock, 48); // 基准不动
  assert.strictEqual(storage.stopMedicine('med_001'), null); // 已停药
  assert.strictEqual(storage.stopMedicine('med_xxx'), null); // 不存在
  assert.strictEqual(storage.stopMedicine('med_020').stoppedReason, '停药'); // 缺省原因
});

test('resumeMedicine：以停药日推算剩余为今天基准，恢复继续推算', () => {
  // 04-10 补货 48 粒、日耗 1 → 停药日 2026-04-18 剩 40；恢复后基准=40、基准日=今天
  const list = v1Medicines().slice(0, 1);
  list[0].archived = true;
  list[0].stoppedDate = '2026-04-18';
  list[0].stoppedReason = '换药';
  const store = mockWx({ medicines: list, schemaVersion: 2 });
  const storage = require('../../src/utils/storage');

  const resumed = storage.resumeMedicine('med_001');
  assert.strictEqual(resumed.archived, false);
  assert.strictEqual(resumed.lastRestockStock, 40);
  assert.strictEqual(resumed.lastRestockDate, formatDate(new Date()));
});

test('resumeMedicine：负库存截断为 0；未停药/不存在返回 null', () => {
  const list = v1Medicines().slice(0, 1);
  list[0].archived = true;
  list[0].stoppedDate = '2026-06-01'; // 52 天 × 1 粒/天 > 48 → 剩 -4 → 0
  mockWx({ medicines: list, schemaVersion: 2 });
  const storage = require('../../src/utils/storage');
  assert.strictEqual(storage.resumeMedicine('med_001').lastRestockStock, 0);

  const store2 = mockWx({ medicines: v1Medicines().slice(1, 2), schemaVersion: 2 });
  assert.strictEqual(storage.resumeMedicine('med_004'), null); // 未停药
  assert.strictEqual(storage.resumeMedicine('med_xxx'), null); // 不存在
  void store2;
});

summary('migration.test.js');
