// Daily Double placement that follows the show's observed odds.
//
// The default counts are where Daily Doubles actually landed in seasons 1 to 42
// (9,345 games, through July 2026), measured from the Jeopardy! clue dataset
// (github.com/jwolle1/jeopardy_clue_dataset) with the same code that measures an imported
// dataset (DatasetBuilder.finish). Rows run top ($200) to bottom; columns left to right,
// counted only in rounds where all six categories survived the dataset's cleanup.
// Row and column are drawn independently, and the two Double Jeopardy! Daily Doubles
// never share a category, which is how the show places them (Tesauro et al., "Analysis of
// Watson's Strategies for Playing Jeopardy!", arXiv:1402.0571). An imported dataset
// replaces these with counts measured from its own games.
import { weightedIndex } from './util.js';

export const DEFAULT_DD_STATS = {
  1: { rows: [3, 619, 2105, 3152, 2832], cols: [1834, 1204, 1531, 1682, 1388, 895], source: 'seasons 1–42' },
  2: { rows: [25, 1731, 4961, 6775, 4210], cols: [3497, 2554, 3261, 3004, 2919, 2170], source: 'seasons 1–42' },
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
