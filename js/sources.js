// Clue sources. Both expose the same interface:
//   seasons()                      -> [{ id, label }]
//   randomClues(n, { seasons, rounds }) -> [clue]
//   randomCategory({ seasons, rounds }) -> [clue] (one category from one game, by value)
//   board(round, { seasons })      -> [{ name, airDate, clues: [clue x5] }] x6
//   ddStats                        -> Daily Double odds to use, or null for the defaults
// A clue is { round, value, dd, category, clue, response, airDate, season, comments }.
import { F, headerIndex, rowToClue } from './tsv.js';
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

// ---------------------------------------------------------------- GitHub dataset

// Clues from github.com/jwolle1/jeopardy_clue_dataset, fetched one episode at a time.
// data/index.json (built by scripts/build-index.mjs) records where each episode's rows sit
// in its season file at a pinned commit, so an episode is a single small HTTP range request
// (about 8 KB) to raw.githubusercontent.com, which allows cross-origin requests.
const EPISODES_IN_MEMORY = 80;

export class EpisodeSource {
  constructor({ indexUrl = 'data/index.json', fetchFn = (...a) => fetch(...a) } = {}) {
    this.indexUrl = indexUrl;
    this.fetchFn = fetchFn;
    this.loaded = null;
    this.episodes = new Map();
    this.ddStats = null;
    this.label = 'Jeopardy! clue dataset';
  }

  index() {
    this.loaded ||= (async () => {
      const res = await this.fetchFn(this.indexUrl);
      if (!res.ok) throw new Error(`Couldn't load the episode index (${res.status}).`);
      const index = await res.json();
      this.header = headerIndex(index.header);
      this.base = `https://raw.githubusercontent.com/${index.repo}/${index.ref}/seasons`;
      if (index.ddStats) this.ddStats = index.ddStats;
      this.games = index.seasons.flatMap((s) => s.games.map(([airDate, start, length, j, dj, fj, cj, cdj]) => ({
        season: s.season, airDate, start, length, clues: [0, j, dj, fj], complete: [0, cj, cdj],
      })));
      this.seasonIds = index.seasons.map((s) => s.season);
      return index;
    })();
    this.loaded.catch(() => { this.loaded = null; });
    return this.loaded;
  }

  async seasons() {
    await this.index();
    return this.seasonIds.map((id) => ({ id, label: `Season ${id}` }));
  }

  async gamesFor(seasons, weightFn) {
    await this.index();
    const list = this.games.filter((g) => (!seasons?.length || seasons.includes(g.season)) && weightFn(g) > 0);
    if (!list.length) throw new Error('No episodes match those settings.');
    return { list, weights: list.map(weightFn) };
  }

  // One episode's clues, grouped into categories in board order.
  async episode(game) {
    const key = `${game.season}|${game.start}`;
    if (!this.episodes.has(key)) {
      const job = this.fetchEpisode(game);
      this.episodes.set(key, job);
      job.catch(() => this.episodes.delete(key));
      if (this.episodes.size > EPISODES_IN_MEMORY) this.episodes.delete(this.episodes.keys().next().value);
    }
    return this.episodes.get(key);
  }

  async fetchEpisode(game) {
    const end = game.start + game.length - 1;
    let res;
    try {
      res = await this.fetchFn(`${this.base}/season${game.season}.tsv`, { headers: { Range: `bytes=${game.start}-${end}` } });
    } catch {
      throw new Error('Couldn’t reach GitHub to load clues. Check your connection and try again.');
    }
    if (!res.ok) throw new Error(`GitHub returned ${res.status} while loading clues.`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range sends the whole file; take the episode's slice.
    if (res.status === 200 && bytes.length > game.length) bytes = bytes.subarray(game.start, end + 1);
    const text = new TextDecoder().decode(bytes);
    const clues = [];
    const cols = new Map();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const t = rowToClue(line, this.header);
      if (!t) continue;
      const roundKey = `${t[F.round]}|${t[F.category]}`;
      if (!cols.has(roundKey)) cols.set(roundKey, [...cols.keys()].filter((k) => k.startsWith(`${t[F.round]}|`)).length);
      clues.push({
        round: t[F.round], value: t[F.value], dd: t[F.dd] > 0, category: t[F.category], clue: t[F.clue],
        response: t[F.response], airDate: t[F.airDate], comments: t[F.comments], col: cols.get(roundKey), season: game.season,
      });
    }
    const groups = new Map();
    for (const c of clues) {
      const k = `${c.round}|${c.category}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    return { clues, groups: [...groups.values()] };
  }

  // Episodes are picked in proportion to how many matching clues they hold, so every clue
  // is about equally likely. Each clue in a batch comes from its own random episode.
  async randomClues(n, { seasons, rounds }) {
    const { list, weights } = await this.gamesFor(seasons, (g) => rounds.reduce((s, r) => s + g.clues[r], 0));
    const picks = Array.from({ length: n }, () => list[weightedIndex(weights)]);
    const eps = await Promise.all(picks.map((g) => this.episode(g)));
    const out = eps.map((ep) => pick(ep.clues.filter((c) => rounds.includes(c.round)))).filter(Boolean);
    if (!out.length) throw new Error('No clues matched those settings.');
    return out;
  }

  async randomCategory({ seasons, rounds }) {
    const { list, weights } = await this.gamesFor(seasons, (g) => rounds.reduce((s, r) => s + g.clues[r], 0));
    for (let tries = 0; tries < 8; tries++) {
      const ep = await this.episode(list[weightedIndex(weights)]);
      const cats = ep.groups.filter((g) => rounds.includes(g[0].round) && (g[0].round === 3 || g.length >= 3));
      if (cats.length) return pick(cats).slice().sort((a, b) => a.value - b.value);
    }
    throw new Error('Could not find a category for those settings.');
  }

  completeCats(ep, round) {
    return ep.groups
      .filter((g) => g[0].round === round)
      .map((g) => ({ name: g[0].category, airDate: g[0].airDate, col: g[0].col, clues: completeCategory(g, round) }))
      .filter((c) => c.clues);
  }

  async board(round, { seasons }) {
    await this.index();
    // Prefer a real game's board: an episode where all six categories are complete.
    const full = this.games.filter((g) => (!seasons?.length || seasons.includes(g.season)) && g.complete[round] >= 6);
    if (full.length) {
      const cats = this.completeCats(await this.episode(pick(full)), round);
      if (cats.length >= 6) return cats.sort((a, b) => a.col - b.col).slice(0, 6);
    }
    // Otherwise mix complete categories from a few episodes.
    const { list, weights } = await this.gamesFor(seasons, (g) => g.complete[round]);
    const cats = [];
    for (let tries = 0; cats.length < 6 && tries < 6; tries++) {
      const eps = await Promise.all(Array.from({ length: 3 }, () => this.episode(list[weightedIndex(weights)])));
      for (const ep of eps) {
        for (const c of shuffle(this.completeCats(ep, round))) {
          if (cats.length < 6 && !cats.some((x) => x.name === c.name)) cats.push(c);
        }
      }
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
