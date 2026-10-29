'use strict';
const VERSION = '1.1.0';

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const round2 = n => Math.round(n * 100) / 100;
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const sum = (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0);
const peso = n => {
  n = round2(n || 0);
  const s = Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
  return (n < 0 ? '−₱' : '₱') + s;
};

/* ---------- dates (stored as local 'YYYY-MM-DD' strings) ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
const today = () => iso(new Date());
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const monthOf = s => s.slice(0, 7);
const thisMonth = () => monthOf(today());
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const fmtDate = s => {
  if (!s) return '—';
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (s.slice(0, 4) !== today().slice(0, 4)) opts.year = 'numeric';
  return parseDate(s).toLocaleDateString('en-PH', opts);
};
const fmtMonth = m => parseDate(m + '-01').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

/* ---------- database ---------- */
const STORES = ['entries', 'meta', 'outbox'];
let db;
let entries = new Map();
let meta = { id: 'meta', syncKey: '', syncUser: '', lastSync: null, hideInstall: false, startCount: 0 };

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kingofthebaboy', 2);
    r.onupgradeneeded = () => {
      for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function loadAll() {
  entries = new Map((await req(store('entries').getAll())).map(o => [o.id, o]));
  const m = await req(store('meta').get('meta'));
  if (m) meta = { ...meta, ...m };
}
async function putEntry(e) { entries.set(e.id, e); await req(store('entries', 'readwrite').put(e)); await enqueue('entries', 'put', e.id, e); }
async function delEntry(id) { entries.delete(id); await req(store('entries', 'readwrite').delete(id)); await enqueue('entries', 'delete', id); }
const saveMeta = () => req(store('meta', 'readwrite').put(meta));

/* ---------- domain ---------- */
const KIND = { buy: 'Bought baboy', sell: 'Sold baboy', feed: 'Bought feed', gas: 'Bought gasolina', other: 'Other expense' };
// "Tunga-tunga" is Bisaya for medium-sized.
const SIZES = { gamay: 'Gamay', tunga: 'Tunga-tunga', dako: 'Dako' };
// Line icons for the Log buttons (24×24, drawn with the button's text colour).
const PIG = '<circle cx="10" cy="13" r="7"/><path d="M5 8 4 4l4 2.5 M15 8l1-4-4 2.5"/><ellipse cx="10" cy="15" rx="3" ry="2"/>'
  + '<circle cx="7.5" cy="11" r=".6" fill="currentColor"/><circle cx="12.5" cy="11" r=".6" fill="currentColor"/>';
const ICON = Object.fromEntries(Object.entries({
  buy: PIG + '<path d="M20 15v6 M17 18h6"/>',
  sell: PIG + '<text x="16.5" y="22" font-size="8" font-weight="700" fill="currentColor" stroke="none">₱</text>',
  feed: '<path d="M7 7c0-2 2-3 5-3s5 1 5 3 M6 8h12l-1 12H7z M9.5 13h5 M9.5 16h5"/>',
  gas: '<path d="M5 4h9v16H5z M5 10h9 M14 8h2l3 3v7a1.5 1.5 0 0 1-3 0v-3h-2"/>',
  other: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z M9 8h6 M9 12h6 M9 16h3"/>',
}).map(([k, d]) => [k, `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`]));
// +3 / −2 / ±0 for a change in the number of baboy.
const fmtChange = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
const sorted = () => [...entries.values()].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
const onHand = () => (meta.startCount || 0) + sum([...entries.values()], e => e.kind === 'buy' ? e.count : e.kind === 'sell' ? -e.count : 0);

function totals(list) {
  const t = { sold: 0, bought: 0, feed: 0, gas: 0, other: 0, nSold: 0, nBought: 0, kg: 0 };
  for (const e of list) {
    if (e.kind === 'sell') { t.sold += e.total; t.nSold += e.count; }
    if (e.kind === 'buy') { t.bought += e.total; t.nBought += e.count; }
    if (e.kind === 'feed') { t.feed += e.total; t.kg += e.kilos; }
    if (e.kind === 'gas') t.gas += e.total;
    if (e.kind === 'other') t.other += e.total;
  }
  t.spent = t.bought + t.feed + t.gas + t.other;
  t.profit = t.sold - t.spent;
  return t;
}

/* ---------- UI plumbing ---------- */
const view = $('#view');
const UI = { lastHash: null, after: null, backHref: null, installEvt: null, prepared: null, showAll: false };

function setHeader(title, back) {
  $('#title').textContent = title;
  UI.backHref = back || null;
  $('#back').hidden = !back;
}
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
function openSheet(html) {
  const s = $('#sheet');
  s.innerHTML = `<div class="sheet-bg" data-act="closeSheet"></div><div class="sheet-card">${html}</div>`;
  s.hidden = false;
}
function closeSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }
const go = hash => { location.hash = hash; };
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const PAGES = {
  log: () => pageLog(),
  stats: a => pageStats(a[0] || thisMonth()),
  settings: () => pageSettings(),
};

function render() {
  const hash = location.hash.slice(1) || 'log';
  const [name, ...args] = hash.split('/').map(decodeURIComponent);
  const page = PAGES[name] ? name : 'log';
  document.querySelectorAll('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === page));
  UI.after = null;
  view.innerHTML = PAGES[page](args);
  if (UI.lastHash !== hash) { window.scrollTo(0, 0); UI.lastHash = hash; }
  if (UI.after) UI.after();
}

/* ---------- page: log ---------- */
function installTip() {
  if (isStandalone() || meta.hideInstall) return '';
  return `<div class="card tip"><b>Add this app to your home screen</b>
    <p>${isIOS() ? 'In Safari tap the Share button, then “Add to Home Screen”.' : 'In Chrome tap the ⋮ menu, then “Install app” or “Add to Home screen”.'}
    Then always open it from the home screen icon.</p>
    <div class="btns">${UI.installEvt ? '<button class="btn" data-act="install">Install now</button>' : ''}
    <button class="btn ghost" data-act="hideInstall">OK, got it</button></div></div>`;
}

function entryRow(e) {
  const what = e.kind === 'feed' ? `${e.kilos} kg feed <small>· ${peso(e.total / e.kilos)}/kg</small>`
    : e.kind === 'gas' ? 'Gasolina'
    : e.kind === 'other' ? esc(e.what)
    : `${e.count} ${SIZES[e.size]} baboy <small>· ${peso(e.total / e.count)} each</small>`;
  return `<div class="item" data-act="editEntry" data-id="${e.id}" style="cursor:pointer">
    <div class="item-main"><span class="kind ${e.kind}">${KIND[e.kind]}</span><b>${what}</b>
    ${e.notes ? `<small>${esc(e.notes)}</small>` : ''}</div>
    <span class="amt ${e.kind === 'sell' ? 'ok' : ''}">${e.kind === 'sell' ? '+' : '−'}${peso(e.total)}</span></div>`;
}

function pageLog() {
  setHeader('King of Baboy');
  const list = sorted();
  const shown = UI.showAll ? list : list.slice(0, 50);
  const m = totals(list.filter(e => monthOf(e.date) === thisMonth()));
  let html = '', day = null;
  for (const e of shown) {
    if (e.date !== day) {
      if (day) html += '</div>';
      day = e.date;
      html += `<div class="day">${e.date === today() ? 'Today' : fmtDate(e.date)}</div><div class="list">`;
    }
    html += entryRow(e);
  }
  if (day) html += '</div>';
  return `${syncPrompt()}${installTip()}
    <div class="actions">
      ${['buy', 'sell', 'feed', 'gas', 'other'].map(k =>
        `<button class="btn ${k}" data-act="newEntry" data-kind="${k}">${ICON[k]}${KIND[k]}</button>`).join('')}
    </div>
    <div class="card"><div class="facts">
      <div><small>Baboy now</small><b class="big">${onHand()}</b></div>
      <div><small>Profit ${fmtMonth(thisMonth()).split(' ')[0]}</small><b class="big ${m.profit < 0 ? 'bad' : 'ok'}">${peso(m.profit)}</b></div>
    </div></div>
    ${html || '<div class="list"><div class="empty">Nothing logged yet. Use the buttons above.</div></div>'}
    ${list.length > shown.length ? `<button class="btn ghost block" data-act="showAll">Show all ${list.length} entries</button>` : ''}`;
}

function entrySheet(kind, id) {
  const e = id ? entries.get(id) : { kind, date: today(), count: '', size: 'tunga', kilos: '', what: '', total: '', notes: '' };
  kind = e.kind;
  const sizeSeg = Object.entries(SIZES).map(([k, label]) =>
    `<label><input type="radio" name="size" value="${k}" ${e.size === k ? 'checked' : ''}><span>${label}</span></label>`).join('');
  openSheet(`<form data-form="entry" data-kind="${kind}" data-id="${id || ''}">
    <h3>${KIND[kind]}</h3>
    ${kind === 'feed' ? `<label class="field"><span>Kilos</span><input name="kilos" type="number" inputmode="decimal" min="0" step="any" required value="${e.kilos}"></label>`
      : kind === 'gas' ? ''
      : kind === 'other' ? `<label class="field"><span>What was it for?</span><input name="what" required autocomplete="off" value="${esc(e.what)}"></label>`
      : `<label class="field"><span>Number of baboy</span><input name="count" type="number" inputmode="numeric" min="1" step="1" required value="${e.count}"></label>
         <span class="field" style="display:block"><b style="font-size:14px">Size</b></span>
         <div class="seg">${sizeSeg}</div>`}
    <label class="field"><span>Total price (₱)</span><input name="total" type="number" inputmode="numeric" min="10" step="10" required value="${e.total}">
      <small id="unitPrice"></small></label>
    <label class="field"><span>Date</span><input name="date" type="date" required value="${e.date}"></label>
    <label class="field"><span>Notes (optional)</span><input name="notes" autocomplete="off" value="${esc(e.notes)}"></label>
    <button class="btn block" type="submit">Save</button>
    ${id ? `<button class="btn danger block" type="button" data-act="deleteEntry" data-id="${id}">Delete</button>` : ''}
  </form>`);
  updateUnitPrice($('#sheet form'));
  if (!id) setTimeout(() => $('#sheet input')?.focus(), 60);
}
function updateUnitPrice(f) {
  const total = num(f.total.value);
  const k = f.dataset.kind;
  if (k === 'gas' || k === 'other') return;
  const per = num((k === 'feed' ? f.kilos : f.count).value);
  $('#unitPrice').textContent = total > 0 && per > 0 ? `= ${peso(total / per)} per ${k === 'feed' ? 'kg' : 'baboy'}` : '';
}

/* ---------- page: stats ---------- */
function pageStats(month) {
  setHeader('Stats');
  const all = [...entries.values()];
  const t = totals(all), m = totals(all.filter(e => monthOf(e.date) === thisMonth()));
  const tile = (label, v, cls = '') => `<div class="tile"><small>${label}</small><b class="${cls}">${v}</b></div>`;
  const months = [];
  const first = all.map(e => monthOf(e.date)).sort()[0] || thisMonth();
  for (let k = thisMonth(); k >= first; k = addMonths(k, -1)) months.push(k);
  const sizeRows = Object.entries(SIZES).map(([k, label]) => {
    const b = all.filter(e => e.kind === 'buy' && e.size === k), s = all.filter(e => e.kind === 'sell' && e.size === k);
    const nb = sum(b, e => e.count), ns = sum(s, e => e.count);
    return `<tr><td>${label}</td><td>${nb}${nb ? `<br><small>${peso(sum(b, e => e.total) / nb)} each</small>` : ''}</td>
      <td>${ns}${ns ? `<br><small>${peso(sum(s, e => e.total) / ns)} each</small>` : ''}</td></tr>`;
  }).join('');
  return `<h2>This month</h2>
    <div class="tiles">${tile('Sold', peso(m.sold))}${tile('Spent', peso(m.spent))}${tile('Profit', peso(m.profit), m.profit < 0 ? 'bad' : 'ok')}</div>
    <div class="card"><small>Baboy this month</small>
      <div class="big">${fmtChange(m.nBought - m.nSold)} <small>(${m.nBought} bought, ${m.nSold} sold)</small></div></div>
    <h2>All time</h2>
    <div class="tiles">${tile('Sold', peso(t.sold))}${tile('Spent', peso(t.spent))}${tile('Profit', peso(t.profit), t.profit < 0 ? 'bad' : 'ok')}</div>
    <div class="card"><div class="facts">
      <div><small>Baboy now</small><b>${onHand()}</b></div>
      <div><small>Baboy bought / sold</small><b>${t.nBought} / ${t.nSold}</b></div>
      <div><small>Feed bought</small><b>${round2(t.kg)} kg</b></div>
      <div><small>Average feed price</small><b>${t.kg ? peso(t.feed / t.kg) + '/kg' : '—'}</b></div>
      <div><small>Spent on feed</small><b>${peso(t.feed)}</b></div>
      <div><small>Spent on gasolina</small><b>${peso(t.gas)}</b></div>
      <div><small>Other expenses</small><b>${peso(t.other)}</b></div>
    </div><p><small>Profit = money from selling baboy, minus money spent on baboy, feed, gasolina and other expenses.</small></p></div>
    <h2>By month</h2>
    <div class="card"><table><tr><th>Month</th><th>Baboy</th><th>Sold</th><th>Spent</th><th>Profit</th></tr>
      ${months.map(k => { const o = totals(all.filter(e => monthOf(e.date) === k));
        return `<tr><td>${fmtMonth(k)}</td><td>${fmtChange(o.nBought - o.nSold)}</td>
          <td>${peso(o.sold)}</td><td>${peso(o.spent)}</td>
          <td class="${o.profit < 0 ? 'bad' : ''}">${peso(o.profit)}</td></tr>`; }).join('')}
    </table></div>
    <h2>By size</h2>
    <div class="card"><table><tr><th>Size</th><th>Bought</th><th>Sold</th></tr>${sizeRows}</table></div>`;
}

/* ---------- sync with the Google Sheet ---------- */
// Every change is saved on the phone first and put in the 'outbox' queue. The queue is sent to
// the sheet in the background whenever there is internet, so a bad connection never slows the app.
const SYNC_URL = 'https://script.google.com/macros/s/AKfycbxirHkuj8XboiE062f8bNiOBo4W332M0Oje0RjVP6KSqI5r2fcltbeGKYdzxeX91smNbA/exec'; // the Apps Script web app URL (…/exec)
const SYNC_APP = 'king-of-baboy';
const SYNCED = ['entries', 'settings'];
const Sync = { busy: false, timer: null, error: null, pending: 0 };

async function enqueue(storeName, op, id, data = null) {
  if (!SYNCED.includes(storeName)) return;
  await req(store('outbox', 'readwrite').put({ id: `${storeName}|${id}`, store: storeName, op, recId: id, data, ts: Date.now() }));
  scheduleSync();
}
const scheduleSync = (ms = 1500) => { clearTimeout(Sync.timer); Sync.timer = setTimeout(() => guard(syncNow)(), ms); };

async function syncPost(body) {
  // A plain-text body keeps this a "simple" request, which Apps Script accepts from other sites.
  const r = await fetch(SYNC_URL, { method: 'POST', body: JSON.stringify({ app: SYNC_APP, key: meta.syncKey, ...body }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Sync failed');
  if (j.user && j.user !== meta.syncUser) { meta.syncUser = j.user; await saveMeta(); }
  return j;
}

async function syncNow() {
  Sync.pending = await req(store('outbox').count());
  if (!SYNC_URL || !meta.syncKey || Sync.busy || !Sync.pending || !navigator.onLine) return updateSyncInfo();
  Sync.busy = true;
  try {
    const items = (await req(store('outbox').getAll())).slice(0, 300);
    await syncPost({ action: 'push', ops: items.map(i => ({ store: i.store, op: i.op, id: i.recId, data: i.data })) });
    for (const i of items) {
      // keep an item that was changed again while it was being sent
      const cur = await req(store('outbox').get(i.id));
      if (cur && cur.ts === i.ts) await req(store('outbox', 'readwrite').delete(i.id));
    }
    meta.lastSync = new Date().toISOString();
    await saveMeta();
    Sync.error = null;
  } catch (err) {
    Sync.error = err.message;
    scheduleSync(30000);
  } finally {
    Sync.busy = false;
  }
  Sync.pending = await req(store('outbox').count());
  if (Sync.pending && !Sync.error) scheduleSync(200);
  updateSyncInfo();
}

// A setup link (…/#setup/<secret code>) switches sync on for this phone.
async function handleSetupLink() {
  const m = location.hash.match(/^#setup\/(.+)$/);
  if (!m) return false;
  meta.syncKey = decodeURIComponent(m[1]);
  await saveMeta();
  history.replaceState(null, '', location.pathname);
  await queueEverything();
  toast('Sync is on ✓');
  return true;
}

function syncInfoHtml() {
  if (!SYNC_URL) return '<p><b>Sync is not available yet.</b></p>';
  if (!meta.syncKey) return syncSetupForm();
  const last = meta.lastSync ? new Date(meta.lastSync).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  return `<p class="${Sync.pending ? '' : 'ok'}"><b>${Sync.pending ? `${Sync.pending} change${Sync.pending === 1 ? '' : 's'} waiting to be sent` : 'Everything is synced ✓'}</b></p>
    ${Sync.pending && !navigator.onLine ? '<p><small>No internet right now. They will be sent automatically.</small></p>' : ''}
    ${Sync.error ? `<p class="bad"><small>Last try failed: ${esc(Sync.error)}. Trying again soon.</small></p>` : ''}
    <p><small>${meta.syncUser ? `Synced as ${esc(meta.syncUser)} · ` : ''}Last synced: ${last}</small></p>`;
}
function updateSyncInfo() {
  const el = $('#syncInfo');
  if (el) el.innerHTML = syncInfoHtml();
}
function syncSetupForm() {
  return `<form data-form="syncSetup">
    <p><b>Connect to the sheet</b></p>
    <p><small>Enter the password you got. You only do this once.</small></p>
    <label class="field"><input name="code" type="password" autocomplete="current-password" autocapitalize="none" placeholder="Password" required></label>
    <button class="btn block" type="submit">Connect</button></form>`;
}
// Shown at the top of the main page until sync is connected.
const syncPrompt = () => (SYNC_URL && !meta.syncKey ? `<div class="card tip">${syncSetupForm()}</div>` : '');

async function connectSync(f) {
  const code = new FormData(f).get('code').trim();
  if (!code) return;
  if (!navigator.onLine) return alert('Connect to the internet first.');
  const before = meta.syncKey;
  meta.syncKey = code;
  let res;
  try {
    res = await syncPost({ action: 'pull' });
  } catch (err) {
    meta.syncKey = before;
    return alert(err.message === 'wrong secret code' ? 'Wrong password. Check it and try again.' : `Could not connect: ${err.message}`);
  }
  await saveMeta();
  // A new or reset phone gets its records back from the sheet.
  if (!hasLocalData()) await applyPulled(res.data);
  await queueEverything();
  toast(`Connected as ${res.user} ✓`);
  render();
}
function syncCard() {
  const on = SYNC_URL && meta.syncKey;
  return `<h2>Sync with the sheet</h2>
    <div class="card"><div id="syncInfo">${syncInfoHtml()}</div>
      ${on ? `<button class="btn block" data-act="syncNow">Sync now</button>
      <button class="btn ghost block" data-act="loadFromSheet">Load everything from the sheet</button>
      <p><small>Only needed on a new phone. It replaces what is on this phone.</small></p>` : ''}
    </div>`;
}

// Replace the given stores on this phone with what the sheet has.
async function replaceFromSheet(stores, data) {
  const t = db.transaction(STORES, 'readwrite');
  t.objectStore('outbox').clear();
  for (const s of stores) {
    t.objectStore(s).clear();
    for (const o of data[s] || []) t.objectStore(s).put(o);
  }
  t.objectStore('meta').put(meta);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
}

async function queueEverything() {
  for (const e of entries.values()) await enqueue('entries', 'put', e.id, e);
  await enqueue('settings', 'put', 'startCount', { id: 'startCount', value: meta.startCount || 0 });
}

const hasLocalData = () => entries.size > 0;
async function applyPulled(data) {
  meta.startCount = (data.settings || []).find(x => x.id === 'startCount')?.value || 0;
  await replaceFromSheet(['entries'], data);
  await loadAll();
}

async function loadFromSheet() {
  if (!navigator.onLine) return toast('No internet right now');
  toast('Loading from the sheet…', 15000);
  const { data } = await syncPost({ action: 'pull' });
  if (!confirm(`Load ${(data.entries || []).length} entries from the sheet?\n\nEverything on this phone will be REPLACED.`)) return;
  await applyPulled(data);
  toast('Loaded ✓');
  go('#log');
  render();
}

/* ---------- page: sync / settings ---------- */
function pageSettings() {
  setHeader('Sync & settings');
  UI.after = async () => {
    Sync.pending = await req(store('outbox').count());
    updateSyncInfo();
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    const s = $('#storageInfo');
    if (s) s.textContent = `${persisted ? 'Storage is protected.' : 'Storage may be cleared by the phone if space runs low.'}${est ? ` Using ${(est.usage / 1048576).toFixed(1)} MB.` : ''}`;
  };
  return `${syncCard()}
    <h2>Settings</h2>
    <div class="card">
      <label class="field"><span>Baboy you had before using the app</span>
        <input type="number" inputmode="numeric" min="0" step="1" value="${meta.startCount || 0}" data-change="startCount"></label>
    </div>
    <h2>App</h2>
    <div class="card">
      ${isStandalone() ? '<p class="ok">Installed on home screen ✓</p>'
        : `<p><b>Not installed yet.</b> ${isIOS() ? 'In Safari tap Share → “Add to Home Screen”.' : 'In Chrome tap ⋮ → “Install app”.'}</p>
           ${UI.installEvt ? '<button class="btn block" data-act="install">Install now</button>' : ''}`}
      <p><small id="storageInfo"></small></p>
      <p><small>${entries.size} entries · version ${VERSION}</small></p>
    </div>`;
}

/* ---------- actions (buttons with data-act) ---------- */
const ACT = {
  back: () => (UI.backHref ? go(UI.backHref) : history.back()),
  closeSheet,
  install: async () => { if (UI.installEvt) { UI.installEvt.prompt(); UI.installEvt = null; render(); } },
  hideInstall: async () => { meta.hideInstall = true; await saveMeta(); render(); },
  newEntry: d => entrySheet(d.kind),
  editEntry: d => entrySheet(null, d.id),
  showAll: () => { UI.showAll = true; render(); },
  deleteEntry: async d => {
    if (!confirm('Delete this entry?')) return;
    await delEntry(d.id); closeSheet(); render();
  },
  syncNow: async () => { Sync.error = null; await syncNow(); toast(Sync.error ? 'Sync failed — will try again' : Sync.pending ? 'Still sending…' : 'Synced ✓'); },
  loadFromSheet: () => loadFromSheet(),
};

/* ---------- forms + inputs ---------- */
const FORMS = {
  syncSetup: f => connectSync(f),
  entry: async f => {
    const fd = new FormData(f);
    const kind = f.dataset.kind;
    const e = {
      ...(f.dataset.id ? entries.get(f.dataset.id) : { id: uid(), kind, createdAt: Date.now() }),
      date: fd.get('date'), total: round2(num(fd.get('total'))), notes: (fd.get('notes') || '').trim(),
    };
    if (kind === 'feed') {
      e.kilos = round2(num(fd.get('kilos')));
      if (e.kilos <= 0) return alert('Enter the number of kilos.');
    } else if (kind === 'other') {
      e.what = (fd.get('what') || '').trim();
      if (!e.what) return alert('Write what the expense was for.');
    } else if (kind === 'gas') {
      // only the cost is recorded
    } else {
      e.count = Math.round(num(fd.get('count')));
      e.size = fd.get('size');
      if (e.count <= 0) return alert('Enter the number of baboy.');
      if (!e.size) return alert('Choose a size.');
    }
    if (e.total <= 0) return alert('Enter the total price.');
    if (e.total % 10) return alert('Prices are in whole ₱10s.');
    await putEntry(e);
    closeSheet(); render();
    toast('Saved ✓');
  },
};

const CHANGE = {
  startCount: async el => {
    meta.startCount = Math.max(0, Math.round(num(el.value)));
    await saveMeta();
    await enqueue('settings', 'put', 'startCount', { id: 'startCount', value: meta.startCount });
    toast('Saved ✓');
  },
};

const guard = fn => (...a) => Promise.resolve(fn(...a)).catch(err => { console.error(err); alert('Something went wrong: ' + err.message); });

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !ACT[el.dataset.act]) return;
  e.preventDefault();
  guard(ACT[el.dataset.act])({ ...el.dataset }, el, e);
});
document.addEventListener('submit', e => {
  const f = e.target;
  if (!FORMS[f.dataset.form]) return;
  e.preventDefault();
  guard(FORMS[f.dataset.form])(f);
});
document.addEventListener('change', e => {
  const el = e.target;
  if (CHANGE[el.dataset.change]) guard(CHANGE[el.dataset.change])(el);
});
document.addEventListener('input', e => {
  if (e.target.form?.dataset.form === 'entry') updateUnitPrice(e.target.form);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

window.addEventListener('hashchange', async () => { closeSheet(); await handleSetupLink(); render(); });
window.addEventListener('online', () => scheduleSync(100));
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); UI.installEvt = e; render(); });
// Re-render when the app comes back to the foreground, so "today" is always right.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if ($('#sheet').hidden) render();
  scheduleSync(100);
});

// Offer the newer version as soon as the service worker has downloaded it.
function showUpdateBar() {
  if (document.getElementById('updateBar')) return;
  const b = document.createElement('button');
  b.id = 'updateBar';
  b.textContent = 'New version available — tap to update';
  b.addEventListener('click', () => location.reload());
  document.body.appendChild(b);
}
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'update-ready') showUpdateBar(); });

(async function init() {
  try {
    db = await openDB();
    await loadAll();
  } catch (err) {
    view.innerHTML = `<div class="card alert">Could not open storage: ${esc(err.message)}</div>`;
    return;
  }
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  await handleSetupLink();
  render();
  scheduleSync(500);
  setInterval(() => scheduleSync(0), 60000);
})();
