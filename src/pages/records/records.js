// 记录页 v2 两段式（R10，S4）：①消耗流水（按药折叠分组——2026-11-12 负责人反馈改造，
//   计算上收 utils deriveConsumptionByMedicine，停药截断语义继承；今日行标注「今日·预计」）
// ②用药记录（后台沉淀，Medicine 直接派生，不要求录入）+ 导出双通道（可选时间段：全部/最近7天/最近30天）
//   + 重新启用。
const { loadMedicines, resumeMedicine } = require('../../utils/storage');
const {
  deriveConsumptionByMedicine,
  deriveMedicationRecords,
  filterMedicationRecords,
  buildRecordText,
  buildRecordCsv
} = require('../../utils/records');
const { addDays, getTodayDate } = require('../../utils/date');

// 导出范围选项（ActionSheet 顺序即下标）：null=全部历史；'custom'=自选时间段（页内面板）
const EXPORT_RANGES = [
  { label: '全部历史', days: null },
  { label: '最近 7 天', days: 7 },
  { label: '最近 30 天', days: 30 },
  { label: '自选时间段', days: 'custom' }
];

Page({
  data: {
    // 段①：消耗流水（按药分组，手风琴单开）
    byMedicine: [],
    expandedMed: '',
    today: '',
    rangeLabel: '',
    rangeDays: 7,
    // 段②：用药记录（S4）
    medRecords: [],
    activeCount: 0,
    stoppedCount: 0,
    activeRecords: [],
    stoppedRecords: [],
    // 自选导出面板（2026-11-12 负责人批准）
    showCustomPanel: false,
    customFrom: '',
    customTo: '',
    pendingChannel: ''
  },

  onShow() {
    this.refresh();
  },

  selectRange(e) {
    const days = parseInt(e.currentTarget.dataset.days) || 7;
    this.setData({ rangeDays: days });
    this.refresh();
  },

  // 分组卡展开/收起（手风琴：同时只展开一种药，界面安静适老）
  onToggleMedGroup(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({ expandedMed: this.data.expandedMed === name ? '' : name });
  },

  refresh() {
    const rangeDays = this.data.rangeDays;
    const startDate = addDays(new Date(), -(rangeDays - 1));

    const dates = [];
    for (let i = 0; i < rangeDays; i++) {
      dates.push(addDays(startDate, i));
    }

    const medicines = loadMedicines();
    // 段①：按药分组（utils 派生，停药日当天起不计耗；只含区间内有消耗的药，按合计降序）
    const today = getTodayDate();
    const byMedicine = deriveConsumptionByMedicine(medicines, dates);
    byMedicine.forEach(g => g.days.forEach(d => { d.isToday = d.date === today; }));

    // 段②：用药记录（服用中在前、停药在后，utils 派生排序）
    const medRecords = deriveMedicationRecords(medicines);
    const activeRecords = medRecords.filter(r => r.active);
    const stoppedRecords = medRecords.filter(r => !r.active);

    const rangeLabel = rangeDays === 7 ? '最近 7 天' : '最近 30 天';
    this.setData({
      byMedicine,
      today,
      rangeLabel,
      medRecords,
      activeRecords,
      stoppedRecords,
      activeCount: activeRecords.length,
      stoppedCount: stoppedRecords.length
    });
  },

  // 重新启用（R10）：停药药回到今日用药/药箱；基准=停药日推算剩余（utils 语义）。
  onResume(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '重新启用',
      content: `恢复服用「${name}」？\n剩余库存按停药时的推算从今天继续。`,
      success: (res) => {
        if (res.confirm) {
          resumeMedicine(id);
          wx.showToast({ title: '已恢复服用', icon: 'success' });
          this.refresh();
        }
      }
    });
  },

  // ---- 导出（双通道共用范围选择，2026-11-12 负责人反馈）----

  // ActionSheet 选范围 → 过滤 → 执行导出动作；cancel 静默。
  // 选「自选时间段」→ 唤起页内面板（起/止两个日期选择器，默认近 30 天）。
  chooseExportRange(channel) {
    if (this.data.medRecords.length === 0) {
      wx.showToast({ title: '暂无用药记录', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: EXPORT_RANGES.map(r => r.label),
      success: (res) => {
        const range = EXPORT_RANGES[res.tapIndex] || EXPORT_RANGES[0];
        if (range.days === 'custom') {
          this.setData({
            showCustomPanel: true,
            pendingChannel: channel,
            customFrom: addDays(new Date(), -29), // 默认近 30 天
            customTo: this.data.today
          });
          return;
        }
        const fromDate = range.days ? addDays(new Date(), -(range.days - 1)) : null;
        this.exportWithRange(fromDate, null, range.label, channel);
      },
      fail: () => {} // 用户取消
    });
  },

  // 统一出口：过滤 → 空提示 / 执行导出（toDate 缺省=今天）
  exportWithRange(fromDate, toDate, rangeLabel, channel) {
    const filtered = filterMedicationRecords(this.data.medRecords, fromDate, this.data.today, toDate);
    if (filtered.length === 0) {
      wx.showToast({ title: `${rangeLabel}暂无记录`, icon: 'none' });
      return;
    }
    if (channel === 'copy') this.doCopy(filtered, rangeLabel);
    else this.doShareCsv(filtered);
  },

  // ---- 自选时间段面板 ----

  onCustomFrom(e) {
    this.setData({ customFrom: e.detail.value });
  },

  onCustomTo(e) {
    this.setData({ customTo: e.detail.value });
  },

  onConfirmCustomExport() {
    const { customFrom, customTo, today, pendingChannel } = this.data;
    if (!customFrom || !customTo) {
      wx.showToast({ title: '请选择起止日期', icon: 'none' });
      return;
    }
    if (customFrom > customTo) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    if (customTo > today) {
      wx.showToast({ title: '结束日期不能晚于今天', icon: 'none' });
      return;
    }
    this.setData({ showCustomPanel: false });
    this.exportWithRange(customFrom, customTo, `${customFrom} 至 ${customTo}`, pendingChannel || 'copy');
  },

  onCancelCustomExport() {
    this.setData({ showCustomPanel: false, pendingChannel: '' });
  },

  // 导出①：一键复制文本表格（wx.setClipboardData，可粘贴到微信/备忘录）
  onCopy() {
    this.chooseExportRange('copy');
  },

  doCopy(records, rangeLabel) {
    wx.setClipboardData({
      data: buildRecordText(records),
      success: () => wx.showToast({ title: `已复制（${rangeLabel}），可粘贴到微信/备忘录`, icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    });
  },

  // 导出②：分享 CSV 文件（临时文件 → wx.shareFileMessage，传给文件传输助手/好友）。
  // 模拟器对 shareFileMessage 支持有限（S2 交接已知）：fail 时降级提示改用复制文本。
  onShareCsv() {
    this.chooseExportRange('csv');
  },

  doShareCsv(records) {
    const filePath = `${wx.env.USER_DATA_PATH}/用药记录.csv`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: buildRecordCsv(records),
      encoding: 'utf8',
      success: () => {
        wx.shareFileMessage({
          filePath,
          fileName: '用药记录.csv',
          success: () => wx.showToast({ title: '已发送', icon: 'success' }),
          fail: () => wx.showToast({ title: '当前环境不支持分享文件，请用「复制文本」', icon: 'none' })
        });
      },
      fail: () => wx.showToast({ title: '生成文件失败，请用「复制文本」', icon: 'none' })
    });
  }
});
