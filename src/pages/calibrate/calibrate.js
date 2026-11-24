// 校准（R11，S3 改造）：只问"现在还剩几粒"，stepper 点选为主、键入为辅；偏差提示保留。
const { getMedicineById, updateMedicine } = require('../../utils/storage');
const { deriveMedicineStatus, applyCalibration } = require('../../utils/medicine');

Page({
  data: {
    medicine: null,
    predicted: 0,
    actualPills: 0,
    deviation: 0
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
      const predicted = Math.ceil(derived.remainingPills);
      this.setData({ medicine: m, predicted, actualPills: predicted });
      this.calcDeviation();
    }
  },

  onActual(e) {
    this.setData({ actualPills: e.detail.value });
    this.calcDeviation();
  },

  calcDeviation() {
    this.setData({ deviation: Math.round((this.data.actualPills - this.data.predicted) * 100) / 100 });
  },

  onConfirm() {
    if (this.submitting) return; // 提交锁：防返回窗口内重复点击（联调修复；重算为同值覆盖，双保险）
    const actual = Number(this.data.actualPills);
    if (isNaN(actual) || actual < 0) {
      wx.showToast({ title: '请点选实际剩余粒数', icon: 'none' });
      return;
    }
    this.submitting = true;

    const updated = applyCalibration(this.data.medicine, actual);
    updateMedicine(this.data.medicine.id, updated);

    wx.showToast({ title: '校准成功', icon: 'success' });
    setTimeout(() => { wx.navigateBack(); }, 1200);
  }
});
