// Builds data/index.json: where each episode sits inside the dataset's season files, so the
// app can fetch one episode with an HTTP range request instead of downloading whole seasons.
// The index holds byte offsets and counts only, no clue text.
//
//   node scripts/build-index.mjs [commit-sha]     (defaults to the dataset's current main)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { completeCategory } from '../js/sources.js';
import { headerIndex, rowToClue, F } from '../js/tsv.js';

const REPO = 'jwolle1/jeopardy_clue_dataset';
const ref = process.argv[2] || execFileSync('git', ['ls-remote', `https://github.com/${REPO}`, 'refs/heads/main'])
  .toString().split(/\s/)[0];
const base = `https://raw.githubusercontent.com/${REPO}/${ref}/seasons`;

function linesWithOffsets(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      if (i > start) out.push({ start, end: i + 1, text: buf.subarray(start, i).toString('utf8').replace(/\r$/, '') });
      start = i + 1;
    }
  }
  return out;
}

const seasons = [];
let header = null;
// Where Daily Doubles landed: rows top to bottom, columns left to right (columns only from
// rounds where all six categories survived the dataset's cleanup).
const ddStats = {
  1: { rows: [0, 0, 0, 0, 0], cols: [0, 0, 0, 0, 0, 0] },
  2: { rows: [0, 0, 0, 0, 0], cols: [0, 0, 0, 0, 0, 0] },
};
for (let n = 1; ; n++) {
  const res = await fetch(`${base}/season${n}.tsv`);
  if (res.status === 404) break;
  if (!res.ok) throw new Error(`season ${n}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const lines = linesWithOffsets(buf);
  if (header && header !== lines[0].text) throw new Error(`season ${n}: header differs`);
  header = lines[0].text;
  const h = headerIndex(header);

  // Rows of one episode are contiguous; collect each block's byte range.
  const games = [];
  const seen = new Set();
  let cur = null;
  for (const line of lines.slice(1)) {
    const airDate = line.text.split('\t')[h.airDate];
    if (!cur || cur.airDate !== airDate) {
      if (seen.has(airDate)) throw new Error(`season ${n}: ${airDate} is not contiguous`);
      seen.add(airDate);
      cur = { airDate, start: line.start, end: line.end, rows: [] };
      games.push(cur);
    }
    cur.end = line.end;
    cur.rows.push(line.text);
  }

  const entries = games.map((g) => {
    const clues = g.rows.map((r) => rowToClue(r, h)).filter(Boolean);
    const count = (round) => clues.filter((c) => c[F.round] === round).length;
    const complete = (round) => {
      const cats = new Map();
      for (const c of clues.filter((x) => x[F.round] === round)) {
        if (!cats.has(c[F.category])) cats.set(c[F.category], []);
        cats.get(c[F.category]).push({ value: c[F.value], dd: c[F.dd] > 0 });
      }
      let n = 0;
      [...cats.values()].forEach((cl, col) => {
        const board = completeCategory(cl, round);
        if (!board) return;
        n++;
        const row = board.findIndex((c) => c.dd);
        if (row < 0) return;
        ddStats[round].rows[row]++;
        if (cats.size === 6) ddStats[round].cols[col]++;
      });
      return n;
    };
    // [airDate, byteStart, byteLength, clues per round J/DJ/FJ, complete categories J/DJ]
    return [g.airDate, g.start, g.end - g.start, count(1), count(2), count(3), complete(1), complete(2)];
  });
  seasons.push({ season: n, size: buf.length, games: entries });
  console.error(`season ${n}: ${entries.length} games`);
}

const index = {
  repo: REPO,
  ref,
  header,
  builtAt: new Date().toISOString().slice(0, 10),
  ddStats,
  fields: ['airDate', 'byteStart', 'byteLength', 'cluesJ', 'cluesDJ', 'cluesFJ', 'completeCategoriesJ', 'completeCategoriesDJ'],
  seasons,
};
writeFileSync(new URL('../data/index.json', import.meta.url), JSON.stringify(index));
console.error(`wrote ${seasons.length} seasons, ${seasons.reduce((s, x) => s + x.games.length, 0)} games, ref ${ref}`);
