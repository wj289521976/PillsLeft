// 三问式添加药品（R11，S3）：①药名（可语音）②时段点选+剂量 stepper（每日总量自动算）
// ③盒数/规格 stepper+快捷点选；补货日期默认今天不问。全程可不碰键盘。
// 校验语义沿用 v1（R02 不回退）：名称非空≤30、规格 1-9999 整数、库存≥每日用量。
const { addMedicine } = require('../../utils/storage');
const { buildUsageTime } = require('../../utils/schedule');
const { getTodayDate } = require('../../utils/date');

const SLOT_DEFS = [
  { slot: 'morning', label: '早' },
  { slot: 'noon', label: '中' },
  { slot: 'evening', label: '晚' },
  { slot: 'bedtime', label: '睡前' }
];

Page({
  data: {
    today: getTodayDate(),
    name: '',
    slots: SLOT_DEFS.map((s) => ({ ...s, on: false, dose: 1 })),
    noFixedTime: false, // 无固定时段（如"必要时服"）→ timeSlots 空、usageTime 存原文
    occasionalText: '',
    occasionalDose: 1,
    dailyDose: 0, // 点选自动算（页面展示，不单独存）
    boxes: 1,
    spec: 30,
    presetSpecs: [7, 10, 14, 20, 28, 30, 60],
    totalPills: 30
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value });
  },

  // ---- 第二问：时段点选 + 剂量 ----
  onToggleSlot(e) {
    const idx = e.currentTarget.dataset.index;
    const key = `slots[${idx}].on`;
    this.setData({ [key]: !this.data.slots[idx].on });
    this.recalcDose();
  },

  onSlotDose(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ [`slots[${idx}].dose`]: e.detail.value });
    this.recalcDose();
  },

  onToggleNoFixed() {
    this.setData({ noFixedTime: !this.data.noFixedTime });
    this.recalcDose();
  },

  onOccasionalText(e) {
    this.setData({ occasionalText: e.detail.value });
  },

  onOccasionalDose(e) {
    this.setData({ occasionalDose: e.detail.value });
    this.recalcDose();
  },

  recalcDose() {
    const sum = this.data.noFixedTime
      ? this.data.occasionalDose
      : this.data.slots.filter((s) => s.on).reduce((acc, s) => acc + s.dose, 0);
    this.setData({ dailyDose: Math.round(sum * 10000) / 10000 });
  },

  // ---- 第三问：盒数 + 规格 ----
  onBoxes(e) {
    this.setData({ boxes: e.detail.value });
    this.recalcTotal();
  },

  onSpec(e) {
    this.setData({ spec: e.detail.value });
    this.recalcTotal();
  },

  onPickSpec(e) {
    this.setData({ spec: e.currentTarget.dataset.spec });
    this.recalcTotal();
  },

  recalcTotal() {
    this.setData({ totalPills: Math.round(this.data.boxes * this.data.spec) });
  },

  validate() {
    const d = this.data;
    if (!d.name.trim()) { wx.showToast({ title: '请输入药品名称', icon: 'none' }); return false; }
    if (d.name.trim().length > 30) { wx.showToast({ title: '名称不超过30字', icon: 'none' }); return false; }
    if (d.noFixedTime) {
      if (!d.occasionalText.trim()) { wx.showToast({ title: '请简述服药方式', icon: 'none' }); return false; }
      if (!(d.occasionalDose > 0)) { wx.showToast({ title: '请填写大约每天几粒', icon: 'none' }); return false; }
    } else if (!d.slots.some((s) => s.on)) {
      wx.showToast({ title: '请点选服药时段', icon: 'none' }); return false;
    }
    // 防御纵深（S4 加固）：dailyDose 由交互重算（recalcDose），正常 UI 恒>0；
    // 表单状态被绕过/组件异常时拦截，防 dailyDose=0 落库导致推算 NaN→假"充足"。
    if (!(d.dailyDose > 0)) { wx.showToast({ title: '请点选服药时段与剂量', icon: 'none' }); return false; }
    const spec = Math.round(Number(d.spec));
    if (!(spec >= 1 && spec <= 9999)) { wx.showToast({ title: '每盒粒数需为1-9999', icon: 'none' }); return false; }
    if (!(Math.round(d.boxes) >= 1)) { wx.showToast({ title: '至少买1盒', icon: 'none' }); return false; }
    if (d.boxes * spec < d.dailyDose) {
      wx.showToast({ title: '买的量不够一天吃，请多买或改规格', icon: 'none' }); return false;
    }
    return true;
  },

  onSubmit() {
    if (this.submitting) return; // 提交锁：防 1.2s 返回窗口内重复点击导致重复入库（联调修复）
    if (!this.validate()) return;
    this.submitting = true;

    const d = this.data;
    const timeSlots = d.noFixedTime
      ? []
      : d.slots.filter((s) => s.on).map((s) => ({ slot: s.slot, dose: s.dose }));

    addMedicine({
      name: d.name.trim(),
      usageTime: d.noFixedTime ? d.occasionalText.trim() : buildUsageTime(timeSlots),
      timeSlots,
      specPerBox: Math.round(Number(d.spec)),
      dailyDose: d.dailyDose,
      lastRestockDate: d.today,
      lastRestockStock: Math.round(d.boxes * d.spec)
    });

    wx.showToast({ title: '添加成功', icon: 'success' });
    setTimeout(() => { wx.navigateBack(); }, 1200);
  }
});
