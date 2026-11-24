// 14 种虚构药品样例（v1 结构，仅测试用，不进小程序包）。药名「示例药品NN」为占位，不对应任何真实用药；
// 时段写法/剂量/规格/库存字段用于覆盖解析、迁移、备份、推算各类用例（早1中1晚1、早4晚4、早（1/4）、早½晚½ 等）。
// rawMedicines() = v1 形态（无 timeSlots）；v2Medicines() = 迁移后形态（timeSlots=解析结果，与迁移同源）。
const { parseUsageTime } = require('../../src/utils/schedule');

const RAW = [
  { id: 'med_001', name: '示例药品01', usageTime: '晚1', specPerBox: 30, dailyDose: 1, lastRestockDate: '2026-04-10', lastRestockStock: 48, createdAt: 1, updatedAt: 1 },
  { id: 'med_002', name: '示例药品02', usageTime: '晚1', specPerBox: 10, dailyDose: 1, lastRestockDate: '2026-04-16', lastRestockStock: 60, createdAt: 1, updatedAt: 1 },
  { id: 'med_003', name: '示例药品03', usageTime: '早1', specPerBox: 28, dailyDose: 1, lastRestockDate: '2026-03-14', lastRestockStock: 30, createdAt: 1, updatedAt: 1 },
  { id: 'med_004', name: '示例药品04', usageTime: '早（1/4）', specPerBox: 24, dailyDose: 0.25, lastRestockDate: '2026-04-10', lastRestockStock: 1, createdAt: 1, updatedAt: 1 },
  { id: 'med_005', name: '示例药品05', usageTime: '早4晚4', specPerBox: 12, dailyDose: 8, lastRestockDate: '2026-04-10', lastRestockStock: 96, createdAt: 1, updatedAt: 1 },
  { id: 'med_006', name: '示例药品06', usageTime: '早3晚3', specPerBox: 60, dailyDose: 6, lastRestockDate: '2026-04-10', lastRestockStock: 180, createdAt: 1, updatedAt: 1 },
  { id: 'med_007', name: '示例药品07', usageTime: '中1', specPerBox: 100, dailyDose: 1, lastRestockDate: '2026-04-10', lastRestockStock: 100, createdAt: 1, updatedAt: 1 },
  { id: 'med_008', name: '示例药品08', usageTime: '早1中1晚1', specPerBox: 20, dailyDose: 3, lastRestockDate: '2026-04-10', lastRestockStock: 60, createdAt: 1, updatedAt: 1 },
  { id: 'med_009', name: '示例药品09', usageTime: '早½晚½', specPerBox: 60, dailyDose: 1, lastRestockDate: '2026-04-10', lastRestockStock: 60, createdAt: 1, updatedAt: 1 },
  { id: 'med_010', name: '示例药品10', usageTime: '早1晚1', specPerBox: 50, dailyDose: 2, lastRestockDate: '2026-04-10', lastRestockStock: 100, createdAt: 1, updatedAt: 1 },
  { id: 'med_011', name: '示例药品11', usageTime: '早1中1晚1', specPerBox: 40, dailyDose: 3, lastRestockDate: '2026-04-10', lastRestockStock: 120, createdAt: 1, updatedAt: 1 },
  { id: 'med_012', name: '示例药品12', usageTime: '早1晚1', specPerBox: 24, dailyDose: 2, lastRestockDate: '2026-04-10', lastRestockStock: 72, createdAt: 1, updatedAt: 1 },
  { id: 'med_013', name: '示例药品13', usageTime: '早1中1晚1', specPerBox: 100, dailyDose: 3, lastRestockDate: '2026-04-10', lastRestockStock: 100, createdAt: 1, updatedAt: 1 },
  { id: 'med_014', name: '示例药品14', usageTime: '早1中1晚1', specPerBox: 50, dailyDose: 3, lastRestockDate: '2026-04-10', lastRestockStock: 100, createdAt: 1, updatedAt: 1 }
];

function rawMedicines() {
  return JSON.parse(JSON.stringify(RAW));
}

function v2Medicines() {
  return rawMedicines().map(m => ({ ...m, timeSlots: parseUsageTime(m.usageTime) }));
}

module.exports = { rawMedicines, v2Medicines };
