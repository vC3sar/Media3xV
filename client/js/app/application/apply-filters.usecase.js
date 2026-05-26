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

  const compareText = (a, b) => String(a || '').localeCompare(String(b || ''));
  const compareNumber = (a, b) => Number(a || 0) - Number(b || 0);
  const tieBreak = (a, b) =>
    compareNumber(b?.mtimeMs, a?.mtimeMs) ||
    compareText(a?.name, b?.name) ||
    compareText(a?.url, b?.url);

  if (currentSort === 'invert') filteredFiles.reverse();
  else {
    filteredFiles.sort((a, b) => {
      switch (currentSort) {
        case 'date-desc':
          return (
            dateRank(b.date) - dateRank(a.date) ||
            compareNumber(b?.mtimeMs, a?.mtimeMs) ||
            compareText(a?.name, b?.name) ||
            compareText(a?.url, b?.url)
          );
        case 'date-asc':
          return (
            dateRank(a.date) - dateRank(b.date) ||
            compareNumber(a?.mtimeMs, b?.mtimeMs) ||
            compareText(a?.name, b?.name) ||
            compareText(a?.url, b?.url)
          );
        case 'name-asc':
          return compareText(a?.name, b?.name) || compareText(a?.url, b?.url);
        case 'name-desc':
          return compareText(b?.name, a?.name) || compareText(a?.url, b?.url);
        case 'heavy-desc':
          return compareNumber(b?.size, a?.size) || tieBreak(a, b);
        case 'heavy-asc':
          return compareNumber(a?.size, b?.size) || tieBreak(a, b);
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
