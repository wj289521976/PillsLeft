const { loadMedicines } = require('../../utils/storage');
const { deriveMedicineStatus, getStatusLabel } = require('../../utils/medicine');
const { getTodayDate } = require('../../utils/date');

Page({
  data: {
    today: '',
    medicines: [],
    warningCount: 0,
    outCount: 0,
    totalCount: 0
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh() {
    const today = getTodayDate();
    // 停药药退出药箱列表（R10）；用药记录与恢复入口在记录页
    const raw = loadMedicines().filter(m => !m.archived);
    const medicines = raw.map(m => {
      const derived = deriveMedicineStatus(m);
      const label = getStatusLabel(derived.status);
      return {
        ...m,
        ...derived,
        statusText: label.text,
        statusColor: label.color,
        statusIcon: label.icon,
        bgClass: 'bg-' + derived.status
      };
    });

    medicines.sort((a, b) => {
      const order = { out: 0, warning: 1, sufficient: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return a.remainingDays - b.remainingDays;
    });

    const warningCount = medicines.filter(m => m.status === 'warning').length;
    const outCount = medicines.filter(m => m.status === 'out').length;

    this.setData({ today, medicines, warningCount, outCount, totalCount: medicines.length });
  },

  onRestock(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/restock/restock?id=${id}` });
  },

  onDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/medicine-detail/medicine-detail?id=${id}` });
  },

  onAdd() {
    wx.navigateTo({ url: '/pages/medicine-add/medicine-add' });
  }
});