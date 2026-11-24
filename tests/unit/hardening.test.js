// S4（任务书·测试安全加固）专项单测：异常数据防御、启动注入语义、编辑页一致性、
// 导出容错、迁移失败重试。对应修复 F1-F4/F6/F7（见 docs/05-testing/S4-测试计划与风险清单.md）。
// wx 以内存 mock 替代（storage.js 是唯一允许依赖 wx 的模块）；app.js 以捕获 App() 配置等价测试。
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
const { parseUsageTime, deriveTodaySchedule } = require('../../src/utils/schedule');
const { deriveMedicineStatus } = require('../../src/utils/medicine');
const records = require('../../src/utils/records');

// ---- F4a：loadMedicines 防御性读取（损坏 storage 不抛 TypeError）----
test('F4a loadMedicines：字符串/数字/null/对象/缺键 一律回退空数组', () => {
  ['broken-string', 42, null, { a: 1 }, ''].forEach((v) => {
    mockWx({ medicines: v });
    assert.deepStrictEqual(storage.loadMedicines(), [], `值 ${JSON.stringify(v)} 应回退 []`);
  });
  mockWx({ medicines: [{ id: 'x' }] });
  assert.strictEqual(storage.loadMedicines().length, 1, '正常数组透传');
});

// ---- F3：首启语义（2026-11-12 负责人决定改写：原 14 种"演示药"实为个人真实记录，彻底移除——
// 不再注入任何预置数据；旧 initialized 键不再读写。等价层复刻现版 app.js onLaunch）----
function onLaunchEquivalent(store) {
  storage.migrateToV2();
}

test('F3 首次启动（空库）→ 保持空箱，不注入任何预置数据、不写 initialized', () => {
  const store = mockWx({});
  onLaunchEquivalent(store);
  assert.deepStrictEqual(storage.loadMedicines(), [], '首启不得注入预置药品');
  assert.strictEqual('initialized' in store, false, 'initialized 键已废弃不再写入');
});

test('F3 老用户已有药 → 数据原样、迁移照常补 timeSlots', () => {
  const mine = [{ id: 'my_1', name: '我的药', usageTime: '早1', specPerBox: 30, dailyDose: 1, lastRestockDate: '2026-11-01', lastRestockStock: 30 }];
  const store = mockWx({ medicines: mine });
  onLaunchEquivalent(store);
  const list = storage.loadMedicines();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, '我的药');
  assert.deepStrictEqual(list[0].timeSlots, [{ slot: 'morning', dose: 1 }], '迁移补 timeSlots');
});

test('F3 清空数据后重启 → 保持空箱（无预置数据可回注，语义自然成立）', () => {
  const store = mockWx({ medicines: [{ id: 'x', name: '旧药', usageTime: '早1', dailyDose: 1, specPerBox: 10, lastRestockDate: '2026-11-01', lastRestockStock: 10 }], schemaVersion: 2 });
  wx.removeStorageSync('medicines'); // 设置页「清空数据」动作
  onLaunchEquivalent(store); // 重启
  assert.deepStrictEqual(storage.loadMedicines(), [], '清空后重启保持空箱');
});

test('F3+F4 损坏数据（medicines 非数组）→ 不抛错、不注入、空箱自洽', () => {
  const store = mockWx({ medicines: 'broken', schemaVersion: 2 });
  assert.doesNotThrow(() => onLaunchEquivalent(store));
  assert.deepStrictEqual(storage.loadMedicines(), []);
});

// ---- F7：app.js onLaunch 启动兜底（真实模块加载 + App 捕获）----
test('F7 onLaunch：storage 抛异常时不向外传播（try/catch 兜底，降级不阻断）', () => {
  mockWx({});
  wx.getStorageSync = () => { throw new Error('storage 故障'); };
  let appConfig;
  global.App = (cfg) => { appConfig = cfg; };
  const origLog = console.log; // 兜底会记 error 级日志，静默 transport 保持测试输出整洁
  console.log = () => {};
  try {
    require('../../src/app.js'); // 依赖上面 global.App 捕获配置
    assert.ok(appConfig && typeof appConfig.onLaunch === 'function');
    assert.doesNotThrow(() => appConfig.onLaunch());
  } finally {
    console.log = origLog;
    delete global.App;
  }
});

// ---- F1/F2/F6：编辑页提交语义等价层（新 onSubmit 的 utils 侧后果）----
// 复刻 medicine-edit.js（S4 加固版）提交前守卫：非数字一律拒绝（修复 NaN 落库）。
function editGuards(f, today) {
  if (!f.name || !f.name.trim()) return '名称';
  if (f.name.trim().length > 30) return '名称长度';
  const spec = Number(f.specPerBox);
  if (!Number.isInteger(spec) || spec < 1 || spec > 9999) return '规格';
  const dose = Number(f.dailyDose);
  if (!Number.isFinite(dose) || dose <= 0) return '用量';
  const stock = Number(f.lastRestockStock);
  if (!Number.isFinite(stock) || stock <= 0) return '库存';
  if (stock < dose) return '库存<用量';
  if (!f.lastRestockDate || f.lastRestockDate > today) return '日期';
  return null;
}

test('F1 编辑页守卫：非数字（NaN 注入）与越界值全部被拒', () => {
  const today = '2026-11-11';
  const base = { name: '药', specPerBox: '30', dailyDose: '1', lastRestockStock: '60', lastRestockDate: today };
  // 旧校验放行、新守卫拦截的用例（parseInt/parseFloat NaN 比较恒 false 缺陷）
  assert.strictEqual(editGuards({ ...base, specPerBox: 'abc' }, today), '规格');
  assert.strictEqual(editGuards({ ...base, dailyDose: 'abc' }, today), '用量');
  assert.strictEqual(editGuards({ ...base, lastRestockStock: 'xyz' }, today), '库存');
  // R02 补全项
  assert.strictEqual(editGuards({ ...base, name: 'x'.repeat(31) }, today), '名称长度');
  assert.strictEqual(editGuards({ ...base, specPerBox: '10000' }, today), '规格');
  assert.strictEqual(editGuards({ ...base, specPerBox: '30.5' }, today), '规格');
  assert.strictEqual(editGuards({ ...base, lastRestockStock: '0.5', dailyDose: '1' }, today), '库存<用量');
  assert.strictEqual(editGuards({ ...base, lastRestockDate: '2026-11-12' }, today), '日期');
  assert.strictEqual(editGuards(base, today), null, '合法输入放行');
});

test('F2 编辑 usageTime 后 timeSlots 同步重算：今日页分组随之正确【缺陷防回归】', () => {
  mockWx({});
  const added = storage.addMedicine({
    name: '同步测试药', usageTime: '早1晚1', timeSlots: parseUsageTime('早1晚1'),
    specPerBox: 30, dailyDose: 2, lastRestockDate: '2026-11-11', lastRestockStock: 60
  });
  // 编辑为"中1"（复刻新 onSubmit：timeSlots 重算 + dailyDose=时段和）
  const usageTime = '中1';
  const timeSlots = parseUsageTime(usageTime);
  storage.updateMedicine(added.id, {
    usageTime, timeSlots,
    dailyDose: timeSlots.reduce((a, t) => a + t.dose, 0)
  });
  const edited = storage.getMedicineById(added.id);
  assert.deepStrictEqual(edited.timeSlots, [{ slot: 'noon', dose: 1 }], 'timeSlots 与 usageTime 同源');
  assert.strictEqual(edited.dailyDose, 1, 'dailyDose=分时段之和');

  const at8 = new Date(2026, 10, 11, 8, 0);
  const sched = deriveTodaySchedule(storage.loadMedicines(), at8, null);
  const inGroup = (slot) => sched.groups.find((g) => g.slot === slot).items.some((i) => i.id === added.id);
  assert.ok(inGroup('noon'), '应进中午组');
  assert.ok(!inGroup('morning') && !inGroup('evening'), '不应再进早/晚组（旧缺陷：残留旧时段）');
});

test('F2 未排程编辑：解析失败保留表单 dailyDose，归"未排程"展示原文', () => {
  mockWx({});
  const added = storage.addMedicine({
    name: '必要时药', usageTime: '早1', timeSlots: parseUsageTime('早1'),
    specPerBox: 30, dailyDose: 1, lastRestockDate: '2026-11-11', lastRestockStock: 30
  });
  const usageTime = '疼了才吃'; // 解析失败 → []
  const timeSlots = parseUsageTime(usageTime);
  const finalDose = timeSlots.length > 0 ? timeSlots.reduce((a, t) => a + t.dose, 0) : 1.5;
  storage.updateMedicine(added.id, { usageTime, timeSlots, dailyDose: finalDose });

  const sched = deriveTodaySchedule(storage.loadMedicines(), new Date(2026, 10, 11, 8, 0), null);
  const u = sched.unscheduled.find((i) => i.id === added.id);
  assert.ok(u, '应归未排程组');
  assert.strictEqual(u.usageTime, '疼了才吃', '保留原文展示');
  assert.strictEqual(storage.getMedicineById(added.id).dailyDose, 1.5);
});

// ---- F4b/c：导出链异常数据容错 ----
test('F4b deriveMedicationRecords：缺 name/createdAt/stoppedDate/stoppedReason 均有兜底', () => {
  const rs = records.deriveMedicationRecords([
    { id: 'a', archived: true }, // 极简损坏数据
    { id: 'b', name: '正常药', createdAt: 1731283200000 }
  ]);
  assert.strictEqual(rs[1].name, '未知药品');
  assert.strictEqual(rs[1].startDate, '');
  assert.strictEqual(rs[1].endDate, '');
  assert.strictEqual(rs[1].reason, '停药');
  assert.strictEqual(rs[0].name, '正常药');
  assert.strictEqual(rs[0].active, true);
});

test('F4c buildRecordText/buildRecordCsv：异常记录不抛错，非数组入参仅表头', () => {
  assert.doesNotThrow(() => {
    const text = records.buildRecordText([{ id: 'a' }, { name: '药B', startDate: '', endDate: null, reason: '服用中' }]);
    assert.ok(text.startsWith('药品'));
    const csv = records.buildRecordCsv([{ id: 'a' }]);
    assert.ok(csv.startsWith('\uFEFF药品,开始,停止,原因'));
  });
  assert.strictEqual(records.buildRecordText('not-array'), '药品  开始  停止  原因');
});

// ---- T2.3：迁移失败重试（幂等）----
test('T2.3 migrateToV2 写入中途失败 → schemaVersion 不落 → 恢复后重试成功且库存不变', () => {
  const store = mockWx({ medicines: [{ id: 'v1_1', name: '旧药', usageTime: '早1', specPerBox: 30, dailyDose: 1, lastRestockDate: '2026-11-01', lastRestockStock: 30 }] });
  const origSet = wx.setStorageSync;
  wx.setStorageSync = (k, v) => { if (k === 'medicines') throw new Error('写入失败'); origSet(k, v); };
  assert.throws(() => storage.migrateToV2(), /写入失败/);
  assert.ok(!store.schemaVersion, '迁移失败不得标记 schemaVersion（下次重试）');
  wx.setStorageSync = origSet; // 恢复写入 → 重启重试
  assert.strictEqual(storage.migrateToV2(), true);
  const m = storage.getMedicineById('v1_1');
  assert.deepStrictEqual(m.timeSlots, [{ slot: 'morning', dose: 1 }]);
  assert.strictEqual(m.lastRestockStock, 30, '库存数字迁移前后不变');
  assert.strictEqual(storage.migrateToV2(), false, '重复迁移无副作用');
});

// ---- T1.5：添加页上限组合落库推算均为有限数值（NaN 防回归）----
test('T1.5 边界组合：4 时段×20 剂量、规格 1/9999、99 盒 → 推算有限且状态正确', () => {
  const slotsText = '早20中20晚20睡前20';
  const timeSlots = parseUsageTime(slotsText);
  assert.strictEqual(timeSlots.reduce((a, t) => a + t.dose, 0), 80);
  [
    { specPerBox: 1, stock: 80, expected: 'warning' }, // 80÷80=1 天 → 预警
    { specPerBox: 9999, stock: 99 * 9999, expected: 'sufficient' }
  ].forEach(({ specPerBox, stock, expected }) => {
    const s = deriveMedicineStatus({
      lastRestockDate: '2026-11-11', lastRestockStock: stock,
      dailyDose: 80, specPerBox
    }, new Date(2026, 10, 11));
    assert.ok(Number.isFinite(s.remainingPills) && Number.isFinite(s.remainingDays));
    assert.strictEqual(s.status, expected);
  });
});

summary('hardening.test.js');
