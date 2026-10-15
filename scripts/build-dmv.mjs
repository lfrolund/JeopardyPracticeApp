// Builds data/dmv.json, the California DMV written-test question bank, from
// github.com/Vishakadatta/ca-dmv-prep (MIT License) at a pinned commit.
//
//   node scripts/build-dmv.mjs [commit]
//
// The source keeps its questions and road-sign drawings in two browser scripts that
// assign window.QUESTIONS, window.TOPICS and window.SIGNS. They're evaluated here with
// a stand-in window object and written out as plain JSON the app can fetch.
import { writeFile } from 'node:fs/promises';
import vm from 'node:vm';

const REPO = 'Vishakadatta/ca-dmv-prep';
const COMMIT = process.argv[2] || '5641a1b173e1a2c5cf0ea29cbf111de627bb5aa2';
const OUT = new URL('../data/dmv.json', import.meta.url);

async function load(path) {
  const url = `https://raw.githubusercontent.com/${REPO}/${COMMIT}/${path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

const window = {};
vm.runInNewContext(await load('js/signs.js'), { window });
vm.runInNewContext(await load('js/questions.js'), { window });
const { TOPICS, QUESTIONS, SIGNS } = window;

// Explanations use <b> and <i> for emphasis and nothing else. Keep that, decode a few entities,
// and fail loudly if anything else shows up so the app never has to render raw HTML.
function cleanText(s, { emphasis = false } = {}) {
  const out = String(s)
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const tags = out.match(/<\/?[a-z][^>]*>/gi) || [];
  const bad = tags.filter((t) => !(emphasis && /^<\/?[bi]>$/i.test(t)));
  if (bad.length) throw new Error(`Unexpected markup ${bad[0]} in: ${out}`);
  return out;
}

const usedSigns = new Set(QUESTIONS.map((q) => q.sign).filter(Boolean));
const questions = QUESTIONS.map((q, i) => {
  if (!TOPICS.some((t) => t.k === q.t)) throw new Error(`Question ${i} has unknown topic ${q.t}`);
  if (q.sign && !SIGNS[q.sign]) throw new Error(`Question ${i} uses unknown sign ${q.sign}`);
  if (!(q.a >= 0 && q.a < q.c.length)) throw new Error(`Question ${i} has no valid answer`);
  if (/\bthis sign\b/i.test(q.q) && !q.sign) throw new Error(`Question ${i} refers to a sign it doesn't have`);
  return {
    topic: q.t,
    question: cleanText(q.q),
    choices: q.c.map((c) => cleanText(c)),
    answer: q.a,
    explanation: cleanText(q.e, { emphasis: true }),
    ...(q.sign ? { sign: q.sign } : {}),
  };
});

const data = {
  source: {
    repo: REPO,
    commit: COMMIT,
    license: 'MIT',
    copyright: 'Copyright (c) 2026 Vishaka Datta J',
    note: "Questions are written from the California Driver's Handbook (DL 600). They are practice questions, not the DMV's own test items.",
  },
  topics: TOPICS.map((t) => ({ key: t.k, name: t.name })),
  // The app shows signs as data-URI images, which need the SVG namespace the source leaves out.
  signs: Object.fromEntries([...usedSigns].sort().map((k) => [k, {
    name: SIGNS[k].name,
    svg: SIGNS[k].svg.replace(/^<svg(?![^>]*xmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"'),
  }])),
  questions,
};

await writeFile(OUT, `${JSON.stringify(data)}\n`);
console.log(`Wrote ${questions.length} questions in ${data.topics.length} topics with ${usedSigns.size} signs to data/dmv.json`);
