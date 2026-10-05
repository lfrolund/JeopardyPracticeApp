// IndexedDB storage for an imported dataset. Everything stays in this browser.
const DB_NAME = 'jeopardy-practice';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('seasons')) db.createObjectStore('seasons', { keyPath: 'season' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDataset({ bySeason, ddStats, files }) {
  const db = await open();
  const tx = db.transaction(['seasons', 'meta'], 'readwrite');
  tx.objectStore('seasons').clear();
  const seasons = [];
  for (const [season, clues] of bySeason) {
    tx.objectStore('seasons').put({ season, clues });
    seasons.push({ season, count: clues.length });
  }
  seasons.sort((a, b) => a.season - b.season);
  const meta = { seasons, ddStats, files, importedAt: new Date().toISOString() };
  tx.objectStore('meta').put(meta, 'meta');
  await done(tx);
  db.close();
  return meta;
}

export async function loadMeta() {
  try {
    const db = await open();
    const meta = await request(db.transaction('meta').objectStore('meta').get('meta'));
    db.close();
    return meta || null;
  } catch {
    return null;
  }
}

export async function loadSeason(season) {
  const db = await open();
  const row = await request(db.transaction('seasons').objectStore('seasons').get(season));
  db.close();
  return row ? row.clues : [];
}

export async function clearDataset() {
  const db = await open();
  const tx = db.transaction(['seasons', 'meta'], 'readwrite');
  tx.objectStore('seasons').clear();
  tx.objectStore('meta').clear();
  await done(tx);
  db.close();
}
