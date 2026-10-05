// Small shared helpers. Pure functions only, so they can run under `node --test`.

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

// Index chosen in proportion to the given non-negative weights.
export function weightedIndex(weights, rng = Math.random) {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return Math.floor(rng() * weights.length);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

// Seasons start in September and end in July. Season 1 began September 1984.
export function seasonFromDate(airDate) {
  const m = /^(\d{4})-(\d{2})/.exec(airDate || '');
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 8 ? year - 1983 : year - 1984;
}

// Clue values doubled on November 26, 2001.
export const VALUE_DOUBLING_DATE = '2001-11-26';

export function modernValue(value, airDate) {
  if (!value) return value;
  return airDate && airDate < VALUE_DOUBLING_DATE ? value * 2 : value;
}

export function parseValue(v) {
  if (typeof v === 'number') return v;
  const digits = String(v ?? '').replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

// 1 = Jeopardy!, 2 = Double Jeopardy!, 3 = Final Jeopardy!
export function normalizeRound(r) {
  if (typeof r === 'number') return r >= 1 && r <= 3 ? r : 1;
  const s = String(r ?? '').trim().toLowerCase();
  if (/^\d$/.test(s)) return normalizeRound(Number(s));
  if (s.includes('final') || s === 'fj' || s === 'fj!') return 3;
  if (s.includes('double') || s === 'dj' || s === 'dj!') return 2;
  return 1;
}

export const ROUND_NAMES = { 1: 'Jeopardy!', 2: 'Double Jeopardy!', 3: 'Final Jeopardy!' };
export const ROUND_BASE = { 1: 200, 2: 400 };

// Board row (0-4) for a modern value in a round, or -1 if it doesn't fit the grid.
export function rowForValue(value, round) {
  const base = ROUND_BASE[round];
  if (!base || !value || value % base !== 0) return -1;
  const row = value / base - 1;
  return row >= 0 && row < 5 ? row : -1;
}

export function formatMoney(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US')}`;
}
