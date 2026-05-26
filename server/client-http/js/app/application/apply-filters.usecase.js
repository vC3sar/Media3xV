import { dateRank } from '../core/date-utils.js';

export function applyFiltersUseCase({ allFiles, favoritesOnly, currentType, currentEntry, currentSort, currentGroup, query, isFavorite }) {
  const q = (query || '').toLowerCase();
  const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const recentCutoff = Date.now() - RECENT_WINDOW_MS;
  const isLivePhoto = f => Boolean(f?.type === 'video' && f?.livePhoto?.enabled);
  const isRecent = f => Number.isFinite(f?.mtimeMs) && Number(f.mtimeMs) >= recentCutoff;
  const typeMatch = (f) => {
    if (currentType === 'all') return true;
    if (currentType === 'recent') return isRecent(f);
    if (currentType === 'live') return isLivePhoto(f);
    if (currentType === 'video') return f.type === 'video' && !isLivePhoto(f);
    return f.type === currentType;
  };

  const filteredFiles = (allFiles || []).filter(f =>
    typeMatch(f) &&
    (currentEntry === 'all' || f.entryId === currentEntry) &&
    (!favoritesOnly || isFavorite(f.url)) &&
    (!q || f.name.toLowerCase().includes(q) || f.url.toLowerCase().includes(q))
  );

  if (currentSort === 'invert') filteredFiles.reverse();
  else {
    filteredFiles.sort((a, b) => {
      switch (currentSort) {
        case 'date-desc': return dateRank(b.date) - dateRank(a.date);
        case 'date-asc': return dateRank(a.date) - dateRank(b.date);
        case 'name-asc': return a.name.localeCompare(b.name);
        case 'name-desc': return b.name.localeCompare(a.name);
        case 'heavy-desc': return b.size - a.size;
        case 'heavy-asc': return a.size - b.size;
        default: return 0;
      }
    });
  }

  const groupMap = {};
  for (const f of filteredFiles) {
    const typeLabel = isLivePhoto(f)
      ? 'Live Photos'
      : ({ image: 'Fotos', video: 'Videos', audio: 'Audio' }[f.type] || 'Otros');
    const key = currentGroup === 'date' ? dayGroupKey(f)
      : currentGroup === 'type' ? typeLabel
      : 'Todos los archivos';
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(f);
  }

  let groupKeys = Object.keys(groupMap);
  if (currentGroup === 'date') {
    groupKeys = groupKeys.sort((a, b) => currentSort === 'date-asc'
      ? dateRank(a) - dateRank(b)
      : dateRank(b) - dateRank(a));
  }

  return { filteredFiles, groupMap, groupKeys };
}
  const dayGroupKey = (f) => {
    const d = String(f?.date || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (/^\d{4}-XX-XX$/.test(d)) return d;
    if (Number.isFinite(f?.mtimeMs) && Number(f.mtimeMs) > 0) {
      const dt = new Date(Number(f.mtimeMs));
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
      const day = String(dt.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    return '0000-sin-fecha';
  };
