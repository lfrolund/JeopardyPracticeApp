// Daily Double placement that follows the show's observed odds.
//
// The counts are where Daily Doubles actually landed in seasons 1 to 42 (9,354 episodes,
// through July 2026) of the Jeopardy! clue dataset (github.com/jwolle1/jeopardy_clue_dataset).
// scripts/build-index.mjs measures them and stores them in data/index.json, which the app
// prefers; these are the same numbers, used if the index isn't loaded. Rows run top to bottom.
// Columns run left to right and are counted only in rounds where all six categories survived
// the dataset's cleanup. Row and column are drawn independently, and the two Double Jeopardy!
// Daily Doubles never share a category, which is how the show places them (Tesauro et al.,
// "Analysis of Watson's Strategies for Playing Jeopardy!", arXiv:1402.0571).
import { weightedIndex } from './util.js';

export const DEFAULT_DD_STATS = {
  1: { rows: [3, 545, 1855, 2859, 2657], cols: [1694, 1087, 1397, 1546, 1248, 798] },
  2: { rows: [24, 1510, 4315, 5989, 3860], cols: [3117, 2259, 2890, 2686, 2591, 1907] },
};

export const DD_COUNT = { 1: 1, 2: 2 };

// Returns [{row, col}] for the round's Daily Doubles on a 5 x 6 board.
export function placeDailyDoubles(round, stats = DEFAULT_DD_STATS, rng = Math.random) {
  const s = stats[round] || DEFAULT_DD_STATS[round];
  const count = DD_COUNT[round] || 0;
  const usedCols = new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    const colWeights = s.cols.map((w, c) => (usedCols.has(c) ? 0 : w));
    const col = weightedIndex(colWeights, rng);
    const row = weightedIndex(s.rows, rng);
    usedCols.add(col);
    out.push({ row, col });
  }
  return out;
}

// Share of Daily Doubles per row, for display.
export function rowPercentages(stats, round) {
  const rows = (stats[round] || DEFAULT_DD_STATS[round]).rows;
  const total = rows.reduce((a, b) => a + b, 0) || 1;
  return rows.map((n) => Math.round((n / total) * 1000) / 10);
}

// Maximum Daily Double wager: your score, or the round's top value if that's higher.
export function maxWager(score, round) {
  const roundMax = round === 2 ? 2000 : 1000;
  return Math.max(score, roundMax);
}
