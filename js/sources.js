// Clue sources. Both expose the same interface:
//   seasons()                      -> [{ id, label }]
//   randomClues(n, { seasons, rounds }) -> [clue]
//   randomCategory({ seasons, rounds }) -> [clue] (one category from one game, by value)
//   board(round, { seasons })      -> [{ name, airDate, clues: [clue x5] }] x6
//   ddStats                        -> Daily Double odds to use, or null for the defaults
// A clue is { round, value, dd, category, clue, response, airDate, season, comments }.
import { F } from './tsv.js';
import { modernValue, normalizeRound, parseValue, pick, rowForValue, seasonFromDate, shuffle, weightedIndex } from './util.js';

const roundValue = (row, round) => (row + 1) * (round === 2 ? 400 : 200);

// Keeps only categories that fill all five rows of a round, putting each clue in its row.
export function completeCategory(clues, round) {
  const rows = new Array(5).fill(null);
  const unplaced = [];
  for (const c of clues) {
    const r = rowForValue(c.value, round);
    if (r >= 0 && !rows[r]) rows[r] = c;
    else unplaced.push(c);
  }
  // A Daily Double whose stored value is its wager fills whatever slot is left.
  const free = rows.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (free.length === 1 && unplaced.length >= 1) {
    const c = unplaced.find((u) => u.dd) || unplaced[0];
    rows[free[0]] = { ...c, value: roundValue(free[0], round) };
  }
  return rows.every(Boolean) ? rows : null;
}

// ---------------------------------------------------------------- local dataset

export class LocalSource {
  constructor(meta, loadSeason) {
    this.meta = meta;
    this.loadSeason = loadSeason;
    this.cache = new Map();
    this.ddStats = meta.ddStats && Object.keys(meta.ddStats).length ? meta.ddStats : null;
    this.label = 'Imported dataset';
  }

  async seasons() {
    return this.meta.seasons.map((s) => ({ id: s.season, label: `Season ${s.season}`, count: s.count }));
  }

  allowedSeasons(seasons) {
    const all = this.meta.seasons;
    const list = seasons && seasons.length ? all.filter((s) => seasons.includes(s.season)) : all;
    if (!list.length) throw new Error('No clues for the selected seasons.');
    return list;
  }

  async season(id) {
    if (!this.cache.has(id)) {
      const clues = (await this.loadSeason(id)).map((t) => ({
        round: t[F.round], value: t[F.value], dd: t[F.dd] > 0, category: t[F.category], clue: t[F.clue],
        response: t[F.response], airDate: t[F.airDate], comments: t[F.comments], col: t[F.col], season: id,
      }));
      const groups = new Map();
      for (const c of clues) {
        const key = `${c.airDate}|${c.round}|${c.category}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      this.cache.set(id, { clues, groups: [...groups.values()] });
      // Hold a few seasons in memory at most.
      if (this.cache.size > 6) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(id);
  }

  async randomSeason(seasons) {
    const list = this.allowedSeasons(seasons);
    const s = list[weightedIndex(list.map((x) => x.count))];
    return this.season(s.season);
  }

  async randomClues(n, { seasons, rounds }) {
    const out = [];
    for (let tries = 0; out.length < n && tries < n * 20; tries++) {
      const { clues } = await this.randomSeason(seasons);
      const c = pick(clues);
      if (rounds.includes(c.round)) out.push(c);
    }
    if (!out.length) throw new Error('No clues matched those settings.');
    return out;
  }

  async randomCategory({ seasons, rounds }) {
    for (let tries = 0; tries < 60; tries++) {
      const { groups } = await this.randomSeason(seasons);
      const g = pick(groups);
      if (!rounds.includes(g[0].round)) continue;
      if (g[0].round !== 3 && g.length < 3) continue;
      return g.slice().sort((a, b) => a.value - b.value);
    }
    throw new Error('Could not find a category for those settings.');
  }

  async board(round, { seasons }) {
    // Prefer a real game's board: all six categories from one episode.
    for (let tries = 0; tries < 40; tries++) {
      const { groups } = await this.randomSeason(seasons);
      const anchor = pick(groups);
      if (anchor[0].round !== round) continue;
      const game = groups.filter((g) => g[0].airDate === anchor[0].airDate && g[0].round === round);
      const cats = game
        .map((g) => ({ name: g[0].category, airDate: g[0].airDate, col: g[0].col, clues: completeCategory(g, round) }))
        .filter((c) => c.clues);
      if (cats.length >= 6) return cats.sort((a, b) => a.col - b.col).slice(0, 6);
    }
    // Otherwise mix complete categories from different games.
    const cats = [];
    for (let tries = 0; cats.length < 6 && tries < 200; tries++) {
      const { groups } = await this.randomSeason(seasons);
      const g = pick(groups);
      if (g[0].round !== round) continue;
      const clues = completeCategory(g, round);
      if (clues && !cats.some((c) => c.name === g[0].category)) cats.push({ name: g[0].category, airDate: g[0].airDate, clues });
    }
    if (cats.length < 6) throw new Error('Not enough complete categories for a board with those seasons.');
    return cats;
  }
}

// ---------------------------------------------------------------- Cluebase API

export const DEFAULT_CLUEBASE_URL = 'https://cluebase.lukelav.in';

export function normalizeBaseUrl(url) {
  let u = String(url || '').trim() || DEFAULT_CLUEBASE_URL;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

export class CluebaseSource {
  constructor(baseUrl, storage = null) {
    this.base = normalizeBaseUrl(baseUrl);
    this.storage = storage;
    this.games = null;
    this.ddStats = null;
    this.label = 'Cluebase';
  }

  async get(path) {
    let res;
    try {
      res = await fetch(this.base + path);
    } catch {
      throw new Error(`Could not reach Cluebase at ${this.base}. The server may be down or block cross-site requests.`);
    }
    if (!res.ok) throw new Error(`Cluebase returned ${res.status} for ${path}`);
    const body = await res.json();
    if (body.status && body.status !== 'success') throw new Error(`Cluebase error for ${path}`);
    return body.data ?? body;
  }

  // game id -> [season, airDate], needed because clues only carry a game id.
  async gameIndex() {
    if (this.games) return this.games;
    const key = `cluebase-games:${this.base}`;
    try {
      const cached = this.storage && JSON.parse(this.storage.getItem(key) || 'null');
      if (cached && Date.now() - cached.at < 7 * 864e5) return (this.games = new Map(cached.games));
    } catch { /* ignore */ }
    const games = new Map();
    for (let offset = 0; offset < 100000; offset += 1000) {
      const page = await this.get(`/games?limit=1000&offset=${offset}`);
      for (const g of page) {
        const airDate = String(g.air_date || '').slice(0, 10);
        games.set(g.id, [Number(g.season_id) || seasonFromDate(airDate), airDate]);
      }
      if (page.length < 1000) break;
    }
    try { this.storage?.setItem(key, JSON.stringify({ at: Date.now(), games: [...games] })); } catch { /* quota */ }
    return (this.games = games);
  }

  async seasons() {
    try {
      const list = await this.get('/seasons');
      return list.map((s) => ({ id: Number(s.id), label: s.season_name || `Season ${s.id}` })).sort((a, b) => a.id - b.id);
    } catch {
      const games = await this.gameIndex();
      const ids = [...new Set([...games.values()].map((g) => g[0]))].filter(Boolean).sort((a, b) => a - b);
      return ids.map((id) => ({ id, label: `Season ${id}` }));
    }
  }

  normalize(raw, games) {
    const [season, airDate] = games.get(raw.game_id) || [null, ''];
    const round = normalizeRound(raw.round);
    const dd = raw.daily_double === true || raw.daily_double === 1 || /^(true|t|yes|1)$/i.test(String(raw.daily_double));
    return {
      id: raw.id, gameId: raw.game_id, round, dd, season, airDate,
      value: round === 3 ? 0 : modernValue(parseValue(raw.value), airDate),
      category: raw.category || '', clue: raw.clue || '', response: raw.response || '', comments: '',
    };
  }

  async fetchRandom(params, opts) {
    const games = await this.gameIndex();
    const raw = await this.get(`/clues/random?${new URLSearchParams({ limit: 100, ...params })}`);
    return raw
      .map((r) => this.normalize(r, games))
      .filter((c) => c.clue && c.response && opts.rounds.includes(c.round))
      .filter((c) => !opts.seasons?.length || opts.seasons.includes(c.season));
  }

  async randomClues(n, opts) {
    const out = [];
    for (let tries = 0; out.length < n && tries < 10; tries++) out.push(...(await this.fetchRandom({}, opts)));
    if (!out.length) throw new Error('No clues matched those settings.');
    return shuffle(out).slice(0, n);
  }

  async categoryFrom(anchor, opts) {
    if (anchor.round === 3) return [anchor];
    const same = await this.fetchRandom({ category: anchor.category }, { ...opts, rounds: [anchor.round] });
    const byId = new Map([[anchor.id, anchor], ...same.filter((c) => c.gameId === anchor.gameId).map((c) => [c.id, c])]);
    return [...byId.values()].sort((a, b) => a.value - b.value);
  }

  async randomCategory(opts) {
    for (let tries = 0; tries < 6; tries++) {
      for (const anchor of await this.fetchRandom({}, opts)) {
        const cat = await this.categoryFrom(anchor, opts);
        if (anchor.round === 3 || cat.length >= 3) return cat;
      }
    }
    throw new Error('Could not find a category for those settings.');
  }

  async board(round, { seasons }) {
    const opts = { seasons, rounds: [round] };
    const cats = [];
    for (let tries = 0; cats.length < 6 && tries < 8; tries++) {
      for (const anchor of await this.fetchRandom({}, opts)) {
        if (cats.length >= 6) break;
        if (cats.some((c) => c.name === anchor.category)) continue;
        const clues = completeCategory(await this.categoryFrom(anchor, opts), round);
        if (clues) cats.push({ name: anchor.category, airDate: anchor.airDate, clues });
      }
    }
    if (cats.length < 6) throw new Error('Cluebase did not return enough complete categories for a board.');
    return cats;
  }
}
