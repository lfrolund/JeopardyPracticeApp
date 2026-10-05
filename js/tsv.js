// Parsing for the Jeopardy! clue dataset's TSV files
// (github.com/jwolle1/jeopardy_clue_dataset). Columns, in any order:
// round, clue_value, daily_double_value, category, comments, answer, question, air_date, notes
// Note that the dataset's "answer" column is the clue text and "question" is the response.
import { modernValue, normalizeRound, parseValue, rowForValue, seasonFromDate } from './util.js';

// Compact stored clue: [round, value, ddWager, category, clue, response, airDate, comments, col]
export const F = { round: 0, value: 1, dd: 2, category: 3, clue: 4, response: 5, airDate: 6, comments: 7, col: 8 };

function clean(field) {
  let s = field ?? '';
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).replace(/""/g, '"');
  return s.replace(/\\(['"])/g, '$1').trim();
}

export function headerIndex(headerLine) {
  const cols = headerLine.split('\t').map((c) => clean(c).toLowerCase());
  const idx = (name) => cols.indexOf(name);
  const h = {
    round: idx('round'),
    value: idx('clue_value'),
    dd: idx('daily_double_value'),
    category: idx('category'),
    comments: idx('comments'),
    clue: idx('answer'),
    response: idx('question'),
    airDate: idx('air_date'),
  };
  const missing = ['round', 'value', 'category', 'clue', 'response', 'airDate'].filter((k) => h[k] < 0);
  if (missing.length) throw new Error(`Unrecognized file: missing column(s) ${missing.join(', ')}`);
  return h;
}

// Returns a compact clue tuple (column filled in later), or null for rows to skip.
export function rowToClue(line, h) {
  const f = line.split('\t');
  const clue = clean(f[h.clue]);
  const response = clean(f[h.response]);
  const airDate = clean(f[h.airDate]);
  if (!clue || !response || !airDate) return null;
  const round = normalizeRound(clean(f[h.round]));
  const value = round === 3 ? 0 : modernValue(parseValue(clean(f[h.value])), airDate);
  const dd = h.dd >= 0 ? modernValue(parseValue(clean(f[h.dd])), airDate) : 0;
  return [round, value, dd, clean(f[h.category]), clue, response, airDate, h.comments >= 0 ? clean(f[h.comments]) : '', -1];
}

// Accumulates parsed rows from any number of files, de-duplicated, grouped by season.
export class DatasetBuilder {
  constructor() {
    this.seen = new Set();
    this.bySeason = new Map();
    this.header = null;
    this.rows = 0;
  }

  startFile() {
    this.header = null;
  }

  addLine(line) {
    if (!line.trim()) return;
    if (!this.header) {
      this.header = headerIndex(line);
      return;
    }
    const c = rowToClue(line, this.header);
    if (!c) return;
    const key = `${c[F.airDate]}|${c[F.round]}|${c[F.category]}|${c[F.clue]}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const season = seasonFromDate(c[F.airDate]);
    if (season == null || season < 1) return;
    if (!this.bySeason.has(season)) this.bySeason.set(season, []);
    this.bySeason.get(season).push(c);
    this.rows++;
  }

  // Assigns board columns (category order within a game's round) and measures
  // where Daily Doubles actually landed.
  finish() {
    const ddStats = {
      1: { rows: [0, 0, 0, 0, 0], cols: [0, 0, 0, 0, 0, 0], source: 'your dataset' },
      2: { rows: [0, 0, 0, 0, 0], cols: [0, 0, 0, 0, 0, 0], source: 'your dataset' },
    };
    for (const clues of this.bySeason.values()) {
      const order = new Map();
      const groups = new Map();
      for (const c of clues) {
        const gameRound = `${c[F.airDate]}|${c[F.round]}`;
        if (!order.has(gameRound)) order.set(gameRound, []);
        const cats = order.get(gameRound);
        let col = cats.indexOf(c[F.category]);
        if (col < 0) col = cats.push(c[F.category]) - 1;
        c[F.col] = col;
        const g = `${gameRound}|${c[F.category]}`;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(c);
      }
      // A clue with no usable value (seen on some older Daily Doubles) takes the one empty slot.
      for (const group of groups.values()) {
        const round = group[0][F.round];
        if (round === 3) continue;
        const bad = group.filter((c) => rowForValue(c[F.value], round) < 0);
        if (bad.length !== 1) continue;
        const used = new Set(group.map((c) => rowForValue(c[F.value], round)));
        const free = [0, 1, 2, 3, 4].filter((r) => !used.has(r));
        if (free.length === 1) bad[0][F.value] = (free[0] + 1) * (round === 2 ? 400 : 200);
      }
      for (const c of clues) {
        const col = c[F.col];
        const round = c[F.round];
        const row = rowForValue(c[F.value], round);
        if (c[F.dd] > 0 && ddStats[round] && row >= 0) {
          ddStats[round].rows[row]++;
          // The dataset drops some clues (audio/visual ones), occasionally a whole category,
          // which shifts later columns left. Only count columns from intact six-category rounds.
          if (order.get(`${c[F.airDate]}|${round}`).length === 6) ddStats[round].cols[col]++;
        }
      }
    }
    for (const r of [1, 2]) {
      if (ddStats[r].rows.reduce((a, b) => a + b, 0) < 50) delete ddStats[r];
    }
    const seasons = [...this.bySeason.keys()].sort((a, b) => a - b);
    return { seasons, bySeason: this.bySeason, ddStats, rows: this.rows };
  }
}
