import { dateRank, monthGroupKey, monthGroupRank } from '../core/date-utils.js';

export function applyFiltersUseCase({ allFiles, favoritesOnly, currentType, currentEntry, currentSort, currentGroup, query, isFavorite }) {
  const q = (query || '').toLowerCase();
  const isLivePhoto = f => Boolean(f?.type === 'video' && f?.livePhoto?.enabled);
  const typeMatch = (f) => {
    if (currentType === 'all') return true;
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
    const key = currentGroup === 'date' ? monthGroupKey(f.date)
      : currentGroup === 'type' ? typeLabel
      : 'Todos los archivos';
    if (!groupMap[key]) groupMap[key] = [];
    groupMap[key].push(f);
  }

  let groupKeys = Object.keys(groupMap);
  if (currentGroup === 'date') {
    groupKeys = groupKeys.sort((a, b) => currentSort === 'date-asc'
      ? monthGroupRank(a) - monthGroupRank(b)
      : monthGroupRank(b) - monthGroupRank(a));
  }

  return { filteredFiles, groupMap, groupKeys };
}
