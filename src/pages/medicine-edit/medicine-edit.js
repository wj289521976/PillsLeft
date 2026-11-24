const { getMedicineById, updateMedicine } = require('../../utils/storage');
const { parseUsageTime } = require('../../utils/schedule');
const { getTodayDate } = require('../../utils/date');

Page({
  data: {
    today: getTodayDate(),
    medId: '',
    form: {},
    doseAuto: false // 服药时间可解析时每日用量=时段和自动算（S5 审核 A2：回显真实值+禁用手改，不再静默覆盖）
  },

  onLoad(options) {
    // 无效/缺失 id 兜底（S5 审核修复 A1：原可空表单提交出"假成功"）——与 detail/restock/calibrate 同款
    const back = () => {
      wx.showToast({ title: '药品不存在', icon: 'none' });
      setTimeout(() => { wx.navigateBack(); }, 1200);
    };
    if (!options || !options.id) { back(); return; }
    this.setData({ medId: options.id });
    const m = getMedicineById(options.id);
    if (!m) { back(); return; }
    this.setData({
      form: {
        name: m.name,
        usageTime: m.usageTime || '',
        specPerBox: String(m.specPerBox),
        dailyDose: String(m.dailyDose),
        lastRestockDate: m.lastRestockDate,
        lastRestockStock: String(m.lastRestockStock)
      },
      doseAuto: parseUsageTime(m.usageTime || '').length > 0
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const patch = { ['form.' + field]: e.detail.value };
    if (field === 'usageTime') {
      // 按时段药的每日用量=各时段剂量之和，随输入实时重算并回显（所见即所存）
      const slots = parseUsageTime(String(e.detail.value).trim());
      if (slots.length > 0) {
        const sum = Math.round(slots.reduce((acc, t) => acc + t.dose, 0) * 10000) / 10000;
        patch['form.dailyDose'] = String(sum);
        patch.doseAuto = true;
      } else {
        patch.doseAuto = false; // 未排程药：总量独立语义，手改生效
      }
    }
    this.setData(patch);
  },

  onDateChange(e) {
    this.setData({ 'form.lastRestockDate': e.detail.value });
  },

  onSubmit() {
    if (this.submitting) return; // 提交锁：防 1.2s 返回窗口内重复点击（与其余三表单页同模式）
    const f = this.data.form;
    // 编辑对象存在性复核（S5 审核修复 A1：停留本页期间药被删除时 updateMedicine 静默返回 null）
    if (!getMedicineById(this.data.medId)) {
      wx.showToast({ title: '药品不存在', icon: 'none' });
      setTimeout(() => { wx.navigateBack(); }, 1200);
      return;
    }
    // 校验对齐 R02 六项（NaN 守卫：Number.isFinite 拦截非数字，修复 NaN 落库）
    if (!f.name || !f.name.trim()) { wx.showToast({ title: '请输入药品名称', icon: 'none' }); return; }
    if (f.name.trim().length > 30) { wx.showToast({ title: '名称不超过30字', icon: 'none' }); return; }
    const spec = Number(f.specPerBox);
    if (!Number.isInteger(spec) || spec < 1 || spec > 9999) { wx.showToast({ title: '规格需为1-9999的整数', icon: 'none' }); return; }
    const dose = Number(f.dailyDose);
    if (!Number.isFinite(dose) || dose <= 0) { wx.showToast({ title: '每日用量必须大于0', icon: 'none' }); return; }
    const stock = Number(f.lastRestockStock);
    if (!Number.isFinite(stock) || stock <= 0) { wx.showToast({ title: '库存必须大于0', icon: 'none' }); return; }
    if (stock < dose) { wx.showToast({ title: '库存不能低于每日用量', icon: 'none' }); return; }
    if (!f.lastRestockDate || f.lastRestockDate > this.data.today) { wx.showToast({ title: '补货日期不能晚于今天', icon: 'none' }); return; }
    this.submitting = true;

    // timeSlots 与 usageTime 同源重算（与迁移/添加页一致）：解析失败得 []，归"未排程"由今日页展示原文。
    // 解析成功时 dailyDose=分时段剂量之和（编辑页两字段不再脱钩）；失败保留表单值（未排程药的总量独立语义）。
    const usageTime = f.usageTime.trim();
    const timeSlots = parseUsageTime(usageTime);
    const slotSum = timeSlots.reduce((acc, t) => acc + t.dose, 0);
    const finalDose = timeSlots.length > 0 ? Math.round(slotSum * 10000) / 10000 : dose;

    updateMedicine(this.data.medId, {
      name: f.name.trim(),
      usageTime,
      timeSlots,
      specPerBox: spec,
      dailyDose: finalDose,
      lastRestockDate: f.lastRestockDate,
      lastRestockStock: stock
    });

    wx.showToast({ title: '保存成功', icon: 'success' });
    setTimeout(() => { wx.navigateBack(); }, 1200);
  }
});