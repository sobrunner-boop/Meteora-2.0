export const $ = id => document.getElementById(id);
export const money = n => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n || 0);
export const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),1800); }
export function showView(id){ document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id===id)); document.querySelectorAll('.bottomNav button').forEach(b=>b.classList.toggle('active', b.dataset.view===id)); }
