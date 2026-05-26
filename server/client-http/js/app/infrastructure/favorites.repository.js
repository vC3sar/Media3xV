export function createFavoritesRepository(storageKey) {
  const safeParse = (value) => {
    try {
      const parsed = JSON.parse(value || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(v => typeof v === 'string' && v.trim());
    } catch {
      return [];
    }
  };

  return {
    load() {
      return new Set(safeParse(localStorage.getItem(storageKey)));
    },
    save(favoritesSet) {
      localStorage.setItem(storageKey, JSON.stringify([...favoritesSet]));
    },
  };
}
