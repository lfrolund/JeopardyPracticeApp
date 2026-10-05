// Loose answer matching. It only suggests a verdict; the player always has the final say.

const LEADING = /^(what|who|where|when|which)\s+(is|are|was|were)\s+/;
const ARTICLES = /^(the|a|an)\s+/;

export function normalizeAnswer(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\\'/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(LEADING, '')
    .replace(ARTICLES, '')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? 1 - levenshtein(a, b) / max : 1;
}

// Accepted forms of a response: the whole thing, the part outside parentheses,
// each side of "or" / "/", and the last word for names ("Abraham Lincoln" -> "lincoln").
function acceptedForms(response) {
  const raw = String(response ?? '');
  const forms = new Set();
  const add = (s) => {
    const n = normalizeAnswer(s);
    if (n) forms.add(n);
  };
  add(raw);
  add(raw.replace(/\([^)]*\)/g, ''));
  for (const m of raw.matchAll(/\(([^)]*)\)/g)) add(m[1].replace(/^(or|accept:?)\s+/i, ''));
  for (const part of raw.replace(/\([^)]*\)/g, '').split(/\s+or\s+|\//i)) add(part);
  const words = normalizeAnswer(raw.replace(/\([^)]*\)/g, '')).split(' ');
  if (words.length >= 2 && words.at(-1).length >= 4) forms.add(words.at(-1));
  return [...forms];
}

export function isLikelyCorrect(guess, response) {
  const g = normalizeAnswer(guess);
  if (!g) return false;
  return acceptedForms(response).some((f) => {
    if (g === f) return true;
    if (f.length >= 4 && (g.includes(f) || (f.includes(g) && g.length >= f.length * 0.6))) return true;
    return similarity(g, f) >= (f.length <= 5 ? 0.8 : 0.75);
  });
}
