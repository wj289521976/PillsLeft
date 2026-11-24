const { daysBetween, addDays, formatDate } = require('./date');

function deriveMedicineStatus(m, today) {
  const now = today || new Date();
  const todayStr = formatDate(now);
  const daysSinceRestock = Math.max(0, daysBetween(m.lastRestockDate, todayStr));
  const consumed = daysSinceRestock * m.dailyDose;
  const remainingPills = m.lastRestockStock - consumed;
  const remainingBoxes = Math.max(0, remainingPills) / m.specPerBox;
  const remainingDays = Math.floor(remainingPills / m.dailyDose);
  const suggestedRestockDate = addDays(now, Math.max(0, remainingDays - 3));
  const status = getStatus(remainingDays);

  return {
    consumed: Math.round(consumed * 100) / 100,
    remainingPills: Math.round(remainingPills * 100) / 100,
    remainingBoxes: Math.round(remainingBoxes * 10) / 10,
    remainingDays,
    suggestedRestockDate,
    status,
    daysSinceRestock
  };
}

function getStatus(remainingDays) {
  if (remainingDays <= 0) return 'out';
  if (remainingDays <= 7) return 'warning';
  return 'sufficient';
}

function dailyConsumptionOn(m, date) {
  const dt = date instanceof Date ? date : new Date(date);
  const restockDate = new Date(m.lastRestockDate);
  if (dt < restockDate) return 0;

  const daysFromRestock = daysBetween(restockDate, dt);
  const consumedByEndOfDay = Math.min(
    m.lastRestockStock,
    (daysFromRestock + 1) * m.dailyDose
  );
  const consumedByStartOfDay = Math.min(
    m.lastRestockStock,
    Math.max(0, daysFromRestock * m.dailyDose)
  );

  return Math.round(Math.max(0, consumedByEndOfDay - consumedByStartOfDay) * 100) / 100;
}

function getStatusLabel(status) {
  const map = {
    sufficient: { text: '充足', color: '#52C41A', icon: '✅' },
    warning: { text: '预警', color: '#FAAD14', icon: '🟡' },
    out: { text: '断药', color: '#FF4D4F', icon: '❌' }
  };
  return map[status] || map.sufficient;
}

function applyRestock(m, boxesPurchased, pillsBefore) {
  const today = formatDate(new Date());
  const status = deriveMedicineStatus(m);
  const predictedRemaining = Math.max(0, status.remainingPills);
  const actualRemaining = pillsBefore !== undefined && pillsBefore !== null ? pillsBefore : predictedRemaining;

  return {
    ...m,
    lastRestockDate: today,
    lastRestockStock: actualRemaining + boxesPurchased * m.specPerBox,
    updatedAt: Date.now()
  };
}

function applyCalibration(m, actualPills) {
  const today = formatDate(new Date());
  return {
    ...m,
    lastRestockDate: today,
    lastRestockStock: actualPills,
    updatedAt: Date.now()
  };
}

module.exports = {
  deriveMedicineStatus,
  getStatus,
  dailyConsumptionOn,
  getStatusLabel,
  applyRestock,
  applyCalibration
};