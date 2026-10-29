'use strict';
const VERSION = '1.0.0';
const DEFAULT_EMAIL = 'fabian.friberg@gmail.com'; // where backups go unless changed in the app

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
const STORES = ['entries', 'meta'];
let db;
let entries = new Map();
let meta = { id: 'meta', email: DEFAULT_EMAIL, lastBackup: null, hideInstall: false, startCount: 0 };

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('kingofthebaboy', 1);
    r.onupgradeneeded = () => { for (const s of STORES) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const store = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function loadAll() {
  entries = new Map((await req(store('entries').getAll())).map(o => [o.id, o]));
  const m = await req(store('meta').get('meta'));
  if (m) meta = { ...meta, ...m, email: m.email || DEFAULT_EMAIL };
}
async function putEntry(e) { entries.set(e.id, e); await req(store('entries', 'readwrite').put(e)); }
async function delEntry(id) { entries.delete(id); await req(store('entries', 'readwrite').delete(id)); }
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
const COPY_ICON = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h11v11H9z M5 15H4V4h11v1"/></svg>';
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
  return `${installTip()}
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
    <label class="field"><span>Total price (₱)</span><input name="total" type="number" inputmode="decimal" min="0" step="any" required value="${e.total}">
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
  return `<div class="btns" style="margin-top:0">
      <button class="btn" data-act="copySummary" data-month="${month}">${COPY_ICON}Copy ${fmtMonth(month)}</button>
      <button class="btn ghost" data-act="copySummary" data-month="all">${COPY_ICON}Copy all time</button></div>
    <p class="muted" style="margin:6px 4px 0"><small>Paste it in a chat. Pick another month under “By month”.</small></p>
    <h2>This month</h2>
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
        return `<tr class="${k === month ? 'sel' : ''}"><td><a href="#stats/${k}">${fmtMonth(k)}</a></td><td>${fmtChange(o.nBought - o.nSold)}</td>
          <td>${peso(o.sold)}</td><td>${peso(o.spent)}</td>
          <td class="${o.profit < 0 ? 'bad' : ''}">${peso(o.profit)}</td></tr>`; }).join('')}
    </table></div>
    <h2>By size</h2>
    <div class="card"><table><tr><th>Size</th><th>Bought</th><th>Sold</th></tr>${sizeRows}</table></div>`;
}

/* ---------- monthly summary (copied as text, to paste in a chat) ---------- */
// m is 'YYYY-MM', or 'all' for everything so far.
function monthSummary(m) {
  const t0 = today();
  const list = sorted().filter(e => m === 'all' || monthOf(e.date) === m);
  const t = totals(list);
  const bySize = kind => Object.entries(SIZES)
    .map(([k, label]) => [label, sum(list.filter(e => e.kind === kind && e.size === k), e => e.count)])
    .filter(([, n]) => n).map(([label, n]) => `${n} ${label}`).join(', ');
  const others = list.filter(e => e.kind === 'other');
  return [
    `King of Baboy — ${m === 'all' ? `All time (as of ${fmtDate(t0)})` : fmtMonth(m) + (m === monthOf(t0) ? ` (as of ${fmtDate(t0)})` : '')}`,
    '',
    `Sold: ${t.nSold} baboy, ${peso(t.sold)}${t.nSold ? ` (${bySize('sell')})` : ''}`,
    `Bought: ${t.nBought} baboy, ${peso(t.bought)}${t.nBought ? ` (${bySize('buy')})` : ''}`,
    `Feed: ${round2(t.kg)} kg, ${peso(t.feed)}`,
    `Gasolina: ${peso(t.gas)}`,
    `Other: ${peso(t.other)}${others.length ? ` (${others.map(e => `${e.what} ${peso(e.total)}`).join(', ')})` : ''}`,
    `Spent in total: ${peso(t.spent)}`,
    `Profit: ${peso(t.profit)}`,
    '',
    `Change in baboy: ${fmtChange(t.nBought - t.nSold)}`,
    `Baboy now: ${onHand()}`,
  ].join('\n');
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Summary copied — paste it in the chat');
  } catch {
    // No clipboard access: show the text so it can be copied by hand.
    openSheet(`<h3>Monthly summary</h3><textarea rows="14" readonly>${esc(text)}</textarea>
      <p><small>Select all of the text and copy it.</small></p>`);
    setTimeout(() => { const t = $('#sheet textarea'); t.focus(); t.select(); }, 60);
  }
}

/* ---------- page: backup / settings ---------- */
function pageSettings() {
  setHeader('Export & settings');
  const age = meta.lastBackup ? daysBetween(meta.lastBackup.slice(0, 10), today()) : null;
  UI.prepared = null;
  UI.after = async () => {
    UI.prepared = exportData();
    const est = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    const s = $('#storageInfo');
    if (s) s.textContent = `${persisted ? 'Storage is protected.' : 'Storage may be cleared by the phone if space runs low.'}${est ? ` Using ${(est.usage / 1048576).toFixed(1)} MB.` : ''}`;
  };
  return `<h2>Send export by e-mail</h2>
    <div class="card">
      <p class="muted"><b>${age === null ? 'No export made yet' : age === 0 ? 'Last export: today' : `Last export: ${age} day${age === 1 ? '' : 's'} ago`}</b></p>
      <label class="field"><span>Send exports to</span>
        <input id="email" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" value="${esc(meta.email)}" data-change="email"></label>
      <button class="btn block" data-act="sendBackup">Send export</button>
      <p><small>Pick Gmail (or another mail app) in the list that opens. The address above is copied — paste it into “To”.</small></p>
      <button class="btn ghost block" data-act="saveBackup">Save export file on this phone</button>
    </div>
    <h2>Import</h2>
    <div class="card"><p><small>Load an export file. This <b>replaces</b> everything currently in the app.</small></p>
      <label class="btn ghost block">Import from file<input type="file" accept=".txt,.json,text/plain,application/json" data-change="restore" hidden></label></div>
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

const exportData = () => JSON.stringify({
  app: 'king-of-the-baboy', format: 1, exportedAt: new Date().toISOString(),
  startCount: meta.startCount || 0, entries: [...entries.values()],
});
// Backups use .txt because Android's share sheet refuses .json files.
const backupFile = () => new File([UI.prepared], `kingofbaboy-export-${today()}.txt`, { type: 'text/plain' });

function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function backupDone() {
  meta.lastBackup = new Date().toISOString();
  await saveMeta();
  render();
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return alert('This is not a valid export file.'); }
  if (data?.app !== 'king-of-the-baboy') return alert('This is not a King of Baboy export file.');
  const when = new Date(data.exportedAt).toLocaleString('en-PH');
  if (!confirm(`Import data exported on ${when}?\n\n${data.entries.length} entries.\n\nEverything currently in the app will be REPLACED.`)) return;
  const t = db.transaction(STORES, 'readwrite');
  t.objectStore('entries').clear();
  for (const e of data.entries) t.objectStore('entries').put(e);
  meta.lastBackup = data.exportedAt;
  meta.startCount = data.startCount || 0;
  t.objectStore('meta').put(meta);
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  await loadAll();
  toast('Import done ✓');
  go('#log');
  render();
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
  sendBackup: () => {
    const email = $('#email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { toast('Enter a valid e-mail address first'); $('#email').focus(); return; }
    if (email !== meta.email) { meta.email = email; saveMeta(); }
    if (!UI.prepared) { toast('Preparing export… try again in a moment'); return; }
    const file = backupFile();
    navigator.clipboard?.writeText(email).catch(() => {});
    if (navigator.canShare?.({ files: [file] })) {
      toast(`Address copied: ${email}`, 4000);
      navigator.share({ files: [file], title: `King of Baboy export ${today()}`, text: `King of Baboy export ${today()}` })
        .then(backupDone)
        .catch(err => { if (err.name !== 'AbortError') toast('Sharing failed: ' + err.message); });
    } else {
      // No share sheet (e.g. desktop): save the file and open a mail draft to attach it to.
      downloadFile(file);
      setTimeout(() => {
        location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('King of Baboy export ' + today())}`
          + `&body=${encodeURIComponent(`Please attach the file ${file.name} from Downloads.`)}`;
      }, 600);
      backupDone();
    }
  },
  copySummary: d => copyText(monthSummary(d.month)),
  saveBackup: () => {
    if (!UI.prepared) return toast('Preparing export… try again in a moment');
    downloadFile(backupFile()); toast('Export saved to Downloads');
  },
};

/* ---------- forms + inputs ---------- */
const FORMS = {
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
    await putEntry(e);
    closeSheet(); render();
    toast('Saved ✓');
  },
};

const CHANGE = {
  email: async el => { meta.email = el.value.trim(); await saveMeta(); },
  startCount: async el => { meta.startCount = Math.max(0, Math.round(num(el.value))); await saveMeta(); toast('Saved ✓'); },
  restore: async el => { const f = el.files[0]; el.value = ''; if (f) await importBackup(f); },
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

window.addEventListener('hashchange', () => { closeSheet(); render(); });
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); UI.installEvt = e; render(); });
// Re-render when the app comes back to the foreground, so "today" is always right.
document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#sheet').hidden) render(); });

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
  render();
})();
