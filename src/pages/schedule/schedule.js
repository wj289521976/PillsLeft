// 今日用药（R08/R09，S2 首屏 tab 页）：
// 取数（storage）→ 派生（deriveTodaySchedule，纯函数）→ 渲染；无勾选、无落库派生字段。
const { loadMedicines, loadSettings } = require('../../utils/storage');
const { deriveTodaySchedule, formatDose } = require('../../utils/schedule');
const { deriveMedicineStatus } = require('../../utils/medicine');
const { getTodayDate } = require('../../utils/date');

// 待服提示条（R09）：只报前 3 个药名，避免长列表刷屏
function buildReminderText(currentGroup) {
  const names = currentGroup.items.map((i) => i.name);
  const head = names.slice(0, 3).join('、');
  return names.length > 3 ? `现在该吃：${head} 等 ${names.length} 种` : `现在该吃：${head}`;
}

Page({
  data: {
    today: '',
    isEmpty: false,
    groups: [],
    unscheduled: [],
    reminderText: '',
    totalCount: 0,
    warningCount: 0,
    outCount: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const today = getTodayDate();
    const medicines = loadMedicines();
    const active = medicines.filter((m) => !m.archived);

    if (active.length === 0) {
      this.setData({
        today, isEmpty: true, groups: [], unscheduled: [], reminderText: '',
        totalCount: 0, warningCount: 0, outCount: 0
      });
      this.updateBadge(0);
      return;
    }

    const settings = loadSettings();
    const { groups, unscheduled, currentSlot } = deriveTodaySchedule(medicines, new Date(), settings);

    // 条目展示字段：剂量文案 + 状态角标（断药❌/预警🟡，充足不标）
    const decorate = (item) => ({
      ...item,
      doseText: formatDose(item.dose),
      icon: item.status === 'out' ? '❌' : item.status === 'warning' ? '🟡' : ''
    });
    groups.forEach((g) => {
      g.items = g.items.map(decorate);
    });
    const unscheduledView = unscheduled.map((item) => ({
      ...item,
      icon: item.status === 'out' ? '❌' : item.status === 'warning' ? '🟡' : ''
    }));

    // 缺药预警数（角标口径：断药+预警，D3 暂定，S2 走查确认）
    let outCount = 0;
    let warningCount = 0;
    active.forEach((m) => {
      const s = deriveMedicineStatus(m).status;
      if (s === 'out') outCount++;
      else if (s === 'warning') warningCount++;
    });

    // 待服提示条：reminderOn 开且有当前时段且当前时段有药（R09）
    let reminderText = '';
    if (settings.reminderOn && currentSlot) {
      const current = groups.find((g) => g.slot === currentSlot);
      if (current && current.items.length > 0) reminderText = buildReminderText(current);
    }

    this.setData({
      today, isEmpty: false, groups, unscheduled: unscheduledView, reminderText,
      totalCount: active.length, warningCount, outCount
    });
    this.updateBadge(outCount + warningCount);
  },

  // 用药 tab（index 0）角标：>0 显示缺药预警数（>99 截断"99+"，审核修复 A3：4 位数文案
  // 会被微信拒绝且 fail 静默后角标直接消失），=0 移除；fail 静默（tabBar 未就绪等场景不阻断）
  updateBadge(count) {
    if (count > 0) {
      wx.setTabBarBadge({ index: 0, text: count > 99 ? '99+' : String(count), fail: () => {} });
    } else {
      wx.removeTabBarBadge({ index: 0, fail: () => {} });
    }
  },

  // 库存"药箱"入口（D2 暂定口径：用药页顶部按钮 → v1 首页）
  onOpenBox() {
    wx.navigateTo({ url: '/pages/index/index' });
  },

  // 空箱引导：直接去添加第一种药（2026-11-12 负责人批准；首启不再注入预置数据）
  onGoAdd() {
    wx.navigateTo({ url: '/pages/medicine-add/medicine-add' });
  },

  onDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/medicine-detail/medicine-detail?id=${id}` });
  }
});
