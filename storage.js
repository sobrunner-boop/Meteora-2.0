export const STORE_KEY = 'meteoraOrder_v130_alpha2'; // stabiler Speicher-Key für Updates
export function loadState(fallback) {
  try { return { ...fallback, ...(JSON.parse(localStorage.getItem(STORE_KEY)) || {}) }; }
  catch { return structuredClone(fallback); }
}
export function saveState(state) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('Speichern fehlgeschlagen', error);
    alert('Meteora Order konnte nicht speichern. Bitte Speicherplatz prüfen und Backup exportieren.');
    return false;
  }
}
export function exportJson(state, filename = `Meteora_Order_Backup_${new Date().toISOString().slice(0,10)}.json`) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}
export function downloadText(filename, text, type='text/plain') {
  const content = type.includes('csv') && !String(text).startsWith('\ufeff') ? '\ufeff' + text : text;
  const blob = new Blob([content], { type }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
