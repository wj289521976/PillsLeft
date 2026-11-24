// 设置页 v2（S5 整合）：①用药时段时刻编辑（settings 键首个写入方，R08）②待服提示条开关（R09）
// ③应用内全量备份/恢复（F5，2026-11-11 负责人决策随 S5 实施）④数据管理（恢复默认/清空，v1 保留）
// 写入方约定：时刻/开关经 utils/saveSettings 严格校验；备份恢复覆盖性操作必须 Modal 二次确认。
const {
  loadMedicines,
  loadSettings,
  saveSettings,
  buildBackupPayload,
  parseBackupPayload,
  applyBackup
} = require('../../utils/storage');
const { formatDate } = require('../../utils/date');

// 备份文件名：清点助手备份-YYYYMMDD-HHmm.json（本地时区，分享留存可辨识）
function backupFileName() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `清点助手备份-${formatDate(d).replace(/-/g, '')}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

// ISO 导出时间 → 本地 'YYYY-MM-DD HH:mm'（Modal 展示用；非法输入回退空串）
function formatExportedAt(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${formatDate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

Page({
  data: {
    medicineCount: 0,
    version: '',
    slotTimes: { morning: '07:00', noon: '12:00', evening: '18:00', bedtime: '22:00' },
    reminderOn: true
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const medicines = loadMedicines();
    const settings = loadSettings();
    this.setData({
      medicineCount: medicines.length,
      version: 'v' + getApp().globalData.appVersion,
      slotTimes: settings.slotTimes,
      reminderOn: settings.reminderOn
    });
  },

  // ---- ①时段时刻编辑（picker mode=time，R08）----

  onSlotTimeChange(e) {
    const slot = e.currentTarget.dataset.slot;
    const slotTimes = { ...this.data.slotTimes, [slot]: e.detail.value };
    // 经 saveSettings 严格校验后以归一化结果回填（非法值回退默认，双保险）
    const saved = saveSettings({ slotTimes, reminderOn: this.data.reminderOn });
    this.setData({ slotTimes: saved.slotTimes });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  // ---- ②待服提示条开关（R09）----

  onReminderToggle(e) {
    const saved = saveSettings({ slotTimes: this.data.slotTimes, reminderOn: e.detail.value });
    this.setData({ slotTimes: saved.slotTimes, reminderOn: saved.reminderOn });
  },

  // ---- ③全量备份/恢复（F5）----

  // 备份导出前置：空药箱无备份意义（恢复侧也拒收空备份，保持对称）
  buildPayloadIfAny() {
    const medicines = loadMedicines();
    if (medicines.length === 0) {
      wx.showToast({ title: '暂无药品数据，无需备份', icon: 'none' });
      return null;
    }
    return buildBackupPayload(
      medicines,
      loadSettings(),
      wx.getStorageSync('schemaVersion') || 2
    );
  },

  // 导出①：复制备份 JSON 到剪贴板（可粘贴到备忘录/文件传输助手留存）
  onBackupCopy() {
    const payload = this.buildPayloadIfAny();
    if (!payload) return;
    wx.setClipboardData({
      data: JSON.stringify(payload, null, 2),
      success: () => wx.showToast({ title: '已复制备份，请粘贴保存', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    });
  },

  // 导出②：分享备份 JSON 文件（临时文件 → wx.shareFileMessage；fail 降级提示改用复制）
  onBackupShare() {
    const payload = this.buildPayloadIfAny();
    if (!payload) return;
    const fileName = backupFileName();
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data: JSON.stringify(payload, null, 2),
      encoding: 'utf8',
      success: () => {
        wx.shareFileMessage({
          filePath,
          fileName,
          success: () => wx.showToast({ title: '已发送', icon: 'success' }),
          fail: () => wx.showToast({ title: '当前环境不支持分享文件，请用「复制备份」', icon: 'none' })
        });
      },
      fail: () => wx.showToast({ title: '生成文件失败，请用「复制备份」', icon: 'none' })
    });
  },

  // 导入入口：ActionSheet 选来源（聊天文件 = 分享导出的 .json；剪贴板 = 复制备份的 JSON 文本）
  onBackupImport() {
    wx.showActionSheet({
      itemList: ['从聊天文件导入', '从剪贴板导入'],
      success: (res) => {
        if (res.tapIndex === 0) this.importFromFile();
        if (res.tapIndex === 1) this.importFromClipboard();
      },
      fail: () => {} // 用户取消
    });
  },

  importFromFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (r) => this.handleBackupText(r.data),
          fail: () => wx.showToast({ title: '读取文件失败', icon: 'none' })
        });
      },
      fail: () => {} // 用户取消
    });
  },

  importFromClipboard() {
    wx.getClipboardData({
      success: (r) => this.handleBackupText(r.data),
      fail: () => wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
    });
  },

  // 校验 → Modal 二次确认（覆盖性危险操作）→ applyBackup（内部走幂等迁移）→ 刷新
  handleBackupText(text) {
    let raw;
    try {
      // 容忍 UTF-8 BOM（审核修复 A15：外部编辑器保存的 JSON 常带 BOM，直接 parse 会误报格式错误）
      raw = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    } catch (e) {
      wx.showToast({ title: '内容不是有效的备份 JSON', icon: 'none' });
      return;
    }
    const parsed = parseBackupPayload(raw);
    if (!parsed.ok) {
      wx.showToast({ title: parsed.error, icon: 'none' });
      return;
    }
    const when = formatExportedAt(parsed.exportedAt);
    const droppedNote = parsed.dropped > 0 ? `（另有 ${parsed.dropped} 条无效数据被忽略）` : '';
    wx.showModal({
      title: '恢复备份',
      content: `备份时间：${when || '未知'}\n药品：${parsed.medicines.length} 种${droppedNote}\n\n将覆盖当前全部药品与设置，此操作不可撤销，确定继续？`,
      success: (res) => {
        if (!res.confirm) return;
        const count = applyBackup(parsed);
        wx.showToast({ title: `已恢复 ${count} 种药品`, icon: 'success' });
        this.refresh();
      }
    });
  },

  // ---- ④数据管理（v1 保留；「恢复默认数据」已按负责人 2026-11-12 决定移除：原 14 种
  //     "演示药"实为个人真实记录，不出厂、不随包发布；数据找回唯一途径=备份恢复）----

  onClearData() {
    wx.showModal({
      title: '清空数据',
      content: '确定要清空所有药品数据吗？此操作不可撤销。',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('medicines');
          wx.showToast({ title: '已清空', icon: 'success' });
          this.setData({ medicineCount: 0 });
        }
      }
    });
  }
});
