export function repairState(state, defaultMenu = []) {
  const report = { checkedAt: new Date().toISOString(), changes: 0, notes: [] };
  const changed = note => { report.changes += 1; report.notes.push(note); };

  if (!Array.isArray(state.menu) || !state.menu.length) {
    state.menu = structuredClone(defaultMenu);
    changed('Speisekarte aus Standarddaten wiederhergestellt');
  }
  if (!state.orders || typeof state.orders !== 'object' || Array.isArray(state.orders)) {
    state.orders = {};
    changed('Bestellstruktur korrigiert');
  }
  if (!state.tables || typeof state.tables !== 'object' || Array.isArray(state.tables)) {
    state.tables = {};
    changed('Tischstruktur korrigiert');
  }
  if (!Array.isArray(state.history)) {
    state.history = [];
    changed('Verlaufstruktur korrigiert');
  }
  if (!Array.isArray(state.cancellations)) {
    state.cancellations = [];
    changed('Stornostruktur korrigiert');
  }
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) {
    state.settings = {};
    changed('Einstellungen korrigiert');
  }

  Object.entries(state.tables).forEach(([table, meta]) => {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      state.tables[table] = { guests: 0, mergedWith: [] };
      changed(`Tisch ${table} Metadaten korrigiert`);
      return;
    }
    meta.guests = Math.max(0, Number(meta.guests) || 0);
    meta.mergedWith = Array.isArray(meta.mergedWith) ? [...new Set(meta.mergedWith.map(String).filter(Boolean))] : [];
  });

  Object.keys(state.orders).forEach(table => {
    if (!Array.isArray(state.orders[table])) {
      delete state.orders[table];
      changed(`Ungültige Bestellung bei Tisch ${table} entfernt`);
    }
  });



  state.history = state.history
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => ({
      ...entry,
      id: entry.id || `hist_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      table: String(entry.table || ''),
      createdAt: entry.createdAt || new Date().toISOString(),
      items: Array.isArray(entry.items) ? entry.items : []
    }))
    .filter(entry => entry.table && entry.items.length);

  state.cancellations = state.cancellations
    .filter(entry => entry && typeof entry === 'object')
    .map(entry => ({
      ...entry,
      id: entry.id || `cancel_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
      createdAt: entry.createdAt || new Date().toISOString(),
      qty: Math.max(1, Number(entry.qty) || 1)
    }));

  state.settings.favoriteDishes = Array.isArray(state.settings.favoriteDishes)
    ? [...new Set(state.settings.favoriteDishes.map(String).filter(Boolean))].slice(0, 12)
    : [];
  state.settings.recentDishes = Array.isArray(state.settings.recentDishes)
    ? [...new Set(state.settings.recentDishes.map(String).filter(Boolean))].slice(0, 6)
    : [];

  state.settings.lastStartupCheck = report;
  return report;
}

export function buildDiagnosticsText({ state, version, openTables, openPositions, openTotal, lastSaved }) {
  const report = state.settings?.lastStartupCheck || { changes: 0, notes: [] };
  const lines = [
    'Restaurant Meteora',
    'Meteora Order – Systemprüfung',
    `Version ${version}`,
    '',
    `Erstellt: ${new Date().toLocaleString('de-DE')}`,
    `Letzte Speicherung: ${lastSaved || '—'}`,
    `Offene Tische: ${openTables.join(', ') || 'keine'}`,
    `Offene Positionen: ${openPositions}`,
    `Offene Summe: ${openTotal}`,
    '',
    `Datenprüfung beim Start: ${report.changes || 0} Korrektur(en)`,
    ...((report.notes || []).length ? report.notes.map(note => `- ${note}`) : ['- keine Auffälligkeiten']),
    '',
    'Hinweis: Daten bleiben lokal im Browser gespeichert. Regelmäßig Backup exportieren.'
  ];
  return lines.join('\n');
}
