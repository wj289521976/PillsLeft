function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s) {
  const parts = s.split('-');
  return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
}

function daysBetween(a, b) {
  const da = a instanceof Date ? a : parseDate(a);
  const db = b instanceof Date ? b : parseDate(b);
  const msPerDay = 86400000;
  return Math.floor((db.getTime() - da.getTime()) / msPerDay);
}

function addDays(d, n) {
  const date = d instanceof Date ? new Date(d.getTime()) : parseDate(d);
  date.setDate(date.getDate() + n);
  return formatDate(date);
}

function isToday(s) {
  return s === formatDate(new Date());
}

function getTodayDate() {
  return formatDate(new Date());
}

module.exports = {
  formatDate,
  parseDate,
  daysBetween,
  addDays,
  isToday,
  getTodayDate
};