// 补货（R11，S3 简化）：只问"又买了几盒"（stepper 点选，不碰键盘）。
// 补货前剩余一律用系统推算（applyRestock 缺省行为）；实际有偏差走校准页，职责分开。
const { getMedicineById, updateMedicine } = require('../../utils/storage');
const { deriveMedicineStatus, applyRestock } = require('../../utils/medicine');

Page({
  data: {
    medicine: null,
    boxes: 1,
    predictedBefore: 0,
    afterStock: 0
  },

  onLoad(options) {
    if (options.id) {
      const m = getMedicineById(options.id);
      if (!m) {
        wx.showToast({ title: '药品不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1000);
        return;
      }
      const derived = deriveMedicineStatus(m);
      const predicted = Math.max(0, Math.ceil(derived.remainingPills));
      this.setData({ medicine: m, predictedBefore: predicted });
      this.calcAfter();
    }
  },

  onBoxes(e) {
    this.setData({ boxes: e.detail.value });
    this.calcAfter();
  },

  calcAfter() {
    const spec = this.data.medicine ? this.data.medicine.specPerBox : 0;
    this.setData({ afterStock: this.data.predictedBefore + Math.round(this.data.boxes) * spec });
  },

  onConfirm() {
    if (this.submitting) return; // 提交锁：防返回窗口内重复点击（联调修复；重算为同值覆盖，双保险）
    const boxes = Math.round(this.data.boxes);
    if (!(boxes >= 1)) {
      wx.showToast({ title: '至少买1盒', icon: 'none' });
      return;
    }
    this.submitting = true;
    // 不传 pillsBefore → 按系统推算剩余折算（v1 语义保留，交互上移除手改入口）
    const updated = applyRestock(this.data.medicine, boxes);
    updateMedicine(this.data.medicine.id, updated);

    wx.showToast({ title: '补货成功', icon: 'success' });
    setTimeout(() => { wx.navigateBack(); }, 1200);
  },

  onCancel() {
    wx.navigateBack();
  }
});
