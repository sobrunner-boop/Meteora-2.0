export const TABLE_GROUPS = [
  { name: 'Innenbereich', tables: range(1, 10) },
  { name: 'Außenbereich', tables: [...range(20, 40), 223] },
  { name: 'Saal', tables: range(100, 140) },
  { name: 'Außer Haus', tables: [50] }
];
function range(a,b){return Array.from({length:b-a+1},(_,i)=>a+i)}
export function tableStatus(state, table) {
  const key = String(table); const order = state.orders[key] || [];
  const guests = state.tables[key]?.guests || 0; const mergedWith = state.tables[key]?.mergedWith || [];
  return { busy: order.length > 0 || guests > 0 || mergedWith.length > 0, count: order.reduce((s,i)=>s+i.qty,0), guests, mergedWith };
}
