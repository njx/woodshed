export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clone = (o) => structuredClone(o);

export function weightedPick(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
export function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
// Loose title match: case, punctuation, curly quotes and a leading "The"/"A" don't matter.
export function normTitle(s) {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/^(the|a) /, '')
    .replace(/[^a-z0-9]/g, '');
}
