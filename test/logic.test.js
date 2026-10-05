import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DD_STATS, maxWager, placeDailyDoubles } from '../js/dd.js';
import { isLikelyCorrect, normalizeAnswer } from '../js/grade.js';
import { completeCategory, EpisodeSource } from '../js/sources.js';
import { headerIndex, rowToClue } from '../js/tsv.js';
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

test('season file rows parse with the dataset columns', () => {
  const h = headerIndex(HEADER);
  const [dd] = fakeGame('1999-02-01', { oldValues: true }).filter((l) => l.split('\t')[2] !== '0');
  const c = rowToClue(dd, h);
  assert.equal(c[0], 1);
  assert.equal(c[1], 800); // $400 in 1999 shown at today's value
  assert.equal(c[2], 3000);
  assert.equal(c[5], 'Resp 3');
  assert.throws(() => headerIndex('a\tb\tc'), /missing column/);
});

// A fake GitHub: season files plus an index of byte ranges, like scripts/build-index.mjs makes.
function fakeGitHub(seasonGames) {
  const files = {};
  const seasons = [];
  for (const [season, dates] of Object.entries(seasonGames)) {
    let text = `${HEADER}\n`;
    const games = [];
    for (const date of dates) {
      const block = `${fakeGame(date, { oldValues: date < '2001-11-26' }).join('\n')}\n`;
      const start = Buffer.byteLength(text);
      games.push([date, start, Buffer.byteLength(block), 30, 30, 1, 6, 6]);
      text += block;
    }
    files[season] = Buffer.from(text);
    seasons.push({ season: Number(season), games });
  }
  const index = { repo: 'x/y', ref: 'abc', header: HEADER, seasons, ddStats: DEFAULT_DD_STATS };
  const requests = [];
  const fetchFn = async (url, opts = {}) => {
    if (url === 'data/index.json') return { ok: true, status: 200, json: async () => index };
    requests.push({ url, range: opts.headers?.Range });
    const season = /season(\d+)\.tsv$/.exec(url)[1];
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(opts.headers.Range);
    const body = files[season].subarray(Number(a), Number(b) + 1);
    return { ok: true, status: 206, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) };
  };
  return { fetchFn, requests };
}

test('episode source fetches single episodes by byte range', async () => {
  const gh = fakeGitHub({ 15: ['1999-02-01', '1999-02-02'], 41: ['2024-10-01', '2024-10-02', '2024-10-03'] });
  const src = new EpisodeSource({ fetchFn: gh.fetchFn });
  assert.deepEqual((await src.seasons()).map((s) => s.id), [15, 41]);

  const board = await src.board(2, { seasons: [15] });
  assert.equal(board.length, 6);
  assert.deepEqual(board[0].clues.map((c) => c.value), [400, 800, 1200, 1600, 2000]);
  assert.deepEqual(board.map((c) => c.name), [0, 1, 2, 3, 4, 5].map((i) => `CAT 2-${i}`));
  assert.equal(new Set(board.map((c) => c.airDate)).size, 1);
  assert.equal(gh.requests.length, 1);
  assert.match(gh.requests[0].url, /\/x\/y\/abc\/seasons\/season15\.tsv$/);

  const clues = await src.randomClues(10, { seasons: [41], rounds: [3] });
  assert.equal(clues.length, 10);
  assert.ok(clues.every((c) => c.round === 3 && c.season === 41));
  // Each episode is fetched at most once.
  assert.ok(gh.requests.length <= 4);

  const cat = await src.randomCategory({ seasons: [], rounds: [1] });
  assert.equal(cat.length, 5);
  assert.equal(new Set(cat.map((c) => c.category)).size, 1);
  assert.deepEqual(cat.map((c) => c.value), [200, 400, 600, 800, 1000]);
});

test('completeCategory fills a Daily Double stored at its wager', () => {
  const mk = (value, dd = false) => ({ value, dd });
  const out = completeCategory([mk(200), mk(400), mk(3000, true), mk(800), mk(1000)], 1);
  assert.deepEqual(out.map((c) => c.value), [200, 400, 600, 800, 1000]);
  assert.equal(completeCategory([mk(200), mk(400)], 1), null);
});
