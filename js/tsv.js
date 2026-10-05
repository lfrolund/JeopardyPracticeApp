// Parsing for the Jeopardy! clue dataset's TSV files
// (github.com/jwolle1/jeopardy_clue_dataset). Columns, in any order:
// round, clue_value, daily_double_value, category, comments, answer, question, air_date, notes
// Note that the dataset's "answer" column is the clue text and "question" is the response.
import { modernValue, normalizeRound, parseValue } from './util.js';

// Parsed clue tuple: [round, value, ddWager, category, clue, response, airDate, comments]
export const F = { round: 0, value: 1, dd: 2, category: 3, clue: 4, response: 5, airDate: 6, comments: 7 };

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

// Returns a clue tuple, or null for rows to skip.
export function rowToClue(line, h) {
  const f = line.split('\t');
  const clue = clean(f[h.clue]);
  const response = clean(f[h.response]);
  const airDate = clean(f[h.airDate]);
  if (!clue || !response || !airDate) return null;
  const round = normalizeRound(clean(f[h.round]));
  const value = round === 3 ? 0 : modernValue(parseValue(clean(f[h.value])), airDate);
  const dd = h.dd >= 0 ? modernValue(parseValue(clean(f[h.dd])), airDate) : 0;
  return [round, value, dd, clean(f[h.category]), clue, response, airDate, h.comments >= 0 ? clean(f[h.comments]) : ''];
}
