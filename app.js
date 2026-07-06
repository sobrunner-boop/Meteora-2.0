import { DEFAULT_MENU } from './menu.js';
import { loadState, saveState, exportJson, downloadText } from './storage.js';
import { TABLE_GROUPS, tableStatus } from './tables.js';
import { $, money, esc, toast, showView } from './ui.js';
import { repairState, buildDiagnosticsText } from './diagnostics.js';

const APP_VERSION = '1.4.0 Final';
const APP_CACHE_VERSION = 'v1-4-0-final';
const initialState = { version: APP_VERSION, menu: DEFAULT_MENU, orders: {}, tables: {}, history: [], cancellations: [], settings: {} };
function cloneDefaultState(){ return { version: APP_VERSION, menu: structuredClone(DEFAULT_MENU), orders: {}, tables: {}, history: [], cancellations: [], settings: {} }; }
let state = loadState(cloneDefaultState());
let currentTable = null;
let currentCategory = categories()[0];
let selectedDish = null;
let selectedQty = 1;
let editingDishNo = null;
let deferredInstallPrompt = null;
let lastBackupHint = null;
let lastRemovedLine = null;
let lastAddition = null;
let addDishLocked = false;
let menuLongPressTimer = null;
let menuLongPressTriggered = false;

function persist(){
  state.version = APP_VERSION;
  state.lastSavedAt = new Date().toISOString();
  const ok = saveState(state);
  updateStatusBadge();
  return ok;
}
function hasOpenOrders(){ return Object.values(state.orders || {}).some(items => Array.isArray(items) && items.length); }
function openTableNumbers(){ return Object.keys(state.orders || {}).filter(t => (state.orders[t] || []).length).sort((a,b)=>Number(a)-Number(b)); }
function openOrderPositionCount(){ return Object.values(state.orders || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.reduce((a,i)=>a+Number(i.qty||0),0) : 0), 0); }
function openOrdersTotal(){ return Object.keys(state.orders || {}).reduce((sum, t) => sum + orderTotal(t), 0); }
function reportSummaryLine(){
  const closed = todayClosedOrders().length;
  const open = openTableNumbers().length;
  return `${closed} geschlossene Tische · ${open} offene Tische · offen ${money(openOrdersTotal())}`;
}
function todayKey(){ return new Date().toISOString().slice(0,10); }
function timeKey(){ return new Date().toTimeString().slice(0,8).replaceAll(':','-'); }
function backupFilename(prefix='Meteora_Order_Backup'){ return `${prefix}_${todayKey()}_${timeKey()}.json`; }
function reportFilename(prefix='Meteora_Schichtbericht', ext='txt'){ return `${prefix}_${todayKey()}_${timeKey()}_${APP_CACHE_VERSION}.${ext}`; }
function diagnosticsFilename(){ return `Meteora_Systempruefung_${todayKey()}_${timeKey()}_${APP_CACHE_VERSION}.txt`; }
function testChecklistFilename(){ return `Meteora_Praxistest_${todayKey()}_${timeKey()}_${APP_CACHE_VERSION}.txt`; }
function readinessFilename(){ return `Meteora_RC_Freigabe_${todayKey()}_${timeKey()}_${APP_CACHE_VERSION}.txt`; }
function csvCell(value){ return `"${String(value ?? '').replaceAll('"','""')}"`; }
function csvLine(values){ return values.map(csvCell).join(';'); }
function exportBackup(){
  const openTables = Object.keys(state.orders || {}).filter(t => (state.orders[t] || []).length);
  const exportedAt = new Date().toISOString();
  state.settings ||= {};
  state.settings.lastBackupAt = exportedAt;
  state.settings.lastBackupOpenTables = openTables;
  state.version = APP_VERSION;
  exportJson({...state, exportedAt, appVersion: APP_VERSION, openTablesAtExport: openTables, openTotalAtExport: openOrdersTotal(), openPositionsAtExport: openOrderPositionCount(), lastShiftReportAtExport: state.settings?.lastShiftReportAt || null, lastShiftReportKindAtExport: state.settings?.lastShiftReportKind || null}, backupFilename());
  lastBackupHint = exportedAt;
  persist();
  toast(openTables.length ? `Backup exportiert (${openTables.length} offene Tische)` : 'Backup exportiert');
  updateStatusBadge();
}
function refreshOpenOrderWarning(){
  const box = $('openOrderWarning');
  if(!box) return;
  const open = openTableNumbers();
  const list = open.slice(0,8).join(', ') + (open.length > 8 ? ' …' : '');
  const total = openOrdersTotal();
  box.innerHTML = open.length
    ? `<b>Achtung:</b> ${open.length} offene Tische${list ? ` (${esc(list)})` : ''} · offen ${money(total)}. Vor dem Schließen der App Backup exportieren.`
    : 'Keine offenen Tische. Daten sind lokal gespeichert.';
  box.classList.toggle('warning', open.length > 0);
}

function refreshSystemHealthBox(){
  const box = $('systemHealthBox');
  if(!box) return;
  const report = state.settings?.lastStartupCheck || { changes: 0, notes: [] };
  const backupAt = state.settings?.lastBackupAt;
  const backupText = backupAt ? new Date(backupAt).toLocaleString('de-DE') : 'noch kein Backup in dieser Installation';
  const notes = (report.notes || []).slice(0, 4).map(note => `<li>${esc(note)}</li>`).join('');
  box.innerHTML = `<b>Systemprüfung</b><br>Datenprüfung: ${Number(report.changes || 0)} Korrektur(en)<br>Letztes Backup: ${esc(backupText)}${notes ? `<ul>${notes}</ul>` : '<br>Keine Auffälligkeiten beim Start.'}`;
  box.classList.toggle('warning', Number(report.changes || 0) > 0);
}

function updateStatusBadge(){
  const badge = $('statusBadge');
  if (!badge) return;
  const saved = state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'}) : '—';
  const online = navigator.onLine ? 'Online' : 'Offline';
  const openCount = openTableNumbers().length;
  const positionCount = openOrderPositionCount();
  const backupAt = lastBackupHint || state.settings?.lastBackupAt || null;
  const backupIsToday = backupAt?.slice(0,10) === todayKey();
  const backupHint = openCount && !backupIsToday ? ' · Backup heute empfohlen' : (openCount ? ' · Backup ok' : '');
  const backupSaved = backupAt ? ` · Backup ${new Date(backupAt).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}` : '';
  const reportAt = state.settings?.lastShiftReportAt || null;
  const reportKind = state.settings?.lastShiftReportKind ? ` ${state.settings.lastShiftReportKind}` : '';
  const reportSaved = reportAt?.slice(0,10) === todayKey() ? ` · Bericht${reportKind} ${new Date(reportAt).toLocaleTimeString('de-DE', {hour:'2-digit', minute:'2-digit'})}` : '';
  const startupChanges = Number(state.settings?.lastStartupCheck?.changes || 0);
  const repairHint = startupChanges ? ` · Datenprüfung ${startupChanges}` : ' · Datenprüfung ok';
  badge.textContent = `${online} · ${openCount} Tische/${positionCount} Pos. · gespeichert ${saved}${backupHint}${backupSaved}${reportSaved}${repairHint}`;
  badge.classList.toggle('offline', !navigator.onLine);
  const lastSaved = $('lastSavedText');
  if (lastSaved) lastSaved.textContent = state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleString('de-DE') : '—';
  refreshOpenOrderWarning();
  refreshSystemHealthBox();
}
function sanitizeOrderItem(item){
  if (!item || typeof item !== 'object') return null;
  const no = item.no ?? item.number;
  const name = item.name;
  if (no === undefined || !name) return null;
  return {
    lineId: item.lineId || newId('line'),
    no: String(no),
    name: String(name),
    cat: String(item.cat || item.category || 'Ohne Kategorie'),
    price: Math.max(0, Number(item.price) || 0),
    qty: Math.max(1, Number(item.qty) || 1),
    note: String(item.note || '').trim(),
    movedFrom: item.movedFrom ? String(item.movedFrom) : undefined,
    repeatedFrom: item.repeatedFrom ? String(item.repeatedFrom) : undefined
  };
}
function compactOrderLines(items){
  const result = [];
  (Array.isArray(items) ? items : []).forEach(raw => {
    const item = sanitizeOrderItem(raw);
    if (!item) return;
    const existing = result.find(line => sameOrderLine(line, item) && String(line.movedFrom || '') === String(item.movedFrom || ''));
    if (existing) existing.qty += item.qty;
    else result.push(item);
  });
  return result;
}
function validateImportedState(data){
  if (!data || typeof data !== 'object') throw new Error('Backup ist keine gültige JSON-Struktur');
  const next = { ...cloneDefaultState(), ...data };
  if (!Array.isArray(next.menu)) throw new Error('Speisekarte fehlt im Backup');
  if (!Array.isArray(next.history)) next.history = [];
  if (!Array.isArray(next.cancellations)) next.cancellations = [];
  if (!next.settings || typeof next.settings !== 'object' || Array.isArray(next.settings)) next.settings = {};
  if (!next.orders || typeof next.orders !== 'object' || Array.isArray(next.orders)) next.orders = {};
  if (!next.tables || typeof next.tables !== 'object' || Array.isArray(next.tables)) next.tables = {};
  next.menu = next.menu.filter(m => m && m.no !== undefined && m.name && m.cat).map(m => ({
    no: String(m.no),
    name: String(m.name),
    cat: String(m.cat),
    price: Math.max(0, Number(m.price) || 0),
    available: m.available !== false
  }));
  next.orders = Object.fromEntries(Object.entries(next.orders).map(([table, items]) => [String(table), compactOrderLines(items)]).filter(([,items]) => items.length));
  next.history = next.history.filter(o => o && Array.isArray(o.items)).map(o => {
    const items = compactOrderLines(o.items);
    return { ...o, id: o.id || newId('hist'), table: String(o.table || ''), guests: Math.max(0, Number(o.guests) || 0), items, total: items.reduce((s,i)=>s+i.qty*i.price,0), createdAt: o.createdAt || new Date().toISOString() };
  }).filter(o => o.table && o.items.length);
  if (!next.menu.length) throw new Error('Backup enthält keine gültigen Gerichte');
  return next;
}

function normalizeState(){
  state.menu ||= DEFAULT_MENU;
  state.orders ||= {};
  state.tables ||= {};
  state.history ||= [];
  state.cancellations ||= [];
  state.settings ||= {};
  repairState(state, DEFAULT_MENU);
  Object.keys(state.orders).forEach(table => {
    const compacted = compactOrderLines(state.orders[table]);
    if (compacted.length) state.orders[table] = compacted;
    else delete state.orders[table];
  });
  state.history = (state.history || []).map(o => {
    if (!o || !Array.isArray(o.items)) return null;
    const items = compactOrderLines(o.items);
    return items.length ? {...o, items, total: items.reduce((s,i)=>s+i.qty*i.price,0)} : null;
  }).filter(Boolean);
  state.settings ||= {};
  state.settings.favoriteDishes = Array.isArray(state.settings.favoriteDishes) ? [...new Set(state.settings.favoriteDishes.map(String))].slice(0, 12) : [];
  state.settings.recentDishes = Array.isArray(state.settings.recentDishes) ? [...new Set(state.settings.recentDishes.map(String))].slice(0, 6) : [];
  state.version = APP_VERSION;
  state.lastSavedAt ||= new Date().toISOString();
  saveState(state);
}
function installApp(){
  if (!deferredInstallPrompt) return toast('Installation über Browser-Menü möglich');
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.finally(() => { deferredInstallPrompt = null; });
}
function categories(){ return [...new Set(state.menu.map(i => i.cat))]; }
function newId(prefix='id'){ return crypto.randomUUID?.() || `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function normalizeText(value){ return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function sameOrderLine(a,b){ return String(a.no) === String(b.no) && String(a.note || '') === String(b.note || '') && Number(a.price) === Number(b.price); }

function rememberRecentDish(no){
  state.settings ||= {};
  const key = String(no);
  const recent = Array.isArray(state.settings.recentDishes) ? state.settings.recentDishes.filter(x => String(x) !== key) : [];
  recent.unshift(key);
  state.settings.recentDishes = recent.slice(0, 6);
}
function recentDishItems(){
  const recent = Array.isArray(state.settings?.recentDishes) ? state.settings.recentDishes : [];
  return recent.map(no => state.menu.find(m => String(m.no) === String(no) && m.available !== false)).filter(Boolean);
}
function clearRecentDishes(){
  state.settings ||= {};
  state.settings.recentDishes = [];
  persist();
  renderMenu();
  toast('Zuletzt-bestellt-Liste geleert');
}
function favoriteDishItems(){
  const favorites = Array.isArray(state.settings?.favoriteDishes) ? state.settings.favoriteDishes : [];
  return favorites.map(no => state.menu.find(m => String(m.no) === String(no) && m.available !== false)).filter(Boolean);
}
function isFavoriteDish(no){
  return Array.isArray(state.settings?.favoriteDishes) && state.settings.favoriteDishes.some(x => String(x) === String(no));
}
function toggleFavoriteDish(no){
  state.settings ||= {};
  const key = String(no);
  const favorites = Array.isArray(state.settings.favoriteDishes) ? state.settings.favoriteDishes.map(String) : [];
  if (favorites.includes(key)) {
    state.settings.favoriteDishes = favorites.filter(x => x !== key);
    toast('Favorit entfernt');
  } else {
    favorites.unshift(key);
    state.settings.favoriteDishes = favorites.slice(0, 12);
    toast('Favorit gespeichert');
  }
  persist();
  renderMenu();
}
function clearFavoriteDishes(){
  state.settings ||= {};
  state.settings.favoriteDishes = [];
  persist();
  renderMenu();
  toast('Favoriten geleert');
}
function resetMenuFilters(){
  const search = $('dishSearch');
  if (search) search.value = '';
  state.settings ||= {};
  state.settings.lastDishSearch = '';
  currentCategory = categories()[0];
  renderCategories();
  renderMenu();
  persist();
  toast('Speisekarte zurückgesetzt');
}
function addOrMergeOrderItem(table, item){
  const key = String(table);
  state.orders[key] ||= [];
  item.lineId ||= newId('line');
  const existing = state.orders[key].find(line => sameOrderLine(line, item));
  if (existing) {
    existing.lineId ||= newId('line');
    existing.qty += item.qty;
    lastAddition = { table: key, lineId: existing.lineId, no: existing.no, note: existing.note || '', qty: item.qty, merged: true };
    return { merged: true, item: existing };
  }
  state.orders[key].push(item);
  lastAddition = { table: key, lineId: item.lineId, no: item.no, note: item.note || '', qty: item.qty, merged: false };
  return { merged: false, item };
}
function orderTotal(table){ return (state.orders[String(table)] || []).reduce((s,i)=>s + i.qty * i.price, 0); }
function orderCount(table){ return (state.orders[String(table)] || []).reduce((s,i)=>s+i.qty, 0); }

function createRemovalRecord(item, reason='storno'){
  const id = newId('storno');
  const removedAt = new Date().toISOString();
  const record = { id, table: currentTable, item: {...item}, createdAt: removedAt, reason, restoredAt: null };
  state.cancellations ||= [];
  state.cancellations.unshift(record);
  lastRemovedLine = { table: currentTable, item: {...item}, removedAt, cancellationId: id };
}
function markLastRemovalRestored(){
  if (!lastRemovedLine?.cancellationId) return;
  const record = (state.cancellations || []).find(c => c.id === lastRemovedLine.cancellationId);
  if (record) record.restoredAt = new Date().toISOString();
}

function renderTables(filter='') {
  const onlyBusy = filter === '__busy__';
  const query = onlyBusy ? '' : filter.trim();
  $('tableList').innerHTML = TABLE_GROUPS.map(group => {
    const buttons = group.tables.filter(t => {
      const st = tableStatus(state, t);
      if (onlyBusy) return st.busy;
      return !query || String(t).includes(query);
    }).map(t => {
      const st = tableStatus(state, t);
      const meta = st.busy ? `${st.count} Pos. · ${money(orderTotal(t))}` : 'frei';
      const guests = st.guests ? ` · ${st.guests} Gäste` : '';
      return `<button class="tableBtn ${st.busy?'busy':''} ${st.mergedWith.length?'merged':''}" data-table="${t}"><b>${t}</b><small>${meta}${guests}</small></button>`;
    }).join('');
    if (!buttons) return '';
    return `<section><div class="groupTitle"><h2>${esc(group.name)}</h2><small>${group.tables.length} Tische</small></div><div class="tables">${buttons}</div></section>`;
  }).join('') || '<div class="empty">Kein Tisch gefunden.</div>';
}

function openTable(table){
  currentTable = String(table);
  state.orders[currentTable] ||= [];
  state.tables[currentTable] ||= { guests: 0, mergedWith: [] };
  currentCategory = categories()[0];
  $('dishSearch').value = state.settings?.lastDishSearch || '';
  showView('orderView');
  renderOrder(); renderCategories(); renderMenu(); persist();
}

function renderOrder(){
  const tableData = state.tables[currentTable] || { guests: 0, mergedWith: [] };
  const items = state.orders[currentTable] || [];
  $('orderTitle').textContent = `Tisch ${currentTable}`;
  $('guestBtn').textContent = `Gäste: ${tableData.guests || 0}`;
  const mergeInfo = tableData.mergedWith?.length ? `<p class="mergeInfo">Zusammen mit Tisch: ${tableData.mergedWith.map(esc).join(', ')}</p>` : '';
  $('splitTableBtn').disabled = !(tableData.mergedWith?.length);
  const restoreBtn = $('restoreLastBtn');
  if (restoreBtn) restoreBtn.disabled = !(lastRemovedLine && String(lastRemovedLine.table) === String(currentTable));
  $('billBox').innerHTML = mergeInfo + (items.length ? items.map((i, idx) => `
    <div class="orderLine">
      <div><b>${i.qty}× ${esc(i.no)}. ${esc(i.name)}</b><br><small>${money(i.price)}${i.note ? ' · '+esc(i.note) : ''}</small></div>
      <div class="lineActions"><button class="secondary" data-act="minus" data-idx="${idx}">−</button><b>${money(i.qty*i.price)}</b><button class="secondary" data-act="plus" data-idx="${idx}">+</button><button class="danger" data-act="remove" data-idx="${idx}">Storno</button></div>
    </div>`).join('') + `<div class="totalRow"><b>Gesamt</b><b>${money(orderTotal(currentTable))}</b></div>` : '<div class="empty">Noch keine Positionen auf diesem Tisch.</div>');
}


function renderCategories(){
  $('categoryTabs').innerHTML = categories().map(c => `<button class="${c===currentCategory && !$('dishSearch').value ? 'active':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
}
function renderMenu(){
  const q = normalizeText($('dishSearch').value);
  const favoriteNos = new Set((state.settings?.favoriteDishes || []).map(String));
  const items = state.menu.filter(m => {
    const visible = m.available !== false;
    const favoriteText = favoriteNos.has(String(m.no)) ? ' favorit favoriten star stern' : '';
    const matches = q ? normalizeText(`${m.no} ${m.name} ${m.cat}${favoriteText}`).includes(q) : m.cat === currentCategory;
    return visible && matches;
  });
  const favorites = !q ? favoriteDishItems() : [];
  const recent = !q ? recentDishItems().filter(m => !favoriteNos.has(String(m.no))) : [];
  const quickHint = 'Kurz tippen = Details · lang drücken = 1× direkt hinzufügen';
  const favoritesHtml = favorites.length ? `<div class="recentDishes favoriteDishes"><div class="recentHeader"><small>⭐ Favoriten</small><button class="miniBtn" data-clear-favorites="1">Leeren</button></div><p class="recentHint">${quickHint}</p><div>${favorites.map(m => `<button class="recentDishBtn favoriteChip" data-no="${esc(m.no)}">★ ${esc(m.no)}. ${esc(m.name)}</button>`).join('')}</div></div>` : '';
  const recentHtml = recent.length ? `<div class="recentDishes"><div class="recentHeader"><small>Zuletzt bestellt</small><button class="miniBtn" data-clear-recent="1">Leeren</button></div><p class="recentHint">${quickHint}</p><div>${recent.map(m => `<button class="recentDishBtn" data-no="${esc(m.no)}">${esc(m.no)}. ${esc(m.name)}</button>`).join('')}</div></div>` : '';
  const rows = items.map(m => `<div class="dishRow"><button class="dishBtn" data-no="${esc(m.no)}"><span><b>${esc(m.no)}. ${esc(m.name)}</b><small>${esc(m.cat)} · ${money(m.price)}</small></span><b>+</b></button><button class="favoriteBtn ${isFavoriteDish(m.no) ? 'active' : ''}" data-favorite-no="${esc(m.no)}" aria-label="Favorit umschalten">${isFavoriteDish(m.no) ? '★' : '☆'}</button></div>`).join('');
  $('menuList').innerHTML = favoritesHtml + recentHtml + (rows || '<div class="empty">Kein verfügbares Gericht gefunden.</div>');
}

function openDish(no){
  selectedDish = state.menu.find(m => String(m.no) === String(no));
  selectedQty = 1;
  if (!selectedDish || selectedDish.available === false) return toast('Gericht ist nicht verfügbar');
  $('dishTitle').textContent = `${selectedDish.no}. ${selectedDish.name}`;
  $('dishMeta').textContent = `${selectedDish.cat} · ${money(selectedDish.price)}`;
  $('dishNote').value = '';
  renderQty(); $('dishDialog').showModal();
}
function renderQty(){ $('qtyPicker').innerHTML = [1,2,3,4,5,6,7,8,9,10].map(n => `<button type="button" class="${n===selectedQty?'active':''}" data-qty="${n}">${n}</button>`).join(''); }
function appendQuickNote(note){
  const field = $('dishNote');
  const current = field.value.trim();
  if (!current) field.value = note;
  else if (!current.toLowerCase().includes(note.toLowerCase())) field.value = `${current}; ${note}`;
  field.focus();
}
function directAddDish(no){
  if (!currentTable) return toast('Bitte zuerst Tisch öffnen');
  const dish = state.menu.find(m => String(m.no) === String(no));
  if (!dish || dish.available === false) return toast('Gericht ist nicht verfügbar');
  if (addDishLocked) return toast('Bitte kurz warten – Eingabe wird verarbeitet');
  addDishLocked = true;
  setTimeout(() => { addDishLocked = false; }, 450);
  const result = addOrMergeOrderItem(currentTable, { ...dish, qty: 1, note: '', lineId: newId('line') });
  rememberRecentDish(dish.no);
  persist();
  renderOrder();
  renderTables($('tableSearch').value);
  renderMenu();
  toast(result.merged ? '1× Menge erhöht' : '1× direkt hinzugefügt');
}

function addDish(){
  if (!selectedDish || !currentTable) return;
  if (addDishLocked) return toast('Bitte kurz warten – Eingabe wird verarbeitet');
  addDishLocked = true;
  setTimeout(() => { addDishLocked = false; }, 650);
  const note = $('dishNote').value.trim();
  const result = addOrMergeOrderItem(currentTable, { ...selectedDish, qty: selectedQty, note, lineId: newId('line') });
  rememberRecentDish(selectedDish.no);
  persist(); renderOrder(); renderTables($('tableSearch').value); toast(result.merged ? 'Menge erhöht' : 'Gericht hinzugefügt');
}
function undoLastLine(){
  const arr = state.orders[currentTable] || [];
  if (!arr.length) return toast('Keine Position zum Rückgängig machen');
  let idx = -1;
  let removeQty = 0;
  if (lastAddition && String(lastAddition.table) === String(currentTable)) {
    idx = arr.findIndex(i => (lastAddition.lineId && i.lineId === lastAddition.lineId) || (String(i.no) === String(lastAddition.no) && String(i.note || '') === String(lastAddition.note || '')));
    removeQty = lastAddition.qty || 0;
  }
  if (idx < 0) { idx = arr.length - 1; removeQty = arr[idx].qty; }
  const item = arr[idx];
  const removedItem = { ...item, qty: Math.min(removeQty || item.qty, item.qty) };
  if (!confirm(`Letzte Eingabe zurücknehmen?
${removedItem.qty}× ${item.name}`)) return;
  createRemovalRecord(removedItem, 'undo_last');
  if (item.qty > removedItem.qty) arr[idx].qty -= removedItem.qty;
  else arr.splice(idx, 1);
  lastAddition = null;
  persist(); renderOrder(); renderTables($('tableSearch').value); toast('Letzte Eingabe entfernt – Wiederherstellen möglich');
}
function restoreLastLine(){
  if (!lastRemovedLine || String(lastRemovedLine.table) !== String(currentTable)) return toast('Keine passende Position zum Wiederherstellen');
  addOrMergeOrderItem(currentTable, {...lastRemovedLine.item, lineId: lastRemovedLine.item.lineId || newId('line')});
  markLastRemovalRestored();
  lastRemovedLine = null;
  persist(); renderOrder(); renderTables($('tableSearch').value); renderStats(); toast('Position wiederhergestellt');
}
function updateLine(idx, delta){
  const arr = state.orders[currentTable] || []; if (!arr[idx]) return;
  if (delta < -100) {
    if (!confirm(`${arr[idx].qty}× ${arr[idx].name} wirklich stornieren?`)) return;
    createRemovalRecord(arr[idx], 'storno');
    arr.splice(idx, 1);
    toast('Position storniert');
  } else {
    arr[idx].qty += delta;
    if (arr[idx].qty <= 0) {
      createRemovalRecord({...arr[idx], qty: 1}, 'minus_to_zero');
      arr.splice(idx,1);
      toast('Position storniert');
    }
  }
  persist(); renderOrder(); renderTables($('tableSearch').value);
}

function receiptText(table=currentTable){
  const items = state.orders[String(table)] || [];
  const tableData = state.tables[String(table)] || { guests: 0, mergedWith: [] };
  const lines = [];
  lines.push('Restaurant Meteora');
  lines.push('Meteora Order');
  lines.push('');
  lines.push(`Rechnung Tisch ${table}`);
  if (tableData.guests) lines.push(`Gäste: ${tableData.guests}`);
  if (tableData.mergedWith?.length) lines.push(`Zusammen mit Tisch: ${tableData.mergedWith.join(', ')}`);
  lines.push(`Datum: ${new Date().toLocaleString('de-DE')}`);
  lines.push('--------------------------------');
  items.forEach(i => lines.push(`${i.qty}× ${i.no}. ${i.name}\n  ${money(i.price)} = ${money(i.qty * i.price)}${i.note ? '\n  Hinweis: '+i.note : ''}`));
  lines.push('--------------------------------');
  lines.push(`Gesamt: ${money(orderTotal(table))}`);
  lines.push('');
  lines.push('Danke für Ihren Besuch!');
  return lines.join('\n');
}

function openTablesText(){
  const open = openTableNumbers();
  const lines = ['Restaurant Meteora','Meteora Order',`Version ${APP_VERSION}`,'',`Offene Tische · ${new Date().toLocaleString('de-DE')}`,'--------------------------------'];
  if (!open.length) lines.push('Keine offenen Tische.');
  open.forEach(table => {
    const items = state.orders[table] || [];
    const guests = state.tables[table]?.guests || 0;
    lines.push('', `Tisch ${table}${guests ? ` · Gäste: ${guests}` : ''}`, `Summe: ${money(orderTotal(table))}`);
    items.forEach(i => lines.push(`  ${i.qty}× ${i.no}. ${i.name} · ${money(i.qty * i.price)}${i.note ? ' · '+i.note : ''}`));
  });
  lines.push('', '--------------------------------', `Offen gesamt: ${money(openOrdersTotal())}`);
  return lines.join('\n');
}
function exportOpenTablesTxt(){
  const open = openTableNumbers();
  if (!open.length) return toast('Keine offenen Tische für TXT-Export');
  downloadText(`Meteora_Offene_Tische_${todayKey()}_${timeKey()}_${APP_CACHE_VERSION}.txt`, openTablesText());
  toast('Offene Tische als TXT gespeichert');
}

function exportSystemDiagnostics(){
  const text = buildDiagnosticsText({
    state,
    version: APP_VERSION,
    openTables: openTableNumbers(),
    openPositions: openOrderPositionCount(),
    openTotal: money(openOrdersTotal()),
    lastSaved: state.lastSavedAt ? new Date(state.lastSavedAt).toLocaleString('de-DE') : '—'
  });
  downloadText(diagnosticsFilename(), text);
  toast('Systemprüfung exportiert');
}

function buildTestChecklistText(){
  const open = openTableNumbers();
  const lines = [
    'Restaurant Meteora',
    'Meteora Order – Praxistest-Checkliste',
    `Version ${APP_VERSION}`,
    '',
    `Erstellt: ${new Date().toLocaleString('de-DE')}`,
    `Offene Tische aktuell: ${open.join(', ') || 'keine'}`,
    `Offene Positionen aktuell: ${openOrderPositionCount()}`,
    `Offene Summe aktuell: ${money(openOrdersTotal())}`,
    '',
    '[ ] App öffnen und Versionsnummer prüfen',
    '[ ] Tisch öffnen, Gästezahl setzen',
    '[ ] Gericht per Suche hinzufügen',
    '[ ] Gericht per Favorit/Zuletzt bestellt hinzufügen',
    '[ ] Letzte zurück und Wiederherstellen prüfen',
    '[ ] Rechnung öffnen, TXT speichern und Druckansicht prüfen',
    '[ ] Tisch schließen und Verlauf kontrollieren',
    '[ ] Tagesstatistik und Schichtbericht prüfen',
    '[ ] Backup exportieren und Import mit Testdaten prüfen',
    '[ ] Offline-Start nach einmaligem Laden prüfen',
    '',
    'Notizen:',
    '- '
  ];
  return lines.join('\n');
}
function exportTestChecklist(){
  downloadText(testChecklistFilename(), buildTestChecklistText());
  toast('Praxistest-Checkliste gespeichert');
}



function buildReadinessReportText(){
  const open = openTableNumbers();
  const diagnostics = state.settings?.lastStartupCheck || { changes: 0, notes: [] };
  const lastBackup = state.settings?.lastBackupAt ? new Date(state.settings.lastBackupAt).toLocaleString('de-DE') : 'kein Backup gespeichert';
  const lastReport = state.settings?.lastShiftReportAt ? new Date(state.settings.lastShiftReportAt).toLocaleString('de-DE') : 'kein Schichtbericht gespeichert';
  const lines = [
    'Restaurant Meteora',
    'Meteora Order – RC-Freigabeprüfung',
    `Version ${APP_VERSION}`,
    '',
    `Erstellt: ${new Date().toLocaleString('de-DE')}`,
    `Offene Tische: ${open.join(', ') || 'keine'}`,
    `Offene Positionen: ${openOrderPositionCount()}`,
    `Offene Summe: ${money(openOrdersTotal())}`,
    `Letztes Backup: ${lastBackup}`,
    `Letzter Schichtbericht: ${lastReport}`,
    `Letzte Datenprüfung: ${diagnostics.checkedAt ? new Date(diagnostics.checkedAt).toLocaleString('de-DE') : '—'}`,
    `Korrekturen bei letzter Datenprüfung: ${diagnostics.changes || 0}`,
    '',
    'Freigabe-Check',
    '--------------------------------',
    '[ ] App startet ohne Fehlermeldung',
    '[ ] Tisch öffnen, bestellen, Rechnung erstellen funktioniert',
    '[ ] Verlauf, Tagesstatistik und Schichtbericht sind plausibel',
    '[ ] Backup exportieren und Test-Import erfolgreich',
    '[ ] Offline-Start nach erneutem Öffnen geprüft',
    '[ ] Praxistest im Restaurant abgeschlossen',
    '',
    'Hinweise aus Systemprüfung:',
    ...((diagnostics.notes || []).length ? diagnostics.notes.map(note => `- ${note}`) : ['- keine Hinweise']),
    '',
    'Entscheidung:',
    '[ ] Für v1.4.0 Final freigeben',
    '[ ] Noch Fehler beheben'
  ];
  return lines.join('\n');
}
function exportReadinessReport(){
  downloadText(readinessFilename(), buildReadinessReportText());
  state.settings ||= {};
  state.settings.lastReadinessReportAt = new Date().toISOString();
  persist();
  toast('RC-Freigabeprüfung gespeichert');
}

function todayClosedOrders(){
  const today = todayKey();
  return (state.history || []).filter(o => o.createdAt?.slice(0,10) === today);
}
function todayCancellationStats(){
  const today = todayKey();
  const active = (state.cancellations || []).filter(c => c.createdAt?.slice(0,10) === today && !c.restoredAt);
  const restored = (state.cancellations || []).filter(c => c.restoredAt?.slice(0,10) === today);
  return { active, restored };
}
function salesBreakdown(rows){
  const categories = {};
  const dishes = {};
  rows.forEach(o => (o.items || []).forEach(i => {
    const cat = i.cat || 'Ohne Kategorie';
    const dishKey = `${i.no}. ${i.name}`;
    const qty = Number(i.qty || 0);
    const sum = qty * Number(i.price || 0);
    categories[cat] = (categories[cat] || 0) + sum;
    dishes[dishKey] ||= { qty: 0, sum: 0 };
    dishes[dishKey].qty += qty;
    dishes[dishKey].sum += sum;
  }));
  return { categories, dishes };
}
function pushTopList(lines, title, entries, formatter, empty='Keine Daten.'){
  lines.push('', title, '--------------------------------');
  if (!entries.length) lines.push(empty);
  entries.slice(0,10).forEach((entry, idx) => lines.push(`${idx + 1}. ${formatter(entry)}`));
}
function shiftReportText(){
  const closed = todayClosedOrders();
  const { active: activeStornos, restored } = todayCancellationStats();
  const closedTotal = closed.reduce((s,o)=>s+Number(o.total||0),0);
  const { categories: cat, dishes } = salesBreakdown(closed);
  const categoryEntries = Object.entries(cat).sort((a,b)=>b[1]-a[1]);
  const dishEntries = Object.entries(dishes).sort((a,b)=>b[1].qty-a[1].qty || b[1].sum-a[1].sum);
  const lines = ['Restaurant Meteora','Meteora Order',`Version ${APP_VERSION}`,'',`Schichtbericht · ${new Date().toLocaleString('de-DE')}`,'--------------------------------'];
  lines.push(`Geschlossene Tische heute: ${closed.length}`);
  lines.push(`Umsatz heute: ${money(closedTotal)}`);
  lines.push(`Offene Tische: ${openTableNumbers().length}`);
  lines.push(`Offene Positionen: ${openOrderPositionCount()}`);
  lines.push(`Offene Summe: ${money(openOrdersTotal())}`);
  lines.push(`Aktive Stornos heute: ${activeStornos.length}`);
  lines.push(`Wiederhergestellt heute: ${restored.length}`);
  pushTopList(lines, 'Umsatz nach Kategorie', categoryEntries, ([name, total]) => `${name}: ${money(total)}`);
  pushTopList(lines, 'Meistverkaufte Gerichte', dishEntries, ([name, data]) => `${name}: ${data.qty}× · ${money(data.sum)}`);
  lines.push('', 'Offene Tische:', '--------------------------------');
  const open = openTableNumbers();
  if (!open.length) lines.push('Keine offenen Tische.');
  open.forEach(table => {
    const items = state.orders[table] || [];
    const guests = state.tables[table]?.guests || 0;
    lines.push('', `Tisch ${table}${guests ? ` · Gäste: ${guests}` : ''}`, `Summe: ${money(orderTotal(table))}`);
    items.forEach(i => lines.push(`  ${i.qty}× ${i.no}. ${i.name} · ${money(i.qty * i.price)}${i.note ? ' · '+i.note : ''}`));
  });
  lines.push('', 'Geschlossene Tische heute:', '--------------------------------');
  if (!closed.length) lines.push('Keine abgeschlossenen Tische heute.');
  closed.forEach(o => lines.push(`Tisch ${o.table} · ${new Date(o.createdAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} · ${money(o.total)}`));
  return lines.join('\n');
}
function markShiftReportSaved(kind='TXT'){
  state.settings ||= {};
  state.settings.lastShiftReportAt = new Date().toISOString();
  state.settings.lastShiftReportKind = kind;
  persist();
}
function exportShiftReportTxt(){
  downloadText(reportFilename('Meteora_Schichtbericht','txt'), shiftReportText());
  markShiftReportSaved('TXT');
  toast('Schichtbericht als TXT gespeichert');
}
function shiftReportCsv(){
  const closed = todayClosedOrders();
  const { active: activeStornos, restored } = todayCancellationStats();
  const { categories: cat, dishes } = salesBreakdown(closed);
  const closedTotal = closed.reduce((sum,o)=>sum+Number(o.total||0),0);
  const lines = [csvLine(['Bereich','Name','Wert','Summe','Hinweis'])];
  lines.push(csvLine(['Zusammenfassung','Version',APP_VERSION,'','']));
  lines.push(csvLine(['Zusammenfassung','Geschlossene Tische',closed.length,'','']));
  lines.push(csvLine(['Zusammenfassung','Umsatz heute','',closedTotal.toFixed(2),'']));
  lines.push(csvLine(['Zusammenfassung','Offene Tische',openTableNumbers().length,openOrdersTotal().toFixed(2),`${openOrderPositionCount()} Positionen`]));
  lines.push(csvLine(['Zusammenfassung','Aktive Stornos heute',activeStornos.length,'','']));
  lines.push(csvLine(['Zusammenfassung','Wiederhergestellt heute',restored.length,'','']));
  Object.entries(cat).sort((a,b)=>b[1]-a[1]).forEach(([name,total]) => lines.push(csvLine(['Kategorie',name,'',Number(total).toFixed(2),''])));
  Object.entries(dishes).sort((a,b)=>b[1].qty-a[1].qty || b[1].sum-a[1].sum).forEach(([name,data]) => lines.push(csvLine(['Gericht',name,data.qty,Number(data.sum).toFixed(2),''])));
  openTableNumbers().forEach(table => lines.push(csvLine(['Offener Tisch',`Tisch ${table}`, (state.orders[table] || []).reduce((sum,i)=>sum+Number(i.qty||0),0), orderTotal(table).toFixed(2), 'noch nicht abgeschlossen'])));
  return lines.join('\n');
}
function exportShiftReportCsv(){
  downloadText(reportFilename('Meteora_Schichtbericht','csv'), shiftReportCsv(), 'text/csv;charset=utf-8');
  markShiftReportSaved('CSV');
  toast('Schichtbericht als CSV gespeichert');
}
async function copyShiftReport(){
  try {
    await navigator.clipboard.writeText(shiftReportText());
    markShiftReportSaved('Kopie');
    toast('Schichtbericht kopiert');
  } catch(err) {
    downloadText(reportFilename('Meteora_Schichtbericht','txt'), shiftReportText());
    markShiftReportSaved('TXT');
    toast('Kopieren nicht möglich – TXT gespeichert');
  }
}
function previewShiftReport(){
  const preview = $('reportPreview');
  if (!preview) return toast('Bericht-Vorschau nicht verfügbar');
  preview.textContent = shiftReportText();
  const meta = $('reportPreviewMeta');
  if (meta) meta.textContent = reportSummaryLine();
  $('reportDialog')?.showModal();
}
function savePreviewReport(){
  downloadText(reportFilename('Meteora_Schichtbericht','txt'), shiftReportText());
  markShiftReportSaved('TXT aus Vorschau');
  toast('Bericht aus Vorschau gespeichert');
}
async function copyPreviewReport(){
  await copyShiftReport();
}
function printPreviewReport(){
  const text = shiftReportText();
  const w = window.open('', '_blank');
  if (!w) return toast('Drucken blockiert');
  w.document.write(`<pre style="font:16px/1.5 system-ui;white-space:pre-wrap">${esc(text)}</pre>`);
  w.document.close(); w.focus(); w.print();
  markShiftReportSaved('Druck');
}
function openBillDialog(){
  if (!(state.orders[currentTable] || []).length) return toast('Keine Positionen vorhanden');
  $('billTitle').textContent = `Rechnung Tisch ${currentTable}`;
  $('billPreview').textContent = receiptText();
  $('billDialog').showModal();
}
function exportBill(){ downloadText(`Meteora_Rechnung_Tisch_${currentTable}_${todayKey()}_${timeKey()}.txt`, receiptText()); }
function printBill(){
  const w = window.open('', '_blank');
  if (!w) return toast('Drucken blockiert');
  w.document.write(`<pre style="font:16px/1.5 system-ui;white-space:pre-wrap">${esc(receiptText())}</pre>`);
  w.document.close(); w.focus(); w.print();
}
function mergeTable(){
  const other = prompt('Mit welchem Tisch zusammenlegen?');
  if (!other) return;
  const target = String(other).trim();
  if (!target || target === currentTable) return toast('Ungültiger Tisch');
  state.orders[currentTable] ||= [];
  state.orders[target] ||= [];
  state.orders[target].forEach(x => addOrMergeOrderItem(currentTable, {...x, movedFrom: target, lineId: newId('line')}));
  lastAddition = null;
  delete state.orders[target];
  state.tables[currentTable] ||= { guests: 0, mergedWith: [] };
  const targetGuests = state.tables[target]?.guests || 0;
  state.tables[currentTable].guests = (state.tables[currentTable].guests || 0) + targetGuests;
  state.tables[currentTable].mergedWith = [...new Set([...(state.tables[currentTable].mergedWith || []), target, ...(state.tables[target]?.mergedWith || [])])];
  delete state.tables[target];
  persist(); renderOrder(); renderTables($('tableSearch').value); toast(`Tisch ${target} zusammengelegt`);
}
function splitTable(){
  const tableData = state.tables[currentTable];
  if (!tableData?.mergedWith?.length) return toast('Kein zusammengelegter Tisch');
  const target = tableData.mergedWith.pop();
  state.orders[target] = (state.orders[currentTable] || []).filter(i => i.movedFrom === target).map(({movedFrom, ...i}) => i);
  state.orders[currentTable] = (state.orders[currentTable] || []).filter(i => i.movedFrom !== target);
  state.tables[target] = { guests: 0, mergedWith: [] };
  persist(); renderOrder(); renderTables($('tableSearch').value); toast(`Tisch ${target} getrennt`);
}

function closeTable(){
  const items = state.orders[currentTable] || [];
  if (!items.length) return toast('Keine Positionen vorhanden');
  const total = orderTotal(currentTable);
  if (!confirm(`Tisch ${currentTable} mit ${money(total)} abschließen?`)) return;
  const closedAt = new Date().toISOString();
  const cleanItems = compactOrderLines(items.map(x=>({...x})));
  const cleanTotal = cleanItems.reduce((s,i)=>s+i.qty*i.price,0);
  const record = { id: newId('hist'), table: currentTable, guests: state.tables[currentTable]?.guests || 0, items: cleanItems, total: cleanTotal, createdAt: closedAt, closedAt };
  state.history.unshift(record);
  delete state.orders[currentTable]; delete state.tables[currentTable];
  persist(); renderTables(); renderHistory(); renderStats(); if ($('billDialog').open) $('billDialog').close(); showView('historyView'); toast('Tisch geschlossen');
}
function setGuests(){
  const old = state.tables[currentTable]?.guests || 0;
  const input = prompt('Anzahl Gäste', old); if (input === null) return;
  const guests = Math.max(0, parseInt(input, 10) || 0);
  state.tables[currentTable] ||= { guests: 0, mergedWith: [] }; state.tables[currentTable].guests = guests;
  persist(); renderOrder(); renderTables($('tableSearch').value);
}

function historyFilters(){
  return {
    q: normalizeText($('historySearch')?.value || ''),
    date: $('historyDate')?.value || '',
    table: $('historyTable')?.value?.trim() || ''
  };
}
function filteredHistory(){
  const f = historyFilters();
  return state.history.filter(o => {
    const dateOk = !f.date || o.createdAt?.slice(0,10) === f.date;
    const tableOk = !f.table || String(o.table).includes(f.table);
    const hay = normalizeText(`tisch ${o.table} ${o.items.map(i=>`${i.no} ${i.name} ${i.note || ''}`).join(' ')}`);
    const queryOk = !f.q || hay.includes(f.q);
    return dateOk && tableOk && queryOk;
  });
}
function renderHistory(){
  const rows = filteredHistory();
  $('historyList').innerHTML = rows.map(o => `<article class="panel historyCard"><details><summary>Tisch ${esc(o.table)} · ${new Date(o.createdAt).toLocaleString('de-DE')} · ${money(o.total)}</summary><p>${o.items.map(i=>`${i.qty}× ${esc(i.no)}. ${esc(i.name)} (${money(i.qty*i.price)})${i.note ? ' · '+esc(i.note) : ''}`).join('<br>')}</p><small>Gäste: ${o.guests || 0}</small><div class="historyActions"><button class="secondary" data-repeat-id="${esc(o.id)}">Erneut übernehmen</button><button data-receipt-id="${esc(o.id)}">TXT</button></div></details></article>`).join('') || '<div class="empty">Keine passenden abgeschlossenen Tische gefunden.</div>';
}
function exportCsv(rows = state.history, filename = 'meteora_order_statistik.csv'){
  if (!rows.length) return toast('Keine Daten für CSV-Export vorhanden');
  const lines = ['Datum;Tisch;Gaeste;Kategorie;Nr;Gericht;Menge;Einzelpreis;Summe;Bemerkung'];
  rows.forEach(o => o.items.forEach(i => lines.push([new Date(o.createdAt).toLocaleString('de-DE'), o.table, o.guests || 0, i.cat || '', i.no, i.name, i.qty, Number(i.price).toFixed(2), (i.qty*i.price).toFixed(2), i.note || ''].map(v => `"${String(v).replaceAll('"','""')}"`).join(';'))));
  downloadText(filename, lines.join('\n'), 'text/csv;charset=utf-8');
}
function receiptTextFromRecord(o){
  const lines = ['Restaurant Meteora','Meteora Order','',`Rechnung Tisch ${o.table}`];
  if (o.guests) lines.push(`Gäste: ${o.guests}`);
  lines.push(`Datum: ${new Date(o.createdAt).toLocaleString('de-DE')}`);
  lines.push('--------------------------------');
  o.items.forEach(i => lines.push(`${i.qty}× ${i.no}. ${i.name}\n  ${money(i.price)} = ${money(i.qty * i.price)}${i.note ? '\n  Hinweis: '+i.note : ''}`));
  lines.push('--------------------------------', `Gesamt: ${money(o.total)}`, '', 'Danke für Ihren Besuch!');
  return lines.join('\n');
}
function repeatHistoryOrder(id){
  const record = state.history.find(o => o.id === id);
  if (!record) return;
  const target = prompt('Auf welchen Tisch übernehmen?', record.table);
  if (!target) return;
  const table = String(target).trim();
  state.orders[table] ||= [];
  state.tables[table] ||= { guests: record.guests || 0, mergedWith: [] };
  record.items.forEach(i => addOrMergeOrderItem(table, {...i, repeatedFrom: record.id, lineId: newId('line')}));
  lastAddition = null;
  persist(); openTable(table); toast('Bestellung übernommen');
}
function renderStats(){
  const today = new Date().toISOString().slice(0,10);
  const todayRows = state.history.filter(o => o.createdAt?.slice(0,10) === today);
  const total = todayRows.reduce((s,o)=>s+Number(o.total||0),0);
  const itemCount = todayRows.reduce((s,o)=>s+o.items.reduce((a,i)=>a+Number(i.qty||0),0),0);
  const cat = {}, dish = {};
  todayRows.forEach(o => o.items.forEach(i => { cat[i.cat || 'Ohne Kategorie'] = (cat[i.cat || 'Ohne Kategorie'] || 0) + i.qty*i.price; dish[`${i.no}. ${i.name}`] = (dish[`${i.no}. ${i.name}`] || 0) + i.qty; }));
  const topDish = Object.entries(dish).sort((a,b)=>b[1]-a[1])[0];
  const cancelledToday = (state.cancellations || []).filter(c => c.createdAt?.slice(0,10) === today && !c.restoredAt).length;
  const restoredToday = (state.cancellations || []).filter(c => c.restoredAt?.slice(0,10) === today).length;
  $('statsSummary').innerHTML = [
    ['Tagesumsatz', money(total)], ['Geschlossene Tische', todayRows.length], ['Verkaufte Positionen', itemCount], ['Stornos', cancelledToday], ['Wiederhergestellt', restoredToday], ['Top-Gericht', topDish ? `${esc(topDish[0])} (${topDish[1]}×)` : '—']
  ].map(([k,v]) => `<article class="statCard"><small>${k}</small><b>${v}</b></article>`).join('');
  const catRows = Object.entries(cat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${money(v)}</td></tr>`).join('');
  const dishRows = Object.entries(dish).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v}×</td></tr>`).join('');
  $('statsDetails').innerHTML = `<h3>Umsatz nach Kategorie</h3><table>${catRows || '<tr><td>Keine Daten für heute.</td><td></td></tr>'}</table><h3>Meistverkaufte Gerichte</h3><table>${dishRows || '<tr><td>Keine Daten für heute.</td><td></td></tr>'}</table>`;
}
function exportDailyCsv(){ const today = new Date().toISOString().slice(0,10); exportCsv(state.history.filter(o => o.createdAt?.slice(0,10) === today), `meteora_order_tagesstatistik_${today}_${timeKey()}.csv`); }
function importBackup(file){
  if (!file) return;
  if (hasOpenOrders() && !confirm(`Es gibt offene Tische. Vor dem Import unbedingt aktuelles Backup exportieren.\n\nDatei: ${file.name || 'Backup'}\nTrotzdem importieren?`)) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const imported = validateImportedState(JSON.parse(r.result));
      state = imported;
      state.importedAt = new Date().toISOString();
      normalizeState();
      persist();
      renderAll();
      toast('Backup importiert und geprüft');
      showView('tablesView');
    } catch (err) {
      console.error(err);
      alert('Import fehlgeschlagen: Die Datei passt nicht zu Meteora Order oder ist beschädigt.');
    } finally {
      if ($('importFile')) $('importFile').value = '';
    }
  };
  r.onerror = () => alert('Import fehlgeschlagen: Datei konnte nicht gelesen werden.');
  r.readAsText(file);
}

function renderEditor(){
  const q = normalizeText($('editorSearch')?.value || '');
  const grouped = categories().map(cat => {
    const items = state.menu
      .filter(m => m.cat === cat && (!q || normalizeText(`${m.no} ${m.name} ${m.cat}`).includes(q)))
      .sort((a,b) => String(a.no).localeCompare(String(b.no), 'de', {numeric:true}));
    if (!items.length) return '';
    return `<section><div class="groupTitle"><h2>${esc(cat)}</h2><small>${items.length} Gerichte</small></div>${items.map(m => `
      <article class="editorLine ${m.available === false ? 'notAvailable' : ''}">
        <button class="editorDish" data-edit-no="${esc(m.no)}"><b>${esc(m.no)}. ${esc(m.name)}</b><small>${money(m.price)}${m.available === false ? ' · nicht verfügbar' : ''}</small></button>
        <button class="secondary" data-toggle-no="${esc(m.no)}">${m.available === false ? 'Aktiv' : 'Aus'}</button>
      </article>`).join('')}</section>`;
  }).join('');
  $('editorList').innerHTML = grouped || '<div class="empty">Kein Gericht gefunden.</div>';
  $('categoryList').innerHTML = categories().map(c => `<option value="${esc(c)}"></option>`).join('');
}
function openEditor(no=null){
  editingDishNo = no;
  const dish = no ? state.menu.find(m => String(m.no) === String(no)) : { no:'', name:'', cat: categories()[0] || '', price:0, available:true };
  if (!dish) return;
  $('editorTitle').textContent = no ? 'Gericht bearbeiten' : 'Neues Gericht';
  $('editNo').value = dish.no;
  $('editName').value = dish.name;
  $('editCategory').value = dish.cat;
  $('editPrice').value = Number(dish.price || 0).toFixed(2);
  $('editAvailable').checked = dish.available !== false;
  $('deleteDishBtn').style.display = no ? '' : 'none';
  $('editorDialog').showModal();
}
function saveEditedDish(){
  const dish = {
    no: $('editNo').value.trim(),
    name: $('editName').value.trim(),
    cat: $('editCategory').value.trim(),
    price: Number(String($('editPrice').value).replace(',', '.')) || 0,
    available: $('editAvailable').checked
  };
  if (!dish.no || !dish.name || !dish.cat) return toast('Bitte Nummer, Name und Kategorie ausfüllen');
  const duplicate = state.menu.find(m => String(m.no) === String(dish.no) && String(m.no) !== String(editingDishNo));
  if (duplicate) return toast('Diese Nummer gibt es bereits');
  if (editingDishNo) {
    const idx = state.menu.findIndex(m => String(m.no) === String(editingDishNo));
    if (idx >= 0) state.menu[idx] = dish;
  } else {
    state.menu.push(dish);
  }
  state.menu.sort((a,b) => a.cat.localeCompare(b.cat, 'de') || String(a.no).localeCompare(String(b.no), 'de', {numeric:true}));
  persist(); renderAll(); toast('Speisekarte gespeichert');
}
function deleteEditedDish(){
  if (!editingDishNo) return;
  const dish = state.menu.find(m => String(m.no) === String(editingDishNo));
  if (!dish || !confirm(`${dish.no}. ${dish.name} wirklich löschen?`)) return;
  state.menu = state.menu.filter(m => String(m.no) !== String(editingDishNo));
  persist(); renderAll(); toast('Gericht gelöscht');
}
function toggleDish(no){
  const dish = state.menu.find(m => String(m.no) === String(no));
  if (!dish) return;
  dish.available = dish.available === false ? true : false;
  persist(); renderEditor(); renderMenu(); toast(dish.available === false ? 'Gericht deaktiviert' : 'Gericht aktiviert');
}
function addCategory(){
  const cat = $('newCategoryInput').value.trim();
  if (!cat) return toast('Kategorie eingeben');
  if (categories().includes(cat)) return toast('Kategorie existiert bereits');
  state.menu.push({ cat, no:`N${Date.now().toString().slice(-4)}`, name:'Neues Gericht', price:0, available:false });
  $('newCategoryInput').value = '';
  persist(); renderAll(); toast('Kategorie angelegt');
}
function renderAll(){ renderTables($('tableSearch').value); renderHistory(); renderEditor(); renderStats(); if(currentTable) renderOrder(); renderCategories(); renderMenu(); updateStatusBadge(); }


$('tableList').addEventListener('click', e => { const b=e.target.closest('[data-table]'); if(b) openTable(b.dataset.table); });
$('tableSearch').addEventListener('input', e => renderTables(e.target.value));
$('openOnlyBtn').onclick = () => renderTables('__busy__');
$('customTableBtn').onclick = () => { const t = prompt('Tischnummer'); if(t) openTable(t.trim()); };
$('backBtn').onclick = () => { showView('tablesView'); renderTables($('tableSearch').value); };
$('guestBtn').onclick = setGuests;
$('dishSearch').addEventListener('input', () => { state.settings ||= {}; state.settings.lastDishSearch = $('dishSearch').value; renderCategories(); renderMenu(); persist(); });
$('resetMenuFiltersBtn')?.addEventListener('click', resetMenuFilters);
$('categoryTabs').addEventListener('click', e => { const b=e.target.closest('[data-cat]'); if(!b) return; currentCategory=b.dataset.cat; $('dishSearch').value=''; state.settings ||= {}; state.settings.lastDishSearch=''; renderCategories(); renderMenu(); persist(); });
$('menuList').addEventListener('click', e => {
  const clearFavorites = e.target.closest('[data-clear-favorites]');
  if (clearFavorites) return clearFavoriteDishes();
  const clearRecent = e.target.closest('[data-clear-recent]');
  if (clearRecent) return clearRecentDishes();
  const fav = e.target.closest('[data-favorite-no]');
  if (fav) return toggleFavoriteDish(fav.dataset.favoriteNo);
  const b=e.target.closest('[data-no]');
  if(!b) return;
  if(menuLongPressTriggered){ menuLongPressTriggered = false; return; }
  openDish(b.dataset.no);
});
$('menuList').addEventListener('dblclick', e => { const b=e.target.closest('[data-no]'); if(b) directAddDish(b.dataset.no); });
$('menuList').addEventListener('pointerdown', e => {
  const b=e.target.closest('[data-no]');
  if(!b || e.pointerType === 'mouse') return;
  clearTimeout(menuLongPressTimer);
  menuLongPressTriggered = false;
  menuLongPressTimer = setTimeout(() => { menuLongPressTriggered = true; directAddDish(b.dataset.no); }, 620);
});
['pointerup','pointercancel','pointerleave'].forEach(evt => $('menuList').addEventListener(evt, () => clearTimeout(menuLongPressTimer)));
$('qtyPicker').addEventListener('click', e => { const b=e.target.closest('[data-qty]'); if(b){ selectedQty=Number(b.dataset.qty); renderQty(); }});
document.querySelector('.quickNotes')?.addEventListener('click', e => { const b=e.target.closest('[data-note]'); if(b) appendQuickNote(b.dataset.note); });
$('dishForm').addEventListener('submit', e => { if(e.submitter?.id === 'addDishBtn') addDish(); });
$('billBox').addEventListener('click', e => { const b=e.target.closest('[data-act]'); if(!b) return; const idx=Number(b.dataset.idx); if(b.dataset.act==='minus') updateLine(idx,-1); if(b.dataset.act==='plus') updateLine(idx,1); if(b.dataset.act==='remove') updateLine(idx,-999); });
$('undoLastBtn')?.addEventListener('click', undoLastLine);
$('restoreLastBtn')?.addEventListener('click', restoreLastLine);
$('clearTableBtn').onclick = () => { if(confirm(`Tisch ${currentTable} wirklich leeren? ${orderCount(currentTable)} Positionen / ${money(orderTotal(currentTable))} werden nicht in den Verlauf übernommen.`)) { (state.orders[currentTable] || []).forEach(item => createRemovalRecord(item, 'clear_table')); delete state.orders[currentTable]; delete state.tables[currentTable]; currentTable=null; lastAddition=null; lastRemovedLine=null; persist(); renderTables(); renderStats(); showView('tablesView'); }};
$('billTableBtn').onclick = openBillDialog;
$('closeTableBtn').onclick = closeTable;
$('exportBillBtn').onclick = (e) => { e.preventDefault(); exportBill(); };
$('printBillBtn').onclick = (e) => { e.preventDefault(); printBill(); };
$('mergeTableBtn').onclick = mergeTable;
$('splitTableBtn').onclick = splitTable;
$('historySearch').addEventListener('input', renderHistory);
$('historyDate')?.addEventListener('input', renderHistory);
$('historyTable')?.addEventListener('input', renderHistory);
$('todayHistoryBtn')?.addEventListener('click', () => { $('historyDate').value = todayKey(); $('historyTable').value=''; $('historySearch').value=''; renderHistory(); });
$('clearHistoryFiltersBtn')?.addEventListener('click', () => { $('historyDate').value=''; $('historyTable').value=''; $('historySearch').value=''; renderHistory(); });
$('historyList')?.addEventListener('click', e => { const rep=e.target.closest('[data-repeat-id]'); const rec=e.target.closest('[data-receipt-id]'); if(rep) repeatHistoryOrder(rep.dataset.repeatId); if(rec){ const o=state.history.find(x=>x.id===rec.dataset.receiptId); if(o) downloadText(`Meteora_Rechnung_Tisch_${o.table}_${o.createdAt.slice(0,10)}.txt`, receiptTextFromRecord(o)); } });
$('editorSearch')?.addEventListener('input', renderEditor);
$('newDishBtn')?.addEventListener('click', () => openEditor());
$('addCategoryBtn')?.addEventListener('click', addCategory);
$('editorList')?.addEventListener('click', e => { const edit=e.target.closest('[data-edit-no]'); const toggle=e.target.closest('[data-toggle-no]'); if(edit) openEditor(edit.dataset.editNo); if(toggle) toggleDish(toggle.dataset.toggleNo); });
$('editorForm')?.addEventListener('submit', e => { if(e.submitter?.id === 'saveDishBtn') saveEditedDish(); if(e.submitter?.id === 'deleteDishBtn') deleteEditedDish(); });
$('exportCsvBtn').onclick = () => exportCsv(filteredHistory(), 'meteora_order_verlauf_filter.csv');
$('exportDailyCsvBtn')?.addEventListener('click', exportDailyCsv);
$('backupBtn').onclick = exportBackup;
$('exportOpenTablesBtn')?.addEventListener('click', exportOpenTablesTxt);
$('exportDiagnosticsBtn')?.addEventListener('click', exportSystemDiagnostics);
$('exportTestChecklistBtn')?.addEventListener('click', exportTestChecklist);
$('exportReadinessBtn')?.addEventListener('click', exportReadinessReport);
$('exportShiftReportBtn')?.addEventListener('click', exportShiftReportTxt);
$('exportShiftReportCsvBtn')?.addEventListener('click', exportShiftReportCsv);
$('copyShiftReportBtn')?.addEventListener('click', copyShiftReport);
$('previewShiftReportBtn')?.addEventListener('click', previewShiftReport);
$('savePreviewReportBtn')?.addEventListener('click', e => { e.preventDefault(); savePreviewReport(); });
$('copyPreviewReportBtn')?.addEventListener('click', e => { e.preventDefault(); copyPreviewReport(); });
$('printPreviewReportBtn')?.addEventListener('click', e => { e.preventDefault(); printPreviewReport(); });
$('installBtn')?.addEventListener('click', installApp);
$('importBtn').onclick = () => $('importFile').click();
$('importFile').addEventListener('change', e => e.target.files?.[0] && importBackup(e.target.files[0]));
$('resetDemoBtn').onclick = () => {
  const open = hasOpenOrders();
  const msg = open ? 'Es gibt offene Tische. Zum Löschen bitte LÖSCHEN eingeben.' : 'Alle lokalen Daten löschen? Zum Bestätigen bitte LÖSCHEN eingeben.';
  if (prompt(msg) === 'LÖSCHEN') { state = cloneDefaultState(); persist(); currentTable=null; lastAddition=null; lastRemovedLine=null; renderAll(); showView('tablesView'); toast('Daten zurückgesetzt'); }
};
$('infoBtn').onclick = () => alert(`Meteora Order\nVersion ${APP_VERSION}\nRestaurant Meteora © 2026\nStatus: ${navigator.onLine ? 'Online' : 'Offline'}\nDaten werden lokal im Browser gespeichert.`);
document.querySelectorAll('.bottomNav button').forEach(b => b.onclick = () => { showView(b.dataset.view); if(b.dataset.view==='historyView') renderHistory(); if(b.dataset.view==='editorView') renderEditor(); if(b.dataset.view==='statsView') renderStats(); });
window.addEventListener('online', updateStatusBadge);
window.addEventListener('offline', updateStatusBadge);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; toast('App kann installiert werden'); });
window.addEventListener('beforeunload', e => { if (hasOpenOrders()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
    e.preventDefault();
    const target = document.querySelector('#orderView.active #dishSearch') || $('tableSearch');
    target?.focus();
  }
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').then(reg => {
    reg.addEventListener('updatefound', () => toast('App-Update wird vorbereitet'));
  }).catch(()=>{});
}

normalizeState();
renderAll();
updateStatusBadge();
