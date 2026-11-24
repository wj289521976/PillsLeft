const { formatDate, parseDate } = require('./date');
const { parseUsageTime } = require('./schedule');
const { deriveMedicineStatus } = require('./medicine');

function loadMedicines() {
  // 防御性读取（S4 加固；S5 审核修复 F-06 加严）：storage 值损坏（非数组）返回空表；
  // 数组内非对象元素（null/字符串等，外部写入或迁移中断残留）就地剔除，
  // 保证各消费方（页面 .filter / utils 派生）不抛 TypeError。不改动锚点/派生架构。
  const v = wx.getStorageSync('medicines');
  if (!Array.isArray(v)) return [];
  return v.filter((m) => m && typeof m === 'object');
}

function saveMedicines(list) {
  wx.setStorageSync('medicines', list);
}

function addMedicine(data) {
  const list = loadMedicines();
  const now = Date.now();
  const newMed = {
    id: 'med_' + now + '_' + Math.floor(Math.random() * 10000),
    ...data,
    createdAt: now,
    updatedAt: now
  };
  list.push(newMed);
  saveMedicines(list);
  return newMed;
}

function updateMedicine(id, patch) {
  const list = loadMedicines();
  const idx = list.findIndex(m => m.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  saveMedicines(list);
  return list[idx];
}

function deleteMedicine(id) {
  const list = loadMedicines();
  const filtered = list.filter(m => m.id !== id);
  saveMedicines(filtered);
}

function getMedicineById(id) {
  const list = loadMedicines();
  return list.find(m => m.id === id) || null;
}

// ---- v2 数据地基（R07/R10，规则见 docs/01-design/data/medicine-data-model.md）----

// schema v1 → v2 幂等迁移：只补 timeSlots 不改库存数字、不删旧字段；已存在则跳过。
// 返回 true=执行了迁移，false=无需迁移（版本已是 2）。
function migrateToV2() {
  const v = wx.getStorageSync('schemaVersion') || 1;
  if (v >= 2) return false;

  const list = loadMedicines();
  list.forEach(m => {
    if (!m || typeof m !== 'object') return; // 审核修复 F-06：非对象元素防御（loadMedicines 已过滤，双保险）
    if (!Array.isArray(m.timeSlots)) {
      m.timeSlots = parseUsageTime(m.usageTime); // 解析失败得 []，保留原文由页面降级展示
    }
  });
  saveMedicines(list);
  wx.setStorageSync('schemaVersion', 2);
  return true;
}

// 停药（R10）：冻结推算、退出列表，记录停药日与原因；推算基准不动（恢复时按停药日折算）。
function stopMedicine(id, reason) {
  const m = getMedicineById(id);
  if (!m || m.archived) return null;
  return updateMedicine(id, {
    archived: true,
    stoppedDate: formatDate(new Date()),
    stoppedReason: reason || '停药'
  });
}

// 重新启用（R10）：以停药日的推算剩余作为今天的基准，恢复后推算继续。
function resumeMedicine(id) {
  const m = getMedicineById(id);
  if (!m || !m.archived) return null;
  const stopDay = m.stoppedDate ? parseDate(m.stoppedDate) : new Date();
  const frozen = deriveMedicineStatus(m, stopDay);
  return updateMedicine(id, {
    archived: false,
    lastRestockDate: formatDate(new Date()),
    lastRestockStock: Math.max(0, frozen.remainingPills)
  });
}

// ---- v2 设置（R08/R09）：时段默认时刻 + 待服提示条开关（storage 键 settings）----

const DEFAULT_SETTINGS = {
  slotTimes: { morning: '07:00', noon: '12:00', evening: '18:00', bedtime: '22:00' },
  reminderOn: true
};

// 时刻合法性（HH:MM，00-23:00-59）。归一化与保存共用，保证"经任一写入路径落库的数据
// 读回永远自洽"（S5 审核修复 F-02：原 normalizeSettings 仅 falsy 回退，备份导入的
// 畸形时刻如 '99:99'/数字 会永久穿透落库）。
function isValidSlotTime(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

// 归一化任意来源的 settings 对象（纯函数）：仅认四个已知时段键（未知键忽略），
// 值须通过 isValidSlotTime，非法回退默认；reminderOn 只有显式 false 才视为关闭。
// loadSettings 与备份导入共用。
function normalizeSettings(saved) {
  const s = saved || {};
  const savedTimes = s.slotTimes || {};
  const slotTimes = {};
  Object.keys(DEFAULT_SETTINGS.slotTimes).forEach((k) => {
    slotTimes[k] = isValidSlotTime(savedTimes[k]) ? savedTimes[k] : DEFAULT_SETTINGS.slotTimes[k];
  });
  return { slotTimes, reminderOn: s.reminderOn !== false };
}

// 读取设置并逐项回退默认（S2 起只读口径不变）。
function loadSettings() {
  return normalizeSettings(wx.getStorageSync('settings'));
}

// 保存设置（S5：settings 键首个写入方）。写入前严格校验：时刻须为 HH:MM（00-23:00-59），
// 非法值回退默认——保证经本函数写入的数据 loadSettings 读回永远自洽。返回归一化结果。
function saveSettings(settings) {
  const s = settings || {};
  const inputTimes = s.slotTimes || {};
  const slotTimes = {};
  Object.keys(DEFAULT_SETTINGS.slotTimes).forEach((k) => {
    slotTimes[k] = isValidSlotTime(inputTimes[k]) ? inputTimes[k] : DEFAULT_SETTINGS.slotTimes[k];
  });
  const normalized = { slotTimes, reminderOn: s.reminderOn !== false };
  wx.setStorageSync('settings', normalized);
  return normalized;
}

// ---- 应用内全量备份/恢复（F5，S5）：medicines + settings 两业务键快照 ----

// 备份文件标识：导入时校验来源，防误导入任意 JSON 覆盖数据。
const BACKUP_APP_ID = 'wj-medicine-box';

// 生成备份载荷（纯函数）：页面负责取数传入，exportedAt 可注入以便测试确定性。
function buildBackupPayload(medicines, settings, schemaVersion, exportedAt) {
  return {
    app: BACKUP_APP_ID,
    exportedAt: exportedAt || new Date().toISOString(),
    schemaVersion: schemaVersion || 2,
    medicines: medicines,
    settings: settings
  };
}

// 校验备份载荷（纯函数）：损坏输入不抛错，返回 { ok:false, error } 由页面 toast。
// 通过返回 { ok:true, medicines, settings, dropped, exportedAt }——
// medicines 逐条校验，无效条目剔除并计数（F4 同款防御哲学）。字段级校验（S5 审核修复
// F-03：原仅查 name，缺 lastRestockDate 的条目恢复后 deriveMedicineStatus → parseDate
// (undefined) 抛 TypeError 致今日页整页崩溃；dailyDose 非法则推算 NaN 假"充足"）：
// name 非空字符串 ｜ dailyDose 有限数>0 ｜ specPerBox 有限数>0 ｜ lastRestockDate 为
// YYYY-MM-DD 字符串 ｜ lastRestockStock 有限数。timeSlots 若存在非数组由消费方防御（既有）。
const BACKUP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseBackupPayload(raw) {
  const fail = (error) => ({ ok: false, error });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('备份内容不是有效对象');
  if (raw.app !== BACKUP_APP_ID) return fail('不是清点助手的备份文件');
  if (!Array.isArray(raw.medicines)) return fail('备份中缺少药品数据');
  const medicines = raw.medicines.filter((m) => (
    m && typeof m === 'object' && !Array.isArray(m)
    && typeof m.name === 'string' && m.name
    && Number.isFinite(m.dailyDose) && m.dailyDose > 0
    && Number.isFinite(m.specPerBox) && m.specPerBox > 0
    && typeof m.lastRestockDate === 'string' && BACKUP_DATE_RE.test(m.lastRestockDate)
    && Number.isFinite(m.lastRestockStock)
  ));
  if (medicines.length === 0) return fail('备份中没有有效药品');
  return {
    ok: true,
    medicines,
    dropped: raw.medicines.length - medicines.length,
    settings: raw.settings ? normalizeSettings(raw.settings) : null,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : ''
  };
}

// 恢复备份（F5，覆盖性危险操作——页面必须先 Modal 二次确认）：
// 写回 medicines/settings（如有）；schemaVersion 置 1 后走幂等迁移统一补齐 timeSlots 升到 2
// （v2 备份迁移无副作用，v1 备份借此补 timeSlots）。返回恢复药品条数。
function applyBackup(parsed) {
  saveMedicines(parsed.medicines);
  if (parsed.settings) wx.setStorageSync('settings', parsed.settings);
  wx.setStorageSync('schemaVersion', 1);
  migrateToV2();
  return parsed.medicines.length;
}

module.exports = {
  loadMedicines,
  saveMedicines,
  addMedicine,
  updateMedicine,
  deleteMedicine,
  getMedicineById,
  migrateToV2,
  stopMedicine,
  resumeMedicine,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  BACKUP_APP_ID,
  buildBackupPayload,
  parseBackupPayload,
  applyBackup
};