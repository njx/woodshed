// Dates are local calendar days, stored as 'YYYY-MM-DD' strings.

// A practice day runs until 4am, so a late session that crosses midnight still counts as one day:
// at 1am the set, ratings and diary notes belong to the evening before.
export const DAY_START_HOUR = 4;

// Today's practice date.
export function today(now = new Date()) {
  return dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - DAY_START_HOUR, now.getMinutes()));
}

// The calendar date of d. With no argument, today's practice date.
export function dateStr(d) {
  if (!d) return today();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
export function ago(last) {
  if (!last) return 'never played';
  const d = daysBetween(last, dateStr());
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}
export function niceDate(s, opts = { weekday: 'long', month: 'short', day: 'numeric' }) {
  return parseDate(s).toLocaleDateString(undefined, opts);
}
