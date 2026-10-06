import { DEFAULT_DD_STATS, maxWager, placeDailyDoubles, rowPercentages } from './dd.js?v=2026-10-06';
import { isLikelyCorrect } from './grade.js?v=2026-10-06';
import { countdown } from './timer.js?v=2026-10-06';
import { CluebaseSource, DEFAULT_CLUEBASE_URL, EpisodeSource } from './sources.js?v=2026-10-06';
import { ROUND_NAMES, formatMoney, shuffle } from './util.js?v=2026-10-06';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

// ------------------------------------------------------------------ storage

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or quota */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

const DEFAULT_SETTINGS = {
  view: 'unlimited',
  source: null,
  cluebaseUrl: DEFAULT_CLUEBASE_URL,
  seasons: [],
  unlimited: { mode: 'clues', order: 'random', rounds: [1, 2] },
  timer: { on: true, seconds: 15 },
  board: { round: 1, style: 'episode', players: 1, names: ['Player 1', 'Player 2', 'Player 3'] },
};

const loaded = store.get('settings', {});
const settings = {
  ...DEFAULT_SETTINGS,
  ...loaded,
  unlimited: { ...DEFAULT_SETTINGS.unlimited, ...loaded.unlimited },
  board: { ...DEFAULT_SETTINGS.board, ...loaded.board },
  timer: { ...DEFAULT_SETTINGS.timer, ...loaded.timer },
};
const saveSettings = () => store.set('settings', settings);

// ------------------------------------------------------------------ source

let source = null;
let seasonList = [];

function safeLocalStorage() {
  try { return window.localStorage; } catch { return null; }
}

function buildSource() {
  source = settings.source === 'cluebase'
    ? new CluebaseSource(settings.cluebaseUrl, safeLocalStorage())
    : new EpisodeSource();
  seasonList = [];
  return source;
}

const ddStats = () => source?.ddStats || DEFAULT_DD_STATS;

function showBanner(message) {
  const b = $('#source-banner');
  b.hidden = !message;
  b.replaceChildren();
  if (message) {
    b.append(message, ' ', el('button', { class: 'link', onclick: () => showView('settings') }, 'Open settings'));
  }
}

function friendlyError(err) {
  return err?.message || String(err);
}

// ------------------------------------------------------------------ seasons

function seasonSummary() {
  const sel = settings.seasons;
  if (!sel.length) return 'All seasons';
  const s = [...sel].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(i === j ? `${s[i]}` : `${s[i]}–${s[j]}`);
    i = j;
  }
  return `${s.length === 1 ? 'Season' : 'Seasons'} ${parts.join(', ')}`;
}

function refreshSeasonSummaries() {
  for (const n of $$('.season-summary')) n.textContent = seasonSummary();
}

function setSeasons(ids) {
  const all = seasonList.map((s) => s.id);
  const unique = [...new Set(ids)].filter((id) => all.includes(id));
  settings.seasons = unique.length === all.length ? [] : unique;
  saveSettings();
  renderSeasonGrid();
  refreshSeasonSummaries();
  resetUnlimitedQueue();
}

async function loadSeasonList() {
  const grid = $('#s-seasons');
  const from = source;
  try {
    const list = await from.seasons();
    if (from !== source) return;
    seasonList = list;
    renderSeasonGrid();
  } catch (err) {
    if (from !== source) return;
    grid.replaceChildren(el('p', { class: 'muted' }, `Couldn't load seasons: ${friendlyError(err)}`));
  }
}

function renderSeasonGrid() {
  const grid = $('#s-seasons');
  if (!seasonList.length) return;
  const selected = settings.seasons.length ? new Set(settings.seasons) : new Set(seasonList.map((s) => s.id));
  grid.replaceChildren(...seasonList.map((s) => {
    const box = el('input', { type: 'checkbox', value: s.id, checked: selected.has(s.id) });
    box.addEventListener('change', () => {
      const ids = $$('input', grid).filter((i) => i.checked).map((i) => Number(i.value));
      if (!ids.length) {
        box.checked = true;
        return;
      }
      setSeasons(ids);
    });
    return el('label', { class: 'season', title: s.count ? `${s.count.toLocaleString()} clues` : '' }, box, ` ${s.id}`);
  }));
}

// ------------------------------------------------------------------ clue card

// Renders a clue with an optional typed response, reveal, and self-grading.
// onResult receives 'right', 'wrong', or 'skip'.
// A countdown for one clue when the timer setting is on, else null.
function clueTimer(onExpire) {
  return settings.timer.on ? countdown(settings.timer.seconds, onExpire) : null;
}

function clueCard({ clue, value, valueLabel, footer }, onResult) {
  let revealed = false;
  let timedOut = false;
  const timer = clueTimer(() => { timedOut = true; reveal(); });
  const input = el('input', { type: 'text', class: 'answer', placeholder: 'Your response (optional)', autocomplete: 'off', spellcheck: 'false' });
  const revealBtn = el('button', { class: 'primary', onclick: reveal }, 'Reveal');
  const after = el('div', { class: 'after', hidden: true });

  const meta = el('div', { class: 'clue-meta' },
    el('span', { class: 'cat' }, clue.category),
    el('span', { class: 'val' }, valueLabel ?? (value ? formatMoney(value) : ROUND_NAMES[clue.round])),
    clue.dd ? el('span', { class: 'tag' }, 'Daily Double') : null,
    el('span', { class: 'muted' }, [ROUND_NAMES[clue.round], clue.airDate].filter(Boolean).join(' · ')),
    timer?.el,
  );

  const card = el('div', { class: 'clue-card' },
    meta,
    clue.comments ? el('p', { class: 'comments' }, clue.comments) : null,
    el('p', { class: 'clue-text' }, clue.clue),
    el('form', { class: 'answer-row', onsubmit: (e) => { e.preventDefault(); reveal(); } }, input, revealBtn),
    after,
    footer || null,
  );

  function finish(result) {
    timer?.stop();
    document.removeEventListener('keydown', onKey);
    onResult(result);
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    timer?.stop();
    input.disabled = true;
    revealBtn.hidden = true;
    const guess = input.value.trim();
    const likely = guess ? isLikelyCorrect(guess, clue.response) : null;
    const amount = value ? ` ${formatMoney(value)}` : '';
    const rightBtn = el('button', { class: 'right', onclick: () => finish('right') }, `Right${amount ? ` (+${amount.trim()})` : ''}`);
    const wrongBtn = el('button', { class: 'wrong', onclick: () => finish('wrong') }, `Wrong${amount ? ` (−${amount.trim()})` : ''}`);
    const skipBtn = el('button', { class: 'ghost', onclick: () => finish('skip') }, 'Skip');
    // replaceChildren would print a null as the text "null", so the optional hint is filtered out.
    after.replaceChildren(...[
      timedOut ? el('p', { class: 'hint bad' }, 'Time’s up!') : null,
      el('p', { class: 'response' }, clue.response),
      likely == null ? null : el('p', { class: likely ? 'hint good' : 'hint bad' },
        likely ? 'Your response looks right.' : 'Your response doesn’t look like a match.'),
      el('div', { class: 'grade-row' }, rightBtn, wrongBtn, skipBtn),
      el('p', { class: 'muted small' }, 'Keys: R right, W wrong, S skip'),
    ].filter(Boolean));
    after.hidden = false;
    (likely === false ? wrongBtn : rightBtn).focus();
  }

  function onKey(e) {
    if (!card.isConnected) return document.removeEventListener('keydown', onKey);
    if (!revealed || e.target === input || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') finish('right');
    else if (k === 'w') finish('wrong');
    else if (k === 's') finish('skip');
  }
  document.addEventListener('keydown', onKey);

  card.focusInput = () => input.focus();
  // The unlimited tab pauses its clock while another tab is open and restarts it on return.
  card.pause = () => { if (!revealed) timer?.stop(); };
  card.resume = () => { if (!revealed) timer?.restart(); };
  return card;
}

// ------------------------------------------------------------------ unlimited

const u = { ...store.get('unlimited-score', { score: 0, right: 0, wrong: 0 }), queue: [], loading: null, gen: 0 };

function renderUnlimitedScore() {
  $('#u-score').textContent = formatMoney(u.score);
  $('#u-score').classList.toggle('neg', u.score < 0);
  $('#u-right').textContent = u.right;
  $('#u-wrong').textContent = u.wrong;
  const n = u.right + u.wrong;
  $('#u-acc').textContent = n ? `${Math.round((u.right / n) * 100)}%` : '–';
  store.set('unlimited-score', { score: u.score, right: u.right, wrong: u.wrong });
}

function resetUnlimitedQueue() {
  u.queue = [];
  u.gen++;
  u.loading = null;
  if (currentView === 'unlimited') nextUnlimited();
  else $('#u-stage').replaceChildren();
}

async function refill() {
  const opts = { seasons: settings.seasons, rounds: settings.unlimited.rounds };
  if (settings.unlimited.mode === 'categories') {
    const cat = await source.randomCategory(opts);
    const ordered = settings.unlimited.order === 'random' ? shuffle(cat) : cat;
    return ordered.map((c, i) => ({ clue: c, pos: `Clue ${i + 1} of ${ordered.length} in this category` }));
  }
  return (await source.randomClues(10, opts)).map((c) => ({ clue: c }));
}

// Starts fetching the next batch unless one is already on its way. The batch lands in the
// queue only if the settings haven't changed since it was requested.
function ensureLoading() {
  if (!u.loading) {
    const gen = u.gen;
    u.loading = refill().then((items) => {
      if (gen === u.gen) { u.queue.push(...items); u.loading = null; }
    }, (err) => {
      if (gen === u.gen) u.loading = null;
      throw err;
    });
  }
  return u.loading;
}

async function nextUnlimited() {
  const stage = $('#u-stage');
  const gen = u.gen;
  if (!u.queue.length) {
    stage.replaceChildren(el('p', { class: 'loading' }, 'Finding clues…'));
    try {
      await ensureLoading();
      if (gen !== u.gen) return;
      showBanner('');
    } catch (err) {
      if (gen !== u.gen) return;
      stage.replaceChildren(el('div', { class: 'error' },
        el('p', {}, friendlyError(err)),
        el('button', { class: 'ghost', onclick: nextUnlimited }, 'Try again')));
      showBanner(friendlyError(err));
      return;
    }
    if (!u.queue.length) return nextUnlimited();
  }
  const item = u.queue.shift();
  const card = clueCard({
    clue: item.clue,
    value: item.clue.value,
    footer: item.pos ? el('p', { class: 'muted small' }, item.pos) : null,
  }, (result) => {
    const v = item.clue.value || 0;
    if (result === 'right') { u.score += v; u.right++; }
    if (result === 'wrong') { u.score -= v; u.wrong++; }
    renderUnlimitedScore();
    nextUnlimited();
  });
  stage.replaceChildren(card);
  u.card = card;
  card.focusInput();
  // Fetch the next batch in the background while this clue is up.
  if (u.queue.length < 2) ensureLoading().catch(() => {});
}

function initUnlimitedControls() {
  const mode = $('#u-mode');
  const order = $('#u-order');
  mode.value = settings.unlimited.mode;
  order.value = settings.unlimited.order;
  $('#u-order-wrap').hidden = mode.value !== 'categories';
  mode.addEventListener('change', () => {
    settings.unlimited.mode = mode.value;
    $('#u-order-wrap').hidden = mode.value !== 'categories';
    saveSettings();
    resetUnlimitedQueue();
  });
  order.addEventListener('change', () => {
    settings.unlimited.order = order.value;
    saveSettings();
    resetUnlimitedQueue();
  });
  for (const box of $$('.u-round')) {
    box.checked = settings.unlimited.rounds.includes(Number(box.value));
    box.addEventListener('change', () => {
      const rounds = $$('.u-round').filter((b) => b.checked).map((b) => Number(b.value));
      if (!rounds.length) { box.checked = true; return; }
      settings.unlimited.rounds = rounds;
      saveSettings();
      resetUnlimitedQueue();
    });
  }
  $('#u-reset').addEventListener('click', () => {
    Object.assign(u, { score: 0, right: 0, wrong: 0 });
    renderUnlimitedScore();
  });
}

// ------------------------------------------------------------------ practice board

let b = store.get('board-state', null);
const saveBoard = () => store.set('board-state', b);

async function newBoard() {
  const round = Number($('#b-round').value);
  settings.board.round = round;
  saveSettings();
  const boardEl = $('#b-board');
  $('#b-summary').replaceChildren();
  boardEl.replaceChildren(el('p', { class: 'loading' }, 'Building a board…'));
  try {
    const cats = await source.board(round, { seasons: settings.seasons, style: settings.board.style });
    b = {
      round,
      cats,
      dds: placeDailyDoubles(round, ddStats()).map(({ row, col }) => `${row},${col}`),
      done: {},
      score: 0, coryat: 0, right: 0, wrong: 0,
      // Three-player boards keep a score per player; the player in control picks the next clue.
      players: settings.board.players === 3
        ? settings.board.names.map((name) => ({ name, score: 0, coryat: 0, right: 0, wrong: 0 }))
        : null,
      control: 0,
      seasons: settings.seasons.slice(),
      startedAt: new Date().toISOString(),
      finished: false,
    };
    saveBoard();
    showBanner('');
    renderBoard();
  } catch (err) {
    boardEl.replaceChildren(el('div', { class: 'error' }, el('p', {}, friendlyError(err))));
    showBanner(friendlyError(err));
  }
}

function boardValue(row) {
  return (row + 1) * (b.round === 2 ? 400 : 200);
}

function renderBoardScore() {
  const left = b ? 30 - Object.keys(b.done).length : null;
  const multi = Boolean(b?.players);
  $('#b-scorebar').hidden = multi;
  $('#b-players').hidden = !multi;
  if (multi) {
    $('#b-players').replaceChildren(
      el('div', { class: 'players-grid' }, b.players.map((p, i) => el('div', { class: `player${i === b.control && !b.finished ? ' control' : ''}` },
        el('div', { class: 'name' }, p.name),
        el('div', { class: `pscore${p.score < 0 ? ' neg' : ''}` }, formatMoney(p.score)),
        el('div', { class: 'muted' }, `${p.right} right · ${p.wrong} wrong${i === b.control && !b.finished ? ' · picks next' : ''}`)))),
      el('p', { class: 'muted small' }, `${left} clues left. Gold border marks who picks next.`));
    return;
  }
  $('#b-score').textContent = formatMoney(b?.score || 0);
  $('#b-score').classList.toggle('neg', (b?.score || 0) < 0);
  $('#b-coryat').textContent = formatMoney(b?.coryat || 0);
  $('#b-right').textContent = b?.right || 0;
  $('#b-wrong').textContent = b?.wrong || 0;
  $('#b-left').textContent = left == null ? '–' : left;
}

function renderBoard() {
  const boardEl = $('#b-board');
  renderBoardScore();
  if (!b) {
    boardEl.replaceChildren(el('p', { class: 'muted center' }, 'Pick a round and start a new board.'));
    return;
  }
  const cells = [];
  b.cats.forEach((cat, col) => cells.push(el('div', { class: 'cat-head', style: `grid-column:${col + 1};grid-row:1` }, cat.name)));
  for (let row = 0; row < 5; row++) {
    b.cats.forEach((cat, col) => {
      const key = `${row},${col}`;
      const result = b.done[key];
      const cell = el('button', {
        class: `cell${result ? ` done ${result.result}` : ''}`,
        style: `grid-column:${col + 1};grid-row:${row + 2}`,
        disabled: Boolean(result) || b.finished,
        'aria-label': `${cat.name} for ${formatMoney(boardValue(row))}`,
        onclick: () => openCell(row, col),
      }, result ? cellMark(result) : formatMoney(boardValue(row)));
      cells.push(cell);
    });
  }
  boardEl.replaceChildren(...cells);
  if (b.finished) renderSummary();
}

function cellMark(result) {
  if (result.result === 'skip') return '';
  const mark = result.result === 'right' ? '✓' : '✗';
  if (!b.players || result.by == null) return mark;
  return [mark, el('span', { class: 'who' }, b.players[result.by].name)];
}

function openModal(content) {
  const modal = $('#modal');
  $('.modal-card', modal).replaceChildren(content);
  modal.hidden = false;
}

function closeModal() {
  $('#modal').hidden = true;
  $('.modal-card', $('#modal')).replaceChildren();
}

function openCell(row, col) {
  if (b.players) return openCellMulti(row, col);
  const key = `${row},${col}`;
  const clue = b.cats[col].clues[row];
  const natural = boardValue(row);
  const isDD = b.dds.includes(key);
  const showClue = (value, wager) => {
    const card = clueCard({
      clue: { ...clue, dd: isDD },
      value,
      valueLabel: isDD ? `Wager ${formatMoney(wager)}` : formatMoney(value),
    }, (result) => {
      if (result === 'right') { b.score += value; b.coryat += natural; b.right++; }
      if (result === 'wrong') { b.score -= value; if (!isDD) b.coryat -= natural; b.wrong++; }
      b.done[key] = { result, value, dd: isDD };
      if (Object.keys(b.done).length === 30) finishBoard();
      saveBoard();
      closeModal();
      renderBoard();
    });
    openModal(card);
    card.focusInput();
  };
  if (!isDD) return showClue(natural);
  wagerForm({
    title: `${b.cats[col].name} · ${formatMoney(natural)} square`,
    max: maxWager(b.score, b.round),
    initial: b.score,
    onWager: (w) => showClue(w, w),
  });
}

function recordCell(key, entry) {
  b.done[key] = entry;
  if (Object.keys(b.done).length === 30) finishBoard();
  saveBoard();
  closeModal();
  renderBoard();
}

function wagerForm({ title, max, initial, onWager }) {
  const wager = el('input', { type: 'number', min: 5, max, step: 1, value: Math.min(Math.max(initial, 5), max), class: 'wager', required: true });
  const form = el('form', {
    class: 'dd',
    onsubmit: (e) => {
      e.preventDefault();
      const w = Math.round(Number(wager.value));
      if (!(w >= 5 && w <= max)) { wager.setCustomValidity(`Wager between $5 and ${formatMoney(max)}`); wager.reportValidity(); return; }
      onWager(w);
    },
  },
  el('h2', { class: 'dd-title' }, 'Daily Double!'),
  el('p', {}, title),
  el('label', {}, `Wager ($5 to ${formatMoney(max)})`, wager),
  el('div', { class: 'row' },
    el('button', { type: 'button', class: 'ghost', onclick: () => { wager.value = max; } }, 'True Daily Double'),
    el('button', { type: 'submit', class: 'primary' }, 'Lock in wager')));
  wager.addEventListener('input', () => wager.setCustomValidity(''));
  openModal(form);
  wager.focus();
  wager.select();
}

// Three players: the clue is shown, then you pick who rang in and mark them right or wrong.
// After a miss the others can try. Buzzing in itself happens off-screen.
function openCellMulti(row, col) {
  const key = `${row},${col}`;
  const clue = b.cats[col].clues[row];
  const natural = boardValue(row);
  const isDD = b.dds.includes(key);
  const players = b.players;

  const play = ({ value, only = null }) => {
    const attempts = [];
    let answering = only;
    let showResponse = false;
    let timedOut = false;
    // Runs while players are deciding whether to ring in; pauses once someone is answering
    // (except on a Daily Double) and starts over for the others after a miss.
    const timer = clueTimer(() => {
      timedOut = true;
      if (answering == null) { showResponse = true; draw(true); } else draw();
    });
    const body = el('div');
    const card = el('div', { class: 'clue-card' },
      el('div', { class: 'clue-meta' },
        el('span', { class: 'cat' }, clue.category),
        el('span', { class: 'val' }, isDD ? `${players[only].name} wagered ${formatMoney(value)}` : formatMoney(value)),
        isDD ? el('span', { class: 'tag' }, 'Daily Double') : null,
        el('span', { class: 'muted' }, [ROUND_NAMES[clue.round], clue.airDate].filter(Boolean).join(' · ')),
        timer?.el),
      clue.comments ? el('p', { class: 'comments' }, clue.comments) : null,
      el('p', { class: 'clue-text' }, clue.clue),
      body);

    const finish = (result, by) => {
      timer?.stop();
      recordCell(key, { result, by, value, dd: isDD, attempts });
    };
    const pickPlayer = (i) => {
      answering = i;
      timer?.stop();
      draw();
    };
    const reopen = () => {
      answering = null;
      timedOut = false;
      timer?.restart();
      draw();
    };

    const grade = (i, right) => {
      const p = players[i];
      attempts.push({ by: i, result: right ? 'right' : 'wrong' });
      if (right) {
        p.score += value; p.coryat += natural; p.right++;
        b.control = i;
      } else {
        p.score -= value; if (!isDD) p.coryat -= natural; p.wrong++;
      }
      answering = null;
      const left = players.map((_, j) => j).filter((j) => !attempts.some((a) => a.by === j));
      if (right) return finish('right', i);
      if (isDD || !left.length) {
        showResponse = true;
        return draw(true);
      }
      reopen();
    };

    function draw(closed = false) {
      const tried = new Set(attempts.map((a) => a.by));
      const parts = [];
      if (closed) timer?.stop();
      if (timedOut) parts.push(el('p', { class: 'hint bad' }, 'Time’s up!'));
      if (attempts.length) {
        parts.push(el('ul', { class: 'attempts' }, attempts.map((a) => el('li', {},
          `${players[a.by].name}: ${a.result} (${a.result === 'right' ? '+' : '−'}${formatMoney(value)})`))));
      }
      if (showResponse) parts.push(el('p', { class: 'response' }, clue.response));
      if (closed) {
        parts.push(el('div', { class: 'grade-row' },
          el('button', { class: 'primary', onclick: () => finish(attempts.length ? 'wrong' : 'skip', null) }, 'Back to board')));
      } else if (answering == null) {
        parts.push(el('p', { class: 'ask' }, attempts.length ? 'Anyone else?' : 'Who’s answering?'));
        parts.push(el('div', { class: 'grade-row' },
          players.map((p, i) => tried.has(i) ? null : el('button', { class: 'ghost', onclick: () => pickPlayer(i) }, p.name)),
          el('button', { class: 'ghost', onclick: () => { showResponse = true; draw(true); } }, 'No one')));
      } else {
        parts.push(el('p', { class: 'ask' }, `${players[answering].name} is answering`));
        parts.push(el('div', { class: 'grade-row' },
          el('button', { class: 'right', onclick: () => grade(answering, true) }, `Right (+${formatMoney(value)})`),
          el('button', { class: 'wrong', onclick: () => grade(answering, false) }, `Wrong (−${formatMoney(value)})`),
          only == null ? el('button', { class: 'ghost', onclick: reopen }, 'Someone else') : null));
      }
      if (!showResponse && !closed) {
        parts.push(el('p', {}, el('button', { class: 'link small', onclick: () => { showResponse = true; draw(); } }, 'Show response')));
      }
      body.replaceChildren(...parts);
    }

    draw();
    openModal(card);
  };

  if (!isDD) return play({ value: natural });

  // Daily Double: whoever picked the clue answers alone. Default to the player in control.
  const chooser = el('div', { class: 'dd' },
    el('h2', { class: 'dd-title' }, 'Daily Double!'),
    el('p', {}, `${b.cats[col].name} · ${formatMoney(natural)} square`),
    el('p', { class: 'ask' }, 'Who picked this clue?'),
    el('div', { class: 'grade-row' }, players.map((p, i) => el('button', {
      class: i === b.control ? 'primary' : 'ghost',
      onclick: () => {
        b.control = i;
        wagerForm({
          title: `${p.name} has ${formatMoney(p.score)}`,
          max: maxWager(p.score, b.round),
          initial: p.score,
          onWager: (w) => play({ value: w, only: i }),
        });
      },
    }, p.name))));
  openModal(chooser);
  $('button.primary', chooser)?.focus();
}

function finishBoard() {
  b.finished = true;
  const history = store.get('board-history', []);
  history.unshift({
    at: new Date().toISOString(), round: b.round, score: b.score, coryat: b.coryat,
    right: b.right, wrong: b.wrong, answered: Object.keys(b.done).length, seasons: b.seasons,
    players: b.players?.map(({ name, score, coryat, right, wrong }) => ({ name, score, coryat, right, wrong })),
  });
  store.set('board-history', history.slice(0, 100));
  saveBoard();
  renderHistory();
}

function renderSummary() {
  if (b.players) {
    const ranked = b.players.slice().sort((x, y) => y.score - x.score);
    $('#b-summary').replaceChildren(el('div', { class: 'summary' },
      el('h2', {}, ranked[0].score > (ranked[1]?.score ?? -Infinity) ? `${ranked[0].name} leads with ${formatMoney(ranked[0].score)}` : 'It’s a tie at the top'),
      el('ol', { class: 'standings' }, ranked.map((p) => el('li', {},
        `${p.name}: ${formatMoney(p.score)} (${p.right} right, ${p.wrong} wrong, Coryat ${formatMoney(p.coryat)})`))),
      el('p', { class: 'muted' }, `${ROUND_NAMES[b.round]} round.`),
      el('button', { class: 'primary', onclick: newBoard }, 'Play another board')));
    return;
  }
  const answered = b.right + b.wrong;
  const ddResults = Object.values(b.done).filter((d) => d.dd);
  $('#b-summary').replaceChildren(el('div', { class: 'summary' },
    el('h2', {}, `Final score: ${formatMoney(b.score)}`),
    el('p', {}, `${ROUND_NAMES[b.round]} round. ${b.right} right, ${b.wrong} wrong, ${Object.keys(b.done).length - answered} skipped. ` +
      `Coryat score ${formatMoney(b.coryat)}.`),
    ddResults.length ? el('p', { class: 'muted' }, `Daily Doubles: ${ddResults.map((d) => `${d.result} for ${formatMoney(d.value)}`).join(', ')}.`) : null,
    el('button', { class: 'primary', onclick: newBoard }, 'Play another board')));
}

function renderHistory() {
  const history = store.get('board-history', []);
  const box = $('#b-history');
  if (!history.length) {
    box.replaceChildren(el('p', { class: 'muted' }, 'Finished boards show up here.'));
    return;
  }
  const avg = (r) => {
    const h = history.filter((x) => x.round === r && !x.players);
    return h.length ? `${formatMoney(Math.round(h.reduce((s, x) => s + x.coryat, 0) / h.length))} average Coryat over ${h.length}` : null;
  };
  box.replaceChildren(
    el('p', { class: 'muted' }, [avg(1) && `Jeopardy!: ${avg(1)}`, avg(2) && `Double Jeopardy!: ${avg(2)}`].filter(Boolean).join(' · ')),
    el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Round'), el('th', {}, 'Score'), el('th', {}, 'Coryat'), el('th', {}, 'Right'), el('th', {}, 'Wrong'))),
      el('tbody', {}, history.map((h) => el('tr', {},
        el('td', {}, new Date(h.at).toLocaleDateString()),
        el('td', {}, h.round === 2 ? 'Double' : 'Jeopardy!'),
        h.players
          ? el('td', { colspan: 4 }, h.players.map((p) => `${p.name} ${formatMoney(p.score)}`).join(' · '))
          : [el('td', {}, formatMoney(h.score)), el('td', {}, formatMoney(h.coryat)), el('td', {}, h.right), el('td', {}, h.wrong)])))),
    el('button', { class: 'ghost small', onclick: () => { store.del('board-history'); renderHistory(); } }, 'Clear history'));
}

function initBoardControls() {
  $('#b-round').value = String(settings.board.round);
  const style = $('#b-style');
  style.value = settings.board.style;
  style.addEventListener('change', () => {
    settings.board.style = style.value;
    saveSettings();
  });
  const mode = $('#b-mode');
  mode.value = String(settings.board.players);
  $('#b-names').hidden = settings.board.players !== 3;
  mode.addEventListener('change', () => {
    settings.board.players = Number(mode.value);
    $('#b-names').hidden = settings.board.players !== 3;
    saveSettings();
  });
  $$('.b-name').forEach((input, i) => {
    input.value = settings.board.names[i];
    input.addEventListener('input', () => {
      const name = input.value.trim() || `Player ${i + 1}`;
      settings.board.names[i] = name;
      saveSettings();
      // Renaming applies to the board in progress too.
      if (b?.players) { b.players[i].name = name; saveBoard(); renderBoard(); }
    });
  });
  $('#b-new').addEventListener('click', newBoard);
  $('#b-end').addEventListener('click', () => {
    if (!b || b.finished) return;
    if (!confirm('End this board and record the score?')) return;
    finishBoard();
    renderBoard();
  });
  $('#modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal form.dd')) closeModal();
  });
}

// ------------------------------------------------------------------ settings

function renderDDOdds() {
  const stats = ddStats();
  $('#s-dd-source').textContent = 'Measured from where Daily Doubles actually landed in every episode of the clue dataset.';
  const table = (round) => {
    const pct = rowPercentages(stats, round);
    return el('table', { class: 'dd-table' },
      el('caption', {}, `${ROUND_NAMES[round]} (${round === 1 ? 'one Daily Double' : 'two, never in the same category'})`),
      el('tbody', {}, pct.map((p, row) => el('tr', {},
        el('th', {}, formatMoney((row + 1) * (round === 2 ? 400 : 200))),
        el('td', {}, el('span', { class: 'bar', style: `width:${Math.max(p, 0.5) * 2}px` }), ` ${p}%`)))));
  };
  $('#s-dd').replaceChildren(table(1), table(2));
}

async function switchSource() {
  buildSource();
  renderDDOdds();
  refreshSeasonSummaries();
  showBanner('');
  $('#s-seasons').replaceChildren(el('p', { class: 'muted' }, 'Loading seasons…'));
  resetUnlimitedQueue();
  await loadSeasonList();
  renderDDOdds();
}

function initSettings() {
  const url = $('#s-url');
  url.value = settings.cluebaseUrl;
  for (const radio of $$('input[name=source]')) {
    radio.checked = radio.value === settings.source;
    radio.addEventListener('change', () => {
      settings.source = radio.value;
      settings.seasons = [];
      saveSettings();
      switchSource();
    });
  }
  url.addEventListener('change', () => {
    settings.cluebaseUrl = url.value.trim() || DEFAULT_CLUEBASE_URL;
    saveSettings();
    if (settings.source === 'cluebase') switchSource();
  });
  $('#s-test').addEventListener('click', async () => {
    const out = $('#s-test-result');
    out.textContent = 'Testing…';
    try {
      const test = new CluebaseSource(url.value || DEFAULT_CLUEBASE_URL);
      const clue = await test.get('/clues/random?limit=1');
      out.textContent = `Connected. Sample category: ${clue[0]?.category ?? 'unknown'}.`;
    } catch (err) {
      out.textContent = friendlyError(err);
    }
  });
  const timerOn = $('#s-timer-on');
  const timerSecs = $('#s-timer-seconds');
  timerOn.checked = settings.timer.on;
  timerSecs.value = settings.timer.seconds;
  timerSecs.disabled = !settings.timer.on;
  timerOn.addEventListener('change', () => {
    settings.timer.on = timerOn.checked;
    timerSecs.disabled = !timerOn.checked;
    saveSettings();
  });
  timerSecs.addEventListener('change', () => {
    const n = Math.round(Number(timerSecs.value));
    settings.timer.seconds = Number.isFinite(n) ? Math.min(120, Math.max(3, n)) : 15;
    timerSecs.value = settings.timer.seconds;
    saveSettings();
  });
  $('#s-all').addEventListener('click', () => setSeasons(seasonList.map((s) => s.id)));
  $('#s-none').addEventListener('click', () => {
    // At least one season has to stay selected; keep the most recent.
    if (seasonList.length) setSeasons([seasonList.at(-1).id]);
  });
  $('#s-modern').addEventListener('click', () => setSeasons(seasonList.map((s) => s.id).filter((id) => id >= 18)));
}

// ------------------------------------------------------------------ views

let currentView = null;

function showView(name) {
  if (currentView === 'unlimited' && name !== 'unlimited') u.card?.pause();
  if (currentView && currentView !== 'unlimited' && name === 'unlimited') u.card?.resume();
  currentView = name;
  settings.view = name;
  saveSettings();
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  for (const t of $$('.tab')) t.setAttribute('aria-selected', String(t.dataset.view === name));
  if (name === 'unlimited' && !$('#u-stage').children.length) nextUnlimited();
  if (name === 'board') renderBoard();
}

async function init() {
  // 'local' was the earlier file-import source; the GitHub dataset replaces it.
  if (settings.source !== 'cluebase') settings.source = 'dataset';
  buildSource();
  initUnlimitedControls();
  initBoardControls();
  initSettings();
  renderDDOdds();
  renderUnlimitedScore();
  renderHistory();
  refreshSeasonSummaries();
  for (const t of $$('.tab')) t.addEventListener('click', () => showView(t.dataset.view));
  showView(settings.view);
  await loadSeasonList();
  renderDDOdds();
}

init();
