// storage.loadSettings 单测（R08/R09 设置读取）：wx 以内存 mock 替代（仿 migration.test.js）。
// 约定：settings 键缺省/字段缺失逐项回退默认；仅认四个已知时段键；reminderOn 只有显式 false 才关闭。
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

const EXPECT_DEFAULT = {
  slotTimes: { morning: '07:00', noon: '12:00', evening: '18:00', bedtime: '22:00' },
  reminderOn: true
};

test('settings 键不存在（getStorageSync 返回 \'\'）→ 完整默认', () => {
  mockWx({});
  const { loadSettings, DEFAULT_SETTINGS } = require('../../src/utils/storage');
  assert.deepStrictEqual(loadSettings(), EXPECT_DEFAULT);
  assert.deepStrictEqual(DEFAULT_SETTINGS, EXPECT_DEFAULT); // 导出的默认值即文档口径（数据模型 §3）
});

test('部分覆盖：仅存 morning 06:00 → 其余时段回退默认，reminderOn 默认开', () => {
  mockWx({ settings: { slotTimes: { morning: '06:00' } } });
  const { loadSettings } = require('../../src/utils/storage');
  assert.deepStrictEqual(loadSettings(), {
    slotTimes: { morning: '06:00', noon: '12:00', evening: '18:00', bedtime: '22:00' },
    reminderOn: true
  });
});

test('reminderOn：显式 false 才关闭；显式 true 保持开', () => {
  mockWx({ settings: { reminderOn: false } });
  const { loadSettings } = require('../../src/utils/storage');
  assert.strictEqual(loadSettings().reminderOn, false);

  mockWx({ settings: { reminderOn: true } });
  assert.strictEqual(loadSettings().reminderOn, true);
});

test('未知时段键（如 dawn）被忽略，不进入结果', () => {
  mockWx({ settings: { slotTimes: { dawn: '05:00', noon: '13:00' } } });
  const { loadSettings } = require('../../src/utils/storage');
  const s = loadSettings();
  assert.deepStrictEqual(Object.keys(s.slotTimes).sort(), ['bedtime', 'evening', 'morning', 'noon']);
  assert.strictEqual(s.slotTimes.noon, '13:00');
  assert.strictEqual(s.slotTimes.morning, '07:00');
});

test('settings 为空对象/空字符串 → 完整默认（不抛错）', () => {
  mockWx({ settings: '' });
  const { loadSettings } = require('../../src/utils/storage');
  assert.deepStrictEqual(loadSettings(), EXPECT_DEFAULT);
});

// ---- saveSettings（S5：settings 键首个写入方，严格校验后落库）----

test('saveSettings 合法全量：落库且 loadSettings 读回一致（roundtrip）', () => {
  const store = mockWx({});
  const storage = require('../../src/utils/storage');
  const saved = storage.saveSettings({
    slotTimes: { morning: '06:30', noon: '12:30', evening: '18:30', bedtime: '22:30' },
    reminderOn: false
  });
  assert.deepStrictEqual(saved, {
    slotTimes: { morning: '06:30', noon: '12:30', evening: '18:30', bedtime: '22:30' },
    reminderOn: false
  });
  assert.deepStrictEqual(store.settings, saved); // 落库即归一化结果
  assert.deepStrictEqual(storage.loadSettings(), saved);
});

test('saveSettings 非法时刻逐键回退默认（25:00/abc/数字/空），合法键保留', () => {
  const store = mockWx({});
  const storage = require('../../src/utils/storage');
  const saved = storage.saveSettings({
    slotTimes: { morning: '25:00', noon: '08:00', evening: 7, bedtime: '' },
    reminderOn: true
  });
  assert.strictEqual(saved.slotTimes.morning, '07:00'); // 越界回退
  assert.strictEqual(saved.slotTimes.noon, '08:00'); // 合法保留
  assert.strictEqual(saved.slotTimes.evening, '18:00'); // 非字符串回退
  assert.strictEqual(saved.slotTimes.bedtime, '22:00'); // 空串回退
  assert.deepStrictEqual(store.settings, saved);
});

test('saveSettings 边界时刻 00:00 与 23:59 合法；reminderOn 缺省=开', () => {
  mockWx({});
  const storage = require('../../src/utils/storage');
  const saved = storage.saveSettings({ slotTimes: { morning: '00:00', noon: '23:59' } });
  assert.strictEqual(saved.slotTimes.morning, '00:00');
  assert.strictEqual(saved.slotTimes.noon, '23:59');
  assert.strictEqual(saved.reminderOn, true);
});

test('saveSettings 空入参 → 写入完整默认（防脏数据落库的回退语义）', () => {
  const store = mockWx({});
  const storage = require('../../src/utils/storage');
  const saved = storage.saveSettings(null);
  assert.deepStrictEqual(saved, EXPECT_DEFAULT);
  assert.deepStrictEqual(store.settings, EXPECT_DEFAULT);
});

// ---- S5 独立审核回归（2026-11-11，修复 F-02）----

test('normalizeSettings 值级校验：畸形时刻（99:99/数字/坏串）读回一律回退默认，不再穿透落库', () => {
  mockWx({ settings: { slotTimes: { morning: '99:99', noon: 7, evening: '8点' }, reminderOn: true } });
  const { loadSettings } = require('../../src/utils/storage');
  const s = loadSettings();
  assert.deepStrictEqual(s.slotTimes, EXPECT_DEFAULT.slotTimes); // 三个畸形值全部逐键回退
  assert.strictEqual(s.reminderOn, true);
});

test('合法值不受值级校验影响（06:00/00:00/23:59 边界保持透传）', () => {
  mockWx({ settings: { slotTimes: { morning: '00:00', noon: '06:00', bedtime: '23:59' } } });
  const { loadSettings } = require('../../src/utils/storage');
  const s = loadSettings();
  assert.strictEqual(s.slotTimes.morning, '00:00');
  assert.strictEqual(s.slotTimes.noon, '06:00');
  assert.strictEqual(s.slotTimes.bedtime, '23:59');
  assert.strictEqual(s.slotTimes.evening, '18:00');
});

summary('settings.test.js');
