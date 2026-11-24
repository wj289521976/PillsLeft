// schedule.js 单测（R07 验收）：
// ① 14 种样例药 usageTime 解析全表（fixture 与原出厂数据同源，2026-11-12 起仅测试保留）
//    且每药时段剂量之和 = dailyDose（迁移后 dailyDose 不变的自洽性）
// ② 扩展形态：睡前/睡、全半角括号、无括号分数、空白、乱序、重复时段
// ③ 失败分支：任意不匹配 → []（空串/非法文本/无剂量/零剂量/零分母/非字符串）
const assert = require('assert');
const { test, summary } = require('../helper');
const { parseUsageTime, deriveTodaySchedule } = require('../../src/utils/schedule');
const { v2Medicines } = require('../fixtures/medicines');

function slots(list) {
  return list.map((x) => `${x.slot}:${x.dose}`).join(',');
}

// ① 14 种默认药全表（期望值按 id 逐药核对）
const DEFAULT_EXPECTED = {
  med_001: 'evening:1',                    // 晚1
  med_002: 'evening:1',                    // 晚1
  med_003: 'morning:1',                    // 早1
  med_004: 'morning:0.25',                 // 早（1/4）
  med_005: 'morning:4,evening:4',          // 早4晚4
  med_006: 'morning:3,evening:3',          // 早3晚3
  med_007: 'noon:1',                       // 中1
  med_008: 'morning:1,noon:1,evening:1',   // 早1中1晚1
  med_009: 'morning:0.5,evening:0.5',      // 早½晚½
  med_010: 'morning:1,evening:1',          // 早1晚1
  med_011: 'morning:1,noon:1,evening:1',   // 早1中1晚1
  med_012: 'morning:1,evening:1',          // 早1晚1
  med_013: 'morning:1,noon:1,evening:1',   // 早1中1晚1
  med_014: 'morning:1,noon:1,evening:1'    // 早1中1晚1
};

const defaults = v2Medicines();
test('默认药共 14 种（数据源完整性）', () => {
  assert.strictEqual(defaults.length, 14);
});

for (const m of defaults) {
  test(`默认药解析：${m.name}（${m.usageTime}）`, () => {
    const parsed = parseUsageTime(m.usageTime);
    assert.strictEqual(slots(parsed), DEFAULT_EXPECTED[m.id], `id=${m.id}`);
  });
  test(`剂量自洽：${m.name} 时段和 = dailyDose（${m.dailyDose}）`, () => {
    const sum = parseUsageTime(m.usageTime).reduce((acc, x) => acc + x.dose, 0);
    assert.strictEqual(Math.round(sum * 10000) / 10000, m.dailyDose, `id=${m.id}`);
  });
}

// ② 扩展形态
test('睡前1 → bedtime:1', () => {
  assert.strictEqual(slots(parseUsageTime('睡前1')), 'bedtime:1');
});

test('睡1 → bedtime:1（"睡"单字等价睡前）', () => {
  assert.strictEqual(slots(parseUsageTime('睡1')), 'bedtime:1');
});

test('早(1/4) 半角括号 → morning:0.25', () => {
  assert.strictEqual(slots(parseUsageTime('早(1/4)')), 'morning:0.25');
});

test('早1/2 无括号分数 → morning:0.5', () => {
  assert.strictEqual(slots(parseUsageTime('早1/2')), 'morning:0.5');
});

test('早1.5 小数剂量 → morning:1.5', () => {
  assert.strictEqual(slots(parseUsageTime('早1.5')), 'morning:1.5');
});

test('早1/3 分数四舍五入到 4 位 → morning:0.3333', () => {
  assert.strictEqual(slots(parseUsageTime('早1/3')), 'morning:0.3333');
});

test('空白容忍：" 早1 中1 晚1 "', () => {
  assert.strictEqual(slots(parseUsageTime(' 早1 中1 晚1 ')), 'morning:1,noon:1,evening:1');
});

test('输出按时段固定排序（输入乱序 晚1早1 → 早在前）', () => {
  assert.strictEqual(slots(parseUsageTime('晚1早1')), 'morning:1,evening:1');
});

test('同时段重复以后值覆盖："早1早2" → morning:2', () => {
  assert.strictEqual(slots(parseUsageTime('早1早2')), 'morning:2');
});

// ③ 失败分支：一律 []
for (const bad of ['', '饭前吃', '每天两次', '早', '早x1', '早0', '早1/0', '早晚各1', '2早1']) {
  test(`解析失败返回 []："${bad || '(空串)'}"`, () => {
    assert.deepStrictEqual(parseUsageTime(bad), []);
  });
}

test('非字符串输入（null/undefined/数字）返回 []', () => {
  assert.deepStrictEqual(parseUsageTime(null), []);
  assert.deepStrictEqual(parseUsageTime(undefined), []);
  assert.deepStrictEqual(parseUsageTime(123), []);
});

// ④ deriveTodaySchedule（R08 今日时刻表）
// 默认药先经真实解析器补 timeSlots（与 migrateToV2 后的运行时数据一致）；
// now 固定为 2026-04-11（多数药 04-10 补货次日），状态推算确定可复现。
const withSlots = (list) => list.map((m) => ({ ...m, timeSlots: parseUsageTime(m.usageTime) }));
const at = (h, m, y = 2026, mo = 3, d = 11) => new Date(y, mo, d, h, m); // mo=3 → 4 月
const find = (groups, slot, id) => groups.find((g) => g.slot === slot).items.find((x) => x.id === id);

test('14 默认药分组：早11/中5/晚11/睡前0，无未排程；组字段（time/label/顺序）正确', () => {
  const { groups, unscheduled } = deriveTodaySchedule(withSlots(v2Medicines()), at(8, 0));
  assert.deepStrictEqual(groups.map((g) => g.slot), ['morning', 'noon', 'evening', 'bedtime']);
  assert.deepStrictEqual(
    groups.map((g) => `${g.time} ${g.label} ${g.items.length}`),
    ['07:00 早上 11', '12:00 中午 5', '18:00 晚上 11', '22:00 睡前 0']
  );
  assert.strictEqual(unscheduled.length, 0);
});

test('08:00 → 当前时段 morning，仅该组 current=true', () => {
  const { groups, currentSlot } = deriveTodaySchedule(withSlots(v2Medicines()), at(8, 0));
  assert.strictEqual(currentSlot, 'morning');
  assert.deepStrictEqual(groups.map((g) => g.current), [true, false, false, false]);
});

test('条目字段：dose 取时段剂量、status 为实时推算（med_004 预警 / med_009 半粒）', () => {
  const { groups } = deriveTodaySchedule(withSlots(v2Medicines()), at(8, 0));
  const m004 = find(groups, 'morning', 'med_004');
  assert.strictEqual(m004.dose, 0.25);
  assert.strictEqual(m004.status, 'warning'); // 1 粒 - 1 天×0.25 → 剩 3 天
  assert.strictEqual(m004.name, '示例药品04');
  assert.strictEqual(find(groups, 'evening', 'med_009').dose, 0.5);
});

test('archived 停药药排除：med_001 停药后晚上组 11→10，不出现在任何组', () => {
  const list = withSlots(v2Medicines());
  list[0].archived = true;
  const { groups, unscheduled } = deriveTodaySchedule(list, at(8, 0));
  assert.strictEqual(groups.find((g) => g.slot === 'evening').items.length, 10);
  assert.strictEqual(unscheduled.length, 0);
  groups.forEach((g) => assert.strictEqual(find(groups, g.slot, 'med_001'), undefined));
});

test('timeSlots 缺失/为空 → 归"未排程"，带 usageTime 原文与 status', () => {
  const list = [
    { id: 'med_x1', name: '饭后药', usageTime: '饭后吃', dailyDose: 2, specPerBox: 10,
      lastRestockDate: '2026-04-10', lastRestockStock: 100 }
  ];
  const { groups, unscheduled } = deriveTodaySchedule(list, at(8, 0));
  assert.deepStrictEqual(unscheduled, [{ id: 'med_x1', name: '饭后药', usageTime: '饭后吃', status: 'sufficient' }]);
  groups.forEach((g) => assert.strictEqual(g.items.length, 0));
});

test('条目级容错：未知时段/非正剂量条目被忽略，有效条目仍归组', () => {
  const list = [
    { id: 'med_x2', name: '混合', usageTime: '', timeSlots: [{ slot: 'dawn', dose: 1 }, { slot: 'noon', dose: 0 }, { slot: 'noon', dose: 2 }],
      dailyDose: 2, specPerBox: 10, lastRestockDate: '2026-04-10', lastRestockStock: 100 }
  ];
  const { groups, unscheduled } = deriveTodaySchedule(list, at(8, 0));
  assert.strictEqual(groups.find((g) => g.slot === 'noon').items.length, 1);
  assert.strictEqual(unscheduled.length, 0);
});

test('条目全部无效 → 整药归"未排程"（药不消失）', () => {
  const list = [
    { id: 'med_x3', name: '全无效', usageTime: '遵医嘱', timeSlots: [{ slot: 'dawn', dose: 1 }],
      dailyDose: 1, specPerBox: 10, lastRestockDate: '2026-04-10', lastRestockStock: 100 }
  ];
  const { unscheduled } = deriveTodaySchedule(list, at(8, 0));
  assert.strictEqual(unscheduled.length, 1);
  assert.strictEqual(unscheduled[0].usageTime, '遵医嘱');
});

// 当前时段边界（默认时刻 07/12/18/22）：current = 最后一个 time ≤ now；首时段前无当前、末时段到午夜
for (const [h, m, expect] of [
  [6, 59, null], [7, 0, 'morning'], [11, 59, 'morning'], [12, 0, 'noon'],
  [17, 59, 'noon'], [18, 0, 'evening'], [21, 59, 'evening'],
  [22, 0, 'bedtime'], [23, 59, 'bedtime']
]) {
  test(`边界 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} → current=${expect}`, () => {
    const { currentSlot } = deriveTodaySchedule(withSlots(v2Medicines()), at(h, m));
    assert.strictEqual(currentSlot, expect);
  });
}

test('settings.slotTimes 覆盖默认时刻：morning 06:30 → 06:45 时已是当前时段', () => {
  const settings = { slotTimes: { morning: '06:30' }, reminderOn: false };
  const { groups, currentSlot } = deriveTodaySchedule(withSlots(v2Medicines()), at(6, 45), settings);
  assert.strictEqual(groups[0].time, '06:30');
  assert.deepStrictEqual(groups.slice(1).map((g) => g.time), ['12:00', '18:00', '22:00']);
  assert.strictEqual(currentSlot, 'morning');
});

test('reminderOn 不参与分组派生（提示条开关由页面消费）', () => {
  const a = deriveTodaySchedule(withSlots(v2Medicines()), at(8, 0), { reminderOn: true });
  const b = deriveTodaySchedule(withSlots(v2Medicines()), at(8, 0), { reminderOn: false });
  assert.deepStrictEqual(a.groups, b.groups);
  assert.strictEqual(a.currentSlot, b.currentSlot);
});

test('断药状态传递：2026-05-20 时 med_004 条目 status=out', () => {
  const { groups } = deriveTodaySchedule(withSlots(v2Medicines()), at(8, 0, 2026, 4, 20));
  assert.strictEqual(find(groups, 'morning', 'med_004').status, 'out'); // 1 粒 - 40 天×0.25 → 断药
  assert.strictEqual(find(groups, 'evening', 'med_001').status, 'sufficient'); // 48-40=8 天 → 充足（R01 口径）
});

test('防御：medicines 非数组 → 4 个空组；列表含 null 元素不抛错', () => {
  const r = deriveTodaySchedule('bad', at(8, 0));
  assert.strictEqual(r.groups.length, 4);
  r.groups.forEach((g) => assert.strictEqual(g.items.length, 0));
  assert.strictEqual(r.unscheduled.length, 0);
  const r2 = deriveTodaySchedule([null, undefined], at(8, 0));
  assert.strictEqual(r2.groups.reduce((n, g) => n + g.items.length, 0), 0);
});

test('now 缺省（当前时刻）与时间戳入参均不抛错，结构完整', () => {
  const r = deriveTodaySchedule(withSlots(v2Medicines()));
  assert.strictEqual(r.groups.length, 4);
  const r2 = deriveTodaySchedule(withSlots(v2Medicines()), Date.now());
  assert.ok(r2.currentSlot === null || typeof r2.currentSlot === 'string');
});

// ⑤ buildUsageTime / formatDose（R11 三问式，S3）
const { buildUsageTime, formatDose } = require('../../src/utils/schedule');

test('buildUsageTime 基础：整数剂量直写、按固定顺序拼接', () => {
  assert.strictEqual(
    buildUsageTime([{ slot: 'morning', dose: 1 }, { slot: 'noon', dose: 1 }, { slot: 'evening', dose: 1 }]),
    '早1中1晚1'
  );
  assert.strictEqual(buildUsageTime([{ slot: 'bedtime', dose: 1 }]), '睡前1');
});

test('buildUsageTime 特殊剂量：0.25→（1/4）、0.5→½、其余小数原样', () => {
  assert.strictEqual(buildUsageTime([{ slot: 'morning', dose: 0.25 }]), '早（1/4）');
  assert.strictEqual(buildUsageTime([{ slot: 'morning', dose: 0.5 }, { slot: 'evening', dose: 0.5 }]), '早½晚½');
  assert.strictEqual(buildUsageTime([{ slot: 'morning', dose: 1.5 }]), '早1.5');
  assert.strictEqual(buildUsageTime([{ slot: 'morning', dose: 4 }, { slot: 'evening', dose: 4 }]), '早4晚4');
});

test('buildUsageTime 乱序输入 → 固定顺序输出', () => {
  assert.strictEqual(
    buildUsageTime([{ slot: 'evening', dose: 1 }, { slot: 'morning', dose: 2 }]),
    '早2晚1'
  );
});

test('buildUsageTime 无效输入：非数组/空/全无效条目 → 空串；未知时段与非正剂量忽略', () => {
  assert.strictEqual(buildUsageTime(null), '');
  assert.strictEqual(buildUsageTime([]), '');
  assert.strictEqual(buildUsageTime([{ slot: 'dawn', dose: 1 }]), '');
  assert.strictEqual(
    buildUsageTime([{ slot: 'dawn', dose: 1 }, { slot: 'noon', dose: 0 }, { slot: 'noon', dose: 2 }]),
    '中2'
  );
});

test('roundtrip：parseUsageTime(buildUsageTime(x)) === x（覆盖 stepper 0.5 步进与键入值）', () => {
  const cases = [
    [{ slot: 'morning', dose: 0.5 }],
    [{ slot: 'morning', dose: 1 }],
    [{ slot: 'morning', dose: 1.5 }, { slot: 'evening', dose: 2 }],
    [{ slot: 'bedtime', dose: 3 }],
    [{ slot: 'morning', dose: 0.25 }, { slot: 'noon', dose: 0.5 }, { slot: 'evening', dose: 1 }, { slot: 'bedtime', dose: 0.75 }]
  ];
  for (const slots of cases) {
    const back = parseUsageTime(buildUsageTime(slots));
    assert.deepStrictEqual(back, slots, `build="${buildUsageTime(slots)}"`);
  }
});

test('roundtrip 全表：14 种默认药 buildUsageTime(parse(usageTime)) === 原文', () => {
  for (const m of v2Medicines()) {
    const parsed = parseUsageTime(m.usageTime);
    assert.notStrictEqual(parsed.length, 0, `${m.id} 应可解析`);
    assert.strictEqual(buildUsageTime(parsed), m.usageTime, `id=${m.id}`);
  }
});

test('formatDose：0.5→半粒、0.25→¼粒、整数与小数直写', () => {
  assert.strictEqual(formatDose(0.5), '半粒');
  assert.strictEqual(formatDose(0.25), '¼粒');
  assert.strictEqual(formatDose(1), '1 粒');
  assert.strictEqual(formatDose(1.5), '1.5 粒');
});

// ---- S5 独立审核回归（2026-11-11）----

test('乱序时刻配置：currentSlot=已开始时段中时间最晚者（审核修复 F-01）', () => {
  const meds = [{ id: 'm1', name: 'A', timeSlots: [{ slot: 'morning', dose: 1 }], dailyDose: 1,
    lastRestockDate: '2026-11-11', lastRestockStock: 30 }];
  const s = { slotTimes: { morning: '13:00', noon: '12:00', evening: '18:00', bedtime: '22:00' }, reminderOn: true };
  // 11:00 无任何时段开始 → null；12:30 仅 noon 开始；13:30 早(13:00)与中(12:00)均已开始、取最晚=morning
  assert.strictEqual(deriveTodaySchedule(meds, new Date(2026, 10, 11, 11, 0), s).currentSlot, null);
  assert.strictEqual(deriveTodaySchedule(meds, new Date(2026, 10, 11, 12, 30), s).currentSlot, 'noon');
  assert.strictEqual(deriveTodaySchedule(meds, new Date(2026, 10, 11, 13, 30), s).currentSlot, 'morning');
  // 19:00 三个已开始（12/13/18），取最晚=evening
  assert.strictEqual(deriveTodaySchedule(meds, new Date(2026, 10, 11, 19, 0), s).currentSlot, 'evening');
});

test('时刻并列时 currentSlot 取 SLOT_ORDER 靠前者（F-01 边界）', () => {
  const meds = [];
  const s = { slotTimes: { morning: '12:00', noon: '12:00', evening: '18:00', bedtime: '22:00' }, reminderOn: true };
  assert.strictEqual(deriveTodaySchedule(meds, new Date(2026, 10, 11, 12, 30), s).currentSlot, 'morning');
});

test('now=0（epoch 时间戳）按有效时间处理，不再当缺省回退当前（审核修复 F-08）', () => {
  const r = deriveTodaySchedule([], 0); // 1970-01-01 本地 08:00（UTC+8）→ 早组已开始
  assert.strictEqual(r.currentSlot, 'morning');
});

summary('schedule.test.js');
