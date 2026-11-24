// 用药记录派生与导出（R10）：记录不要求用户录入——开始日期=首次添加日（createdAt），
// 停药日期=点"停药"当日（stoppedDate），由 Medicine 实时派生，不新增 storage 集合。
// 纯函数、不依赖 wx，Node 可测。规则见 docs/01-design/data/medicine-data-model.md 第 2 节。
const { formatDate } = require('./date');
const { dailyConsumptionOn } = require('./medicine');

const STOP_REASONS = ['停药', '换药', '疗程结束'];

// 派生用药记录：服用中在前；停药按停药日期新→旧；服用中按开始日期新→旧。
// id 透传（S4 记录页"重新启用"按钮定位药品用）。
// 缺字段兜底（S4 加固）：name 缺失回退"未知药品"、createdAt 缺失回退空串，导出不因异常数据崩溃。
function deriveMedicationRecords(medicines) {
  return (Array.isArray(medicines) ? medicines : [])
    .map(m => ({
      id: m.id,
      name: m.name || '未知药品',
      startDate: m.createdAt ? formatDate(m.createdAt) : '',
      endDate: m.archived ? (m.stoppedDate || '') : null, // null = 服用中（展示"至今"）
      reason: m.archived ? (m.stoppedReason || '停药') : '服用中',
      active: !m.archived
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1; // 在服在前
      if (a.active) return b.startDate.localeCompare(a.startDate); // 在服：新开始在前
      return (b.endDate || '').localeCompare(a.endDate || ''); // 停药：新停药在前
    });
}

// ---- 消耗流水（R05 派生，S4 自记录页上收 + R10 停药截断）----

// 单药单日推算消耗（v1 模型不动，仅外层包装停药语义）：
// 停药日当天起不再计耗——停药即退出当日服药（与 resume 以停药日推算剩余折算自洽）；
// 停药日之前照常推算；archived 但 stoppedDate 缺失（异常数据）不截断，保持 v1 行为。
function consumptionOn(m, date) {
  if (m.archived && m.stoppedDate && date >= m.stoppedDate) return 0;
  return dailyConsumptionOn(m, date);
}

// 日期网格 × 全部药品 → 消耗流水（只含消耗>0 的条目，日期新→旧）。
// 供记录页"消耗流水"段（v1 页面逻辑上收至 utils，符合"计算全在 utils"约定）。
// key 为列表渲染主键（审核修复 A5：date+name 组合，WXML wx:key 用属性名而非插值表达式）。
function deriveConsumptionFlow(medicines, dates) {
  const flow = [];
  (Array.isArray(dates) ? dates : []).forEach(date => {
    (Array.isArray(medicines) ? medicines : []).forEach(m => {
      const consumed = consumptionOn(m, date);
      if (consumed > 0) {
        flow.push({ key: `${date}|${m.name}`, date, name: m.name, consumed, dailyDose: m.dailyDose });
      }
    });
  });
  return flow.sort((a, b) => b.date.localeCompare(a.date));
}

function pad(text, width) {
  const s = String(text);
  return s + ' '.repeat(Math.max(2, width - s.length + 2));
}

// 一键复制用文本表格（wx.setClipboardData）：动态对齐，含表头。
// 宽度与补位统一字符串化（S4 加固）：异常数据缺字段不抛 TypeError。
function buildRecordText(records) {
  const head = ['药品', '开始', '停止', '原因'];
  const rows = (Array.isArray(records) ? records : []).map(r =>
    [r.name, r.startDate, r.endDate || '至今', r.reason].map(String)
  );
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map(row => row[i].length))
  );
  const line = cells => cells.map((c, i) => pad(c, widths[i])).join('').trimEnd();
  return [line(head), ...rows.map(line)].join('\n');
}

function csvCell(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// 分享 CSV（wx.shareFileMessage）：UTF-8 加 BOM 防 Excel 乱码。
function buildRecordCsv(records) {
  const lines = [
    ['药品', '开始', '停止', '原因'].join(','),
    ...records.map(r =>
      [r.name, r.startDate, r.endDate || '至今', r.reason].map(csvCell).join(',')
    )
  ];
  return '\uFEFF' + lines.join('\n');
}

// 消耗流水按药分组（2026-11-12 负责人反馈）：外层一行一种药（区间合计+服用天数），
// days 逐日明细（日期新→旧）。基于 deriveConsumptionFlow 派生（停药截断等语义自动继承）；
// 只含有消耗的药，按合计降序、并列按药名。适老考量：药多时长时不眼花缭乱。
function deriveConsumptionByMedicine(medicines, dates) {
  const flow = deriveConsumptionFlow(medicines, dates);
  const byName = {};
  flow.forEach(item => {
    if (!byName[item.name]) byName[item.name] = { name: item.name, totalConsumed: 0, days: [] };
    byName[item.name].totalConsumed = Math.round((byName[item.name].totalConsumed + item.consumed) * 100) / 100;
    byName[item.name].days.push({ date: item.date, consumed: item.consumed });
  });
  return Object.keys(byName)
    .map(k => byName[k])
    .sort((a, b) => (b.totalConsumed - a.totalConsumed) || (a.name < b.name ? -1 : 1));
}

// 用药记录按范围过滤（2026-11-12 负责人反馈：导出可选时间段；同日批准增自选区间 toDate）：
// fromDate 为 'YYYY-MM-DD' 或 null（null=全部历史）；toDate 为区间上界（缺省回落 today）。
// 保留与 [fromDate, toDate] 有交集的记录——开始日 ≤ 上界，且（服用中 或 停药日 ≥ fromDate）。
// 边界防御：异常记录缺日期时按"保留"处理（宁可多导出不静默丢行，与 F4 容错口径一致）。
function filterMedicationRecords(records, fromDate, today, toDate) {
  const list = Array.isArray(records) ? records : [];
  if (!fromDate) return list;
  const endBound = toDate || today || null; // 上界：自选区间的结束日，缺省=今天
  return list.filter(r => {
    const start = typeof r.startDate === 'string' ? r.startDate : '';
    const end = r.endDate == null ? null : String(r.endDate);
    if (endBound && start && start > endBound) return false; // 区间结束后才开始（含未来异常）剔除
    if (end === null) return true;                          // 服用中（开始 ≤ 上界即与区间有交集）
    if (!end) return true;                                  // 缺结束日期（异常）→ 保留
    return end >= fromDate;                                 // 停药日落在区间内（含上界之后仍停）
  });
}

module.exports = {
  STOP_REASONS,
  deriveMedicationRecords,
  deriveConsumptionFlow,
  deriveConsumptionByMedicine,
  filterMedicationRecords,
  buildRecordText,
  buildRecordCsv
};
