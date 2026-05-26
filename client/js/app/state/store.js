/**
 * @typedef {Object} AppState
 * @property {Array<any>} allFiles
 * @property {Array<any>} filteredFiles
 * @property {number} sizeIdx
 * @property {number} lastDesktopSizeIdx
 * @property {string} layoutMode
 * @property {string} currentSort
 * @property {string} currentGroup
 * @property {string} currentType
 * @property {string} currentEntry
 * @property {boolean} favoritesOnly
 */

/** @param {Partial<AppState>} initial */
export function createStore(initial = {}) {
  /** @type {AppState} */
  let state = {
    allFiles: [],
    filteredFiles: [],
    sizeIdx: 3,
    lastDesktopSizeIdx: 3,
    layoutMode: 'grid',
    currentSort: 'date-desc',
    currentGroup: 'date',
    currentType: 'all',
    currentEntry: 'all',
    favoritesOnly: false,
    ...initial,
  };
  const listeners = new Set();

  return {
    getState() { return state; },
    setState(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) l(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
