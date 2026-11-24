const { getMedicineById, deleteMedicine, stopMedicine, resumeMedicine } = require('../../utils/storage');
const { deriveMedicineStatus, getStatusLabel } = require('../../utils/medicine');
const { parseDate } = require('../../utils/date');
const { STOP_REASONS } = require('../../utils/records');

Page({
  data: {
    medicine: null,
    derived: null
  },

  onLoad(options) {
    if (options.id) {
      this.medId = options.id;
      this.refresh();
    }
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const m = getMedicineById(this.medId);
    if (!m) {
      wx.showToast({ title: '药品不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    // 停药药推算冻结在停药日（R10）：不再按今天掉数字；恢复时以该冻结剩余折算基准。
    const asOf = m.archived && m.stoppedDate ? parseDate(m.stoppedDate) : undefined;
    const derived = deriveMedicineStatus(m, asOf);
    const label = m.archived
      ? { text: '已停药', color: '#FA8C16', icon: '⛔' }
      : getStatusLabel(derived.status);
    this.setData({
      medicine: m,
      derived: {
        ...derived,
        statusText: label.text,
        statusColor: label.color,
        statusIcon: label.icon
      }
    });
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/medicine-edit/medicine-edit?id=${this.medId}` });
  },

  onRestock() {
    wx.navigateTo({ url: `/pages/restock/restock?id=${this.medId}` });
  },

  onCalibrate() {
    wx.navigateTo({ url: `/pages/calibrate/calibrate?id=${this.medId}` });
  },

  // 停药（R10）：先点选原因（适老，不键入）再 showModal 二次确认；停药后留本页展示停药态。
  onStop() {
    wx.showActionSheet({
      itemList: STOP_REASONS,
      success: (res) => {
        const reason = STOP_REASONS[res.tapIndex] || '停药';
        wx.showModal({
          title: '确认停药',
          content: `确定停止服用「${this.data.medicine.name}」吗？\n原因：${reason}\n停药后不再出现在今日用药与药箱，可随时重新启用。`,
          success: (r) => {
            if (r.confirm) {
              stopMedicine(this.medId, reason);
              wx.showToast({ title: '已停药', icon: 'success' });
              this.refresh();
            }
          }
        });
      },
      fail: () => {} // 取消点选，静默返回
    });
  },

  // 重新启用（R10）：基准=停药日推算剩余（负值截 0，utils 已定）；恢复后推算从今天继续。
  onResume() {
    const frozen = Math.max(0, Math.ceil(this.data.derived.remainingPills));
    wx.showModal({
      title: '重新启用',
      content: `恢复服用「${this.data.medicine.name}」？\n剩余库存按停药时的推算（约 ${frozen} 粒）从今天继续。`,
      success: (r) => {
        if (r.confirm) {
          resumeMedicine(this.medId);
          wx.showToast({ title: '已恢复服用', icon: 'success' });
          this.refresh();
        }
      }
    });
  },

  onDelete() {
    wx.showModal({
      title: '确认删除',
      content: `确定要删除「${this.data.medicine.name}」吗？此操作不可撤销。`,
      success: (res) => {
        if (res.confirm) {
          deleteMedicine(this.medId);
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => { wx.navigateBack(); }, 1200); // 审核修复 A9：与其余四页 1.2s 惯例统一
        }
      }
    });
  }
});
