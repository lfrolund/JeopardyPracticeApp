import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DD_STATS, maxWager, placeDailyDoubles } from '../js/dd.js';
import { isLikelyCorrect, normalizeAnswer } from '../js/grade.js';
import { completeCategory, LocalSource } from '../js/sources.js';
import { DatasetBuilder, F } from '../js/tsv.js';
import { modernValue, normalizeRound, rowForValue, seasonFromDate } from '../js/util.js';

function seeded(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

test('seasons follow the September start', () => {
  assert.equal(seasonFromDate('1984-09-10'), 1);
  assert.equal(seasonFromDate('1985-06-01'), 1);
  assert.equal(seasonFromDate('2024-09-09'), 41);
  assert.equal(seasonFromDate('2025-07-25'), 41);
});

test('values before November 2001 are doubled', () => {
  assert.equal(modernValue(100, '1999-01-01'), 200);
  assert.equal(modernValue(200, '2001-11-26'), 200);
  assert.equal(rowForValue(800, 1), 3);
  assert.equal(rowForValue(2000, 2), 4);
  assert.equal(rowForValue(1200, 1), -1);
  assert.equal(normalizeRound('Double Jeopardy!'), 2);
  assert.equal(normalizeRound('DJ!'), 2);
  assert.equal(normalizeRound('Final Jeopardy!'), 3);
  assert.equal(normalizeRound('J!'), 1);
});

test('Daily Doubles: one in round one, two in different columns in round two', () => {
  const rng = seeded(7);
  const rows = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5000; i++) {
    assert.equal(placeDailyDoubles(1, DEFAULT_DD_STATS, rng).length, 1);
    const two = placeDailyDoubles(2, DEFAULT_DD_STATS, rng);
    assert.equal(two.length, 2);
    assert.notEqual(two[0].col, two[1].col);
    for (const d of two) rows[d.row]++;
  }
  // Top row is almost never used; the fourth row is the most common.
  assert.ok(rows[0] < 50, `top row ${rows[0]}`);
  assert.equal(rows.indexOf(Math.max(...rows)), 3);
});

test('wager limits', () => {
  assert.equal(maxWager(0, 1), 1000);
  assert.equal(maxWager(-400, 2), 2000);
  assert.equal(maxWager(5600, 2), 5600);
});

test('answer matching', () => {
  assert.equal(normalizeAnswer('What is the Golden Gate Bridge?'), 'golden gate bridge');
  assert.ok(isLikelyCorrect('golden gate', 'Golden Gate Bridge'));
  assert.ok(isLikelyCorrect('lincoln', 'Abraham Lincoln'));
  assert.ok(isLikelyCorrect('redwoods', 'Redwood'));
  assert.ok(isLikelyCorrect('Ross', 'Betsy Ross (or Ross)'));
  assert.ok(isLikelyCorrect('Star Trek', 'Star Trek'));
  assert.ok(!isLikelyCorrect('Seattle', 'Olympia'));
  assert.ok(!isLikelyCorrect('', 'Olympia'));
});

const HEADER = 'round\tclue_value\tdaily_double_value\tcategory\tcomments\tanswer\tquestion\tair_date\tnotes';
function fakeGame(date, { oldValues = false, ddAt = [3, 1] } = {}) {
  const lines = [];
  for (const round of [1, 2]) {
    for (let col = 0; col < 6; col++) {
      for (let row = 0; row < 5; row++) {
        const base = (round === 2 ? 400 : 200) / (oldValues ? 2 : 1);
        const isDD = round === 1 && row === ddAt[0] && col === ddAt[1];
        lines.push([round, (row + 1) * base, isDD ? 1500 : 0, `CAT ${round}-${col}`, '', `Clue ${date} ${round} ${col} ${row}`, `Resp ${row}`, date, ''].join('\t'));
      }
    }
  }
  lines.push([3, 0, 0, 'FINAL CAT', '', `Final ${date}`, 'Final resp', date, ''].join('\t'));
  return lines;
}

test('dataset import groups by season, assigns columns and measures Daily Doubles', async () => {
  const b = new DatasetBuilder();
  b.startFile();
  b.addLine(HEADER);
  for (let d = 0; d < 60; d++) for (const l of fakeGame(new Date(Date.UTC(2024, 9, 1 + d)).toISOString().slice(0, 10))) b.addLine(l);
  for (const l of fakeGame('1999-02-01', { oldValues: true })) b.addLine(l);
  // Re-adding the same file is de-duplicated.
  b.startFile();
  b.addLine(HEADER);
  for (const l of fakeGame('1999-02-01', { oldValues: true })) b.addLine(l);
  const res = b.finish();
  assert.deepEqual(res.seasons, [15, 41]);
  const s15 = res.bySeason.get(15);
  assert.equal(s15.length, 61);
  assert.equal(Math.max(...s15.filter((c) => c[F.round] === 1).map((c) => c[F.value])), 1000);
  assert.equal(Math.max(...s15.map((c) => c[F.col])), 5);
  assert.deepEqual(res.ddStats[1].rows.slice(0, 3), [0, 0, 0]);
  assert.ok(res.ddStats[1].rows[3] > 0);
  assert.equal(res.ddStats[1].cols[1], res.ddStats[1].rows[3]);

  const src = new LocalSource(
    { seasons: res.seasons.map((s) => ({ season: s, count: res.bySeason.get(s).length })), ddStats: res.ddStats },
    async (s) => res.bySeason.get(s),
  );
  const board = await src.board(2, { seasons: [15] });
  assert.equal(board.length, 6);
  assert.deepEqual(board[0].clues.map((c) => c.value), [400, 800, 1200, 1600, 2000]);
  assert.deepEqual(board.map((c) => c.name), [0, 1, 2, 3, 4, 5].map((i) => `CAT 2-${i}`));
  const clues = await src.randomClues(10, { seasons: [], rounds: [3] });
  assert.ok(clues.every((c) => c.round === 3));
  const cat = await src.randomCategory({ seasons: [41], rounds: [1] });
  assert.equal(cat.length, 5);
  assert.equal(new Set(cat.map((c) => c.category)).size, 1);
});

test('completeCategory fills a Daily Double stored at its wager', () => {
  const mk = (value, dd = false) => ({ value, dd });
  const out = completeCategory([mk(200), mk(400), mk(3000, true), mk(800), mk(1000)], 1);
  assert.deepEqual(out.map((c) => c.value), [200, 400, 600, 800, 1000]);
  assert.equal(completeCategory([mk(200), mk(400)], 1), null);
});
