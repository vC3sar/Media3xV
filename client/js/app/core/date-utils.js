export function dateRank(dateStr) {
  if (!dateStr || dateStr === '0000-sin-fecha') return 0;
  const [yRaw, mRaw, dRaw] = String(dateStr).split('-');
  const y = Number(yRaw) || 0;
  const m = mRaw === 'XX' ? 0 : (Number(mRaw) || 0);
  const d = dRaw === 'XX' ? 0 : (Number(dRaw) || 0);
  return (y * 10000) + (m * 100) + d;
}

export function monthGroupKey(dateStr) {
  if (!dateStr || dateStr === '0000-sin-fecha') return '0000-00';
  const [yRaw, mRaw] = String(dateStr).split('-');
  const y = Number(yRaw) || 0;
  const m = mRaw === 'XX' ? 0 : (Number(mRaw) || 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function monthGroupRank(groupKey) {
  const [yRaw, mRaw] = String(groupKey).split('-');
  const y = Number(yRaw) || 0;
  const m = Number(mRaw) || 0;
  return (y * 100) + m;
}

export function monthGroupLabel(groupKey) {
  if (groupKey === '0000-00') return 'Sin fecha';
  const [yRaw, mRaw] = String(groupKey).split('-');
  const y = Number(yRaw) || 0;
  const m = Number(mRaw) || 0;
  if (!m) return String(y);
  const mo = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${mo[m - 1]} ${y}`;
}

export function prettyDate(d) {
  if (d === '0000-sin-fecha') return 'Sin fecha';
  const [y, m] = d.split('-');
  if (m === 'XX') return y;
  const mo = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${mo[parseInt(m, 10) - 1]} ${y}`;
}
