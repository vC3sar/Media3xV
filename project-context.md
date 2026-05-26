This file is a merged representation of the entire codebase, combined into a single document by Repomix.
The content has been processed where comments have been removed, empty lines have been removed, content has been compressed (code blocks are separated by ⋮---- delimiter).

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Code comments have been removed from supported file types
- Empty lines have been removed from all files
- Content has been compressed - code blocks are separated by ⋮---- delimiter
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
config.json
index.html
js/app/application/apply-filters.usecase.js
js/app/config.js
js/app/core/date-utils.js
js/app/infrastructure/favorites.repository.js
js/app/main.js
js/app/state/store.js
js/media-loader.js
js/server/features/cache/service.mjs
js/server/features/config/repository.mjs
js/server/features/indexing/builders.mjs
js/server/features/live/service.mjs
js/server/features/thumb/handler.mjs
js/server/shared/media-utils.mjs
package.json
scripts/build-media-index.mjs
scripts/watch-media-index.mjs
server.mjs
```

# Files

## File: js/app/core/date-utils.js
```javascript
export function dateRank(dateStr)
⋮----
export function monthGroupKey(dateStr)
⋮----
export function monthGroupRank(groupKey)
⋮----
export function monthGroupLabel(groupKey)
⋮----
export function prettyDate(d)
```

## File: js/app/infrastructure/favorites.repository.js
```javascript
export function createFavoritesRepository(storageKey)
⋮----
const safeParse = (value) =>
⋮----
load()
save(favoritesSet)
```

## File: js/app/state/store.js
```javascript
export function createStore(initial =
⋮----
getState()
setState(patch)
subscribe(listener)
```

## File: js/media-loader.js
```javascript
function delay(ms)
⋮----
function bustCache(url)
⋮----
async function loadImageWithRetry(src, options =
⋮----
img.onload = ()
img.onerror = () => reject(new Error(`Error loading image: $
⋮----
class VideoQueueLoader
⋮----
getState(key)
⋮----
enqueue(task)
⋮----
cancel(key)
⋮----
cancelByPrefix(prefix)
⋮----
_sortQueue()
⋮----
const rank = p
⋮----
async _runEntry(entry)
⋮----
_drain()
⋮----
function loadVideoMetadata(videoEl, src, attempt = 0)
⋮----
const cleanup = () =>
videoEl.onloadedmetadata = () =>
videoEl.onerror = () =>
⋮----
function loadVideoPreview(videoEl, src, attempt = 0)
⋮----
const done = () =>
⋮----
const fail = reason => {
        if (settled) return;
⋮----
const startSeek = () =>
⋮----
videoEl.onseeked = () =>
videoEl.ontimeupdate = () =>
videoEl.onloadeddata = () =>
videoEl.onerror = ()
⋮----
function promoteVideoFull(videoEl, src)
⋮----
function releaseVideo(videoEl)
```

## File: js/server/features/cache/service.mjs
```javascript
function createCacheService(
⋮----
async function safeClearDir(targetDir)
⋮----
async function dirSizeBytes(targetDir)
⋮----
async function walkSize(dir)
```

## File: scripts/build-media-index.mjs
```javascript
function detectType(name)
⋮----
function guessDate(name, relPath)
⋮----
async function walk(dir, out = [])
⋮----
function toPosix(p)
⋮----
async function main()
```

## File: scripts/watch-media-index.mjs
```javascript
function runBuild()
⋮----
function scheduleBuild()
```

## File: js/app/application/apply-filters.usecase.js
```javascript
export function applyFiltersUseCase(
⋮----
const isLivePhoto = f
const isRecent = f
const typeMatch = (f) =>
⋮----
const dayGroupKey = (f) =>
```

## File: js/server/shared/media-utils.mjs
```javascript
function detectType(name)
⋮----
function guessDateDetailed(name, relPath)
⋮----
function toPosix(p)
⋮----
function parseAutoindexLinks(html)
⋮----
function toFileNameFromUrl(u)
⋮----
function entryLabelFromFilesystemRoot(rootPath)
⋮----
function entryLabelFromAutoindexRoot(rootUrl)
⋮----
function dedupeFilesByUrl(files)
⋮----
function dedupeMixedImagesByFingerprint(files)
```

## File: js/app/config.js
```javascript

```

## File: js/server/features/config/repository.mjs
```javascript
async function readConfig(fs, configFile)
⋮----
async function writeConfig(fs, configFile, cfg)
⋮----
function normalizeSourceLists(cfg)
⋮----
const toUnique = (values) =>
```

## File: package.json
```json
{
  "name": "media3xv-vault",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node server.mjs",
    "start:cluster": "node server.mjs --cluster",
    "dev": "nodemon --watch server.mjs --ignore '**/.thumb-cache/**' --ignore '**/.temp_livephotos/**' --ignore '**/.git/**' --ignore '**/node_modules/**' server.mjs"
  },
  "devDependencies": {
    "nodemon": "^3.1.10"
  }
}
```

## File: config.json
```json
{
  "host": "0.0.0.0",
  "port": 3000,
  "sourceMode": "filesystem",
  "mediaRoot": "/data/data/com.termux/files/home/.termux/Backups/",
  "mediaRoots": [
    "/data/data/com.termux/files/home/.termux/Backups/"
  ],
  "autoindexRootUrl": "http://192.168.1.125:8080/takeout-20260520T011015Z-3-001/",
  "autoindexRootUrls": [
    "http://192.168.1.125:8080/takeout-20260520T011015Z-3-001/"
  ],
  "mediaIndexFile": "./media-index.json",
  "watchDebounceMs": 1200,
  "filesystemRefreshMs": 15000,
  "autoindexRefreshMs": 20000,
  "fastIndexMode": true,
  "detectLivePhotos": true,
  "debug": true
}
```

## File: js/server/features/thumb/handler.mjs
```javascript
async function runCommand(command, args)
⋮----
function createThumbHandler(ctx)
⋮----
function resolveSrc(src)
⋮----
async function serveCachedThumb(res, outFile, contentType)
⋮----
async function handleVideo(req, res, url)
⋮----
async function handleImage(req, res, url)
⋮----
async function handleWebImage(req, res, url)
```

## File: js/server/features/live/service.mjs
```javascript
function createLiveService(ctx)
⋮----
function resolveFilesystemMediaSrc(src)
⋮----
async function runCommand(command, args, stdoutPipe = false)
⋮----
async function probeLivePhotoMetadata(absVideoPath)
⋮----
async function findLiveStillPair(absVideoPath)
⋮----
// Common duplicate suffixes from mobile/gallery copy operations:
// IMG_0019(1).MP4 -> try matching still IMG_0019.HEIC
⋮----
// Fallback for iPhone variants like IMG_E0019.MP4 vs IMG_0019.HEIC
// or duplicated copies with suffixes.
⋮----
async function detectLivePhotoFilesystem(absVideoPath)
⋮----
function getLiveWebOutFile(src, v, absVideoPath)
⋮----
async function ensureLiveWebVideo(src, v, absVideoPath)
⋮----
async function handleSnapshot(req, res, url)
⋮----
async function handleWebVideo(req, res, url)
⋮----
async function handlePrepare(res, url)
⋮----
async function handleStatus(res, url)
```

## File: js/server/features/indexing/builders.mjs
```javascript
async function walk(fs, dir, out = [])
⋮----
async function runCommand(command, args)
⋮----
async function runCommandCapture(command, args)
⋮----
async function probeDimensions(absInput)
⋮----
function normalizeDateFromText(raw)
⋮----
async function probeImageExifDateFallback(absInput)
⋮----
async function ensureImageThumbFilesystem(ctx, mediaSrc, mtimeMs, absInput, size = 512)
⋮----
function normalizeDateSortKey(dateStr, mtimeMs)
⋮----
function deriveDateGroup(dateStr, mtimeMs)
⋮----
async function buildFilesystemIndex(ctx)
⋮----
async function buildAutoindexIndex(ctx)
⋮----
function buildIndexPayloadFactory(ctx)
```

## File: index.html
```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vault — Multimedia X8B</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"></script>
<script src="./js/media-loader.js"></script>
<script>
tailwind.config = { darkMode: 'class' }
</script>
<style>
:root {
  --bg:        #080a0f;
  --surface:   #0d1018;
  --panel:     #111520;
  --card:      #141926;
  --card-h:    #1a2133;
  --border:    rgba(255,255,255,0.07);
  --border-h:  rgba(255,255,255,0.14);
  --accent:    #5b6ef5;
  --accent-h:  #7b8ff7;
  --accent-dim:#1e2460;
  --text:      #e8eaf0;
  --muted:     #6b7280;
  --muted-l:   #9ca3af;
  --danger:    #ef4444;
  --font: 'DM Sans', sans-serif;
  --mono: 'DM Mono', monospace;
  --topbar-h: 56px;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { color-scheme: dark; scroll-behavior: smooth; }
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.5; overflow-x: hidden; }
/* Scrollbar */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #1e2436; border-radius: 99px; }
::-webkit-scrollbar-thumb:hover { background: #2a3352; }
/* ── LAYOUT ── */
#sidebar {
  position: fixed; left: 0; top: 0; bottom: 0; width: 220px;
  background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; z-index: 30;
  transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
}
#main { margin-left: 220px; min-height: 100vh; display: flex; flex-direction: column; }
@media (max-width: 768px) {
  #sidebar { transform: translateX(-100%); }
  #sidebar.open { transform: translateX(0); box-shadow: 0 0 60px rgba(0,0,0,0.8); }
  #main { margin-left: 0; }
  #overlay.open { display: block !important; }
  #topbar {
    height: auto;
    min-height: 56px;
    padding: 10px 12px;
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    grid-template-areas:
      "ham spacer sort view cfg"
      "select select del del del"
      "search search search search search";
    gap: 8px;
    align-items: center;
    overflow-x: clip;
  }
  #hamBtn { grid-area: ham; }
  .search-wrap {
    grid-area: search;
    order: initial;
    flex: initial;
    width: 100%;
    max-width: 100%;
    min-width: 0;
  }
  #sortBtn { grid-area: sort; }
  #viewBtn { grid-area: view; }
  #selectModeBtn { grid-area: select; }
  #deleteSelectedBtn { grid-area: del; }
  #cfgBtn { grid-area: cfg; }
  #topbar > div[style*="flex:1"] {
    grid-area: spacer;
    display: block;
    min-width: 0;
  }
  #topbar .tbtn {
    min-height: 34px;
    padding: 6px 8px;
    min-width: 0;
  }
  #topbar .tbtn span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #selectModeBtn, #deleteSelectedBtn {
    width: 100%;
    justify-content: center;
  }
  #topbar .search-wrap input {
    padding-top: 9px;
    padding-bottom: 9px;
  }
  #subbar {
    padding: 8px 12px;
    gap: 8px;
  }
  #entryFilterWrap {
    width: 100%;
  }
  #entryFilter {
    width: 100%;
    min-width: 0 !important;
  }
  #statsRow {
    width: 100%;
  }
  #zoomBar {
    bottom: 14px;
    right: 14px;
  }
}
/* ── SIDEBAR NAV ── */
.nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 16px; border-radius: 8px; cursor: pointer;
  color: var(--muted); font-size: 13px; font-weight: 500;
  transition: background 0.15s, color 0.15s;
  margin: 1px 8px;
}
.nav-item:hover { background: var(--panel); color: var(--text); }
.nav-item.active { background: var(--accent-dim); color: var(--accent-h); }
.nav-item svg { width: 16px; height: 16px; flex-shrink: 0; }
/* ── TOP BAR ── */
#topbar {
  position: sticky; top: 0; z-index: 20;
  background: rgba(8,10,15,0.85); backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border);
  padding: 0 20px; height: 56px;
  display: flex; align-items: center; gap: 12px;
}
.search-wrap { flex: 1; max-width: 480px; position: relative; }
.search-wrap input {
  width: 100%; background: var(--panel); color: var(--text);
  border: 1px solid var(--border); border-radius: 10px;
  padding: 8px 14px 8px 36px; font-family: var(--font); font-size: 13px;
  outline: none; transition: border-color 0.15s, box-shadow 0.15s;
}
.search-wrap input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(91,110,245,0.15); }
.search-wrap .ico { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--muted); }
/* ── TOOLBAR BUTTONS ── */
.tbtn {
  display: flex; align-items: center; justify-content: center;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 9px; color: var(--muted-l); cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
  padding: 7px 10px; gap: 6px; font-size: 12px; font-weight: 500;
  white-space: nowrap;
}
.tbtn:hover { background: var(--card-h); color: var(--text); border-color: var(--border-h); }
.tbtn.active { background: var(--accent-dim); color: var(--accent-h); border-color: var(--accent); }
.tbtn svg { width: 15px; height: 15px; flex-shrink: 0; }
/* ── FILTER PILLS ── */
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 99px; font-size: 12px; font-weight: 500;
  background: var(--panel); color: var(--muted); border: 1px solid var(--border);
  cursor: pointer; transition: all 0.15s;
}
.pill:hover { color: var(--text); border-color: var(--border-h); }
.pill.active { background: var(--accent-dim); color: var(--accent-h); border-color: var(--accent); }
.pill .dot { width: 6px; height: 6px; border-radius: 50%; }
/* ── CARDS ── */
.media-card {
  position: relative; border-radius: 12px; overflow: hidden;
  background: var(--card); cursor: pointer;
  border: 1px solid var(--border);
  transition: border-color 0.2s, transform 0.2s;
}
.media-card:hover { border-color: var(--border-h); transform: translateY(-1px); }
.media-card:hover .card-overlay { opacity: 1; }
.media-card:active { transform: scale(0.98); }
.media-card.selected {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 2px rgba(91,110,245,0.35) inset;
}
.sel-indicator {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--accent);
  border: 1px solid rgba(255,255,255,0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 2px 10px rgba(0,0,0,0.35);
  z-index: 3;
}
.card-overlay {
  position: absolute; inset: 0; opacity: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%);
  transition: opacity 0.2s; display: flex; align-items: flex-end; padding: 10px;
}
.card-name { color: #fff; font-size: 11px; font-weight: 500; line-height: 1.3;
  overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.type-badge {
  position: absolute; top: 8px; left: 8px;
  background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
  color: #fff; font-size: 10px; font-weight: 600; letter-spacing: 0.04em;
  padding: 3px 7px; border-radius: 6px;
  display: flex; align-items: center; gap: 4px;
}
.type-badge svg { width: 10px; height: 10px; }
/* ── SECTION HEADER ── */
.section-head {
  font-size: 11px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--muted); padding: 0 2px 10px;
  display: flex; align-items: center; gap: 8px;
}
.section-head::after { content: ''; flex: 1; height: 1px; background: var(--border); }
/* ── FLOATING ZOOM BAR ── */
#zoomBar {
  position: fixed; bottom: 24px; right: 24px; z-index: 40;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 14px; padding: 10px 14px;
  display: flex; align-items: center; gap: 10px;
  backdrop-filter: blur(16px); box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  transition: opacity 0.2s, transform 0.2s;
}
#zoomBar button {
  width: 28px; height: 28px; border-radius: 7px;
  background: var(--card); border: 1px solid var(--border);
  color: var(--muted-l); cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s; flex-shrink: 0;
}
#zoomBar button:hover { background: var(--card-h); color: var(--text); }
#zoomSlider {
  -webkit-appearance: none; appearance: none;
  width: 100px; height: 4px; border-radius: 99px;
  background: var(--card-h); outline: none; cursor: pointer;
}
#zoomSlider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 14px; height: 14px;
  border-radius: 50%; background: var(--accent); cursor: pointer;
  border: 2px solid var(--bg); transition: transform 0.1s;
}
#zoomSlider::-webkit-slider-thumb:hover { transform: scale(1.2); }
#zoomPct { font-family: var(--mono); font-size: 11px; color: var(--muted); min-width: 34px; text-align: right; }
/* ── VIEWER ── */
#viewer {
  position: fixed; inset: 0; z-index: 60;
  background: rgba(4,5,8,0.96); backdrop-filter: blur(8px);
  display: none; flex-direction: column;
}
#viewer.video-mode {
  background: #05070b;
  backdrop-filter: none;
}
#viewer.video-mode #viewerStage {
  contain: layout paint style;
}
#viewer.video-mode #viewerTopBar,
#viewer.video-mode #viewerBottomBar {
  backdrop-filter: none;
}
#viewer.video-mode .vbtn {
  background: rgba(0,0,0,0.45);
}
#viewerVideo {
  max-width: 92vw;
  max-height: 82vh;
  object-fit: contain;
  background: #000;
  transform: translateZ(0);
}
#viewerTopBar {
  height: 54px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
#viewerStage {
  flex: 1; display: flex; align-items: center; justify-content: center;
  position: relative; overflow: hidden;
}
#viewerMedia { max-width: 92vw; max-height: 82vh; object-fit: contain; transition: transform 0.12s; cursor: grab; }
#viewerMedia:active { cursor: grabbing; }
.vbtn {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 40px; height: 40px; border-radius: 10px;
  background: rgba(255,255,255,0.07); border: 1px solid var(--border-h);
  color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: background 0.15s; z-index: 2; flex-shrink: 0;
}
.vbtn:hover { background: rgba(255,255,255,0.15); }
#viewerBottomBar {
  height: 44px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; border-top: 1px solid var(--border); font-size: 12px; color: var(--muted);
  flex-shrink: 0;
}
.viewer-zoom-row {
  display: flex; align-items: center; gap: 8px;
}
.vzbtn {
  background: var(--panel); border: 1px solid var(--border); border-radius: 7px;
  color: var(--muted-l); cursor: pointer; padding: 4px 8px; font-size: 12px;
  transition: background 0.15s; display: flex; align-items: center;
}
.vzbtn:hover { background: var(--card-h); color: var(--text); }
/* ── SORT DROPDOWN ── */
#sortMenu {
  position: absolute; top: calc(100% + 6px); right: 0;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 12px; overflow: hidden; min-width: 200px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
  display: none; z-index: 50;
}
#sortMenu.open { display: block; }
.sort-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; cursor: pointer; font-size: 13px; color: var(--muted-l);
  transition: background 0.1s, color 0.1s;
}
.sort-item:hover { background: var(--card); color: var(--text); }
.sort-item.active { color: var(--accent-h); background: var(--accent-dim); }
.sort-item svg { width: 14px; height: 14px; flex-shrink: 0; }
.sort-divider { height: 1px; background: var(--border); margin: 4px 0; }
.sort-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 8px 14px 4px; }
/* ── STATS ── */
.stat-chip {
  display: flex; align-items: center; gap: 6px;
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 8px; padding: 5px 10px; font-size: 12px; color: var(--muted-l);
}
.stat-chip svg { width: 13px; height: 13px; color: var(--muted); }
/* ── LIST VIEW ── */
.list-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px; border-radius: 10px;
  background: var(--card); border: 1px solid var(--border);
  cursor: pointer; transition: background 0.15s, border-color 0.15s;
}
.list-row:hover { background: var(--card-h); border-color: var(--border-h); }
.list-row.selected {
  border-color: var(--accent) !important;
  background: rgba(91,110,245,0.12);
}
.list-row .sel-indicator {
  position: static;
  margin-right: 8px;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.list-thumb {
  width: 44px; height: 44px; border-radius: 8px;
  object-fit: cover; background: var(--panel); flex-shrink: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
/* ── TOAST ── */
#toast {
  position: fixed; bottom: 90px; right: 24px; z-index: 80;
  background: var(--panel); border: 1px solid var(--border);
  color: var(--text); font-size: 13px; padding: 10px 16px;
  border-radius: 10px; opacity: 0; transform: translateY(6px);
  transition: opacity 0.2s, transform 0.2s; pointer-events: none;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
#toast.show { opacity: 1; transform: translateY(0); }
/* ── RESPONSIVE SUBHEADER ── */
#subbar {
  position: sticky;
  top: var(--topbar-h);
  z-index: 19;
  background: rgba(8,10,15,0.94);
  backdrop-filter: blur(12px);
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
#app { overflow-anchor: none; }
@media (max-width: 480px) {
  #subbar { padding: 8px 10px; }
  #topbar { padding: 8px 10px; }
  .tbtn { padding: 6px 8px; font-size: 11px; }
  #sortBtn span#sortLabel,
  #selectModeBtn span#selectModeLbl,
  #deleteSelectedBtn span#deleteSelectedLbl {
    max-width: 84px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #zoomBar { bottom: 12px; right: 12px; padding: 8px 10px; }
  #zoomSlider { width: 84px; }
  #viewerTopBar { padding: 0 10px; }
  #viewerBottomBar { padding: 0 10px; }
}
/* Final mobile bar layout override (keep at end to win cascade) */
@media (max-width: 768px) {
  #topbar {
    display: grid !important;
    grid-template-columns: auto minmax(0,1fr) auto auto auto;
    grid-template-areas:
      "ham spacer sort view cfg"
      "search search search search search"
      "select select del del del";
    gap: 8px;
    height: auto !important;
    min-height: 56px;
    padding: 10px 12px;
    align-items: center;
  }
  #hamBtn { grid-area: ham; }
  #sortBtn { grid-area: sort; }
  #viewBtn { grid-area: view; }
  #cfgBtn { grid-area: cfg; }
  #selectModeBtn { grid-area: select; width: 100%; justify-content: center; min-width: 0; }
  #deleteSelectedBtn { grid-area: del; width: 100%; justify-content: center; min-width: 0; }
  .search-wrap { grid-area: search; width: 100%; max-width: 100%; min-width: 0; }
  #topbar > div[style*="flex:1"] { grid-area: spacer; min-width: 0; }
  #topbar .tbtn { min-width: 0; }
  #topbar .tbtn span {
    max-width: 92px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  #subbar {
    padding: 8px 12px;
    gap: 8px;
  }
  #statsRow { gap: 6px !important; }
  .stat-chip--compact {
    padding: 4px 8px;
    font-size: 11px;
    border-radius: 999px;
  }
  .stat-chip--compact svg {
    width: 12px;
    height: 12px;
  }
}
/* ── DRAG OVER ── */
.drag-over { outline: 2px dashed var(--accent) !important; outline-offset: 2px; }
/* ── EMPTY STATE ── */
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 80px 20px; color: var(--muted); }
.empty svg { width: 48px; height: 48px; opacity: 0.3; }
/* ── LOADING SKELETON ── */
@keyframes shimmer { 0%,100%{opacity:.4} 50%{opacity:.7} }
.skeleton { background: var(--card); border-radius: 12px; animation: shimmer 1.5s ease infinite; }
/* ── MOBILE OVERLAY ── */
#overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 29; backdrop-filter: blur(2px); }
</style>
</head>
<body>
<!-- Mobile overlay -->
<div id="overlay" onclick="closeSidebar()"></div>
<!-- ── SIDEBAR ──────────────────────────────────────────── -->
<aside id="sidebar">
  <div style="padding:18px 16px 12px; border-bottom:1px solid var(--border);">
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="width:32px;height:32px;border-radius:9px;background:var(--accent-dim);display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-h)" stroke-width="2" style="width:17px;height:17px"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
      </div>
      <div>
        <div style="font-weight:600;font-size:14px;">Vault</div>
        <div style="font-size:11px;color:var(--muted);">Multimedia X8B</div>
      </div>
    </div>
  </div>
  <div style="padding:12px 0;flex:1;overflow-y:auto;">
    <div style="padding:0 16px 6px;font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);">Biblioteca</div>
    <div class="nav-item active" onclick="setTypeFilter('all',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
      Todos los archivos
      <span id="cnt-all" style="margin-left:auto;font-size:11px;font-family:var(--mono);background:var(--border);padding:1px 6px;border-radius:5px;"></span>
    </div>
    <div class="nav-item" onclick="setTypeFilter('recent',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/></svg>
      Recién agregados
      <span id="cnt-recent" style="margin-left:auto;font-size:11px;font-family:var(--mono);background:var(--border);padding:1px 6px;border-radius:5px;"></span>
    </div>
    <div class="nav-item" onclick="setTypeFilter('image',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
      Fotos
      <span id="cnt-image" style="margin-left:auto;font-size:11px;font-family:var(--mono);background:var(--border);padding:1px 6px;border-radius:5px;"></span>
    </div>
    <div class="nav-item" onclick="setTypeFilter('video',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
      Videos
      <span id="cnt-video" style="margin-left:auto;font-size:11px;font-family:var(--mono);background:var(--border);padding:1px 6px;border-radius:5px;"></span>
    </div>
    <div class="nav-item" onclick="setTypeFilter('live',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
      Live Photos
      <span id="cnt-live" style="margin-left:auto;font-size:11px;font-family:var(--mono);background:var(--border);padding:1px 6px;border-radius:5px;"></span>
    </div>
    <div class="nav-item" onclick="setTypeFilter('audio',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      Audio
      <span id="cnt-audio" style="margin-left:auto;font-size:11px;font-family:var(--mono);background:var(--border);padding:1px 6px;border-radius:5px;"></span>
    </div>
    <div class="nav-item" id="favOnlyBtn" onclick="toggleFavoritesOnly()">
      <svg viewBox="0 0 24 24" fill="currentColor" style="width:16px;height:16px"><path d="m12 17.27 5.18 3.05-1.64-5.73L20 10.24l-5.87-.5L12 4.5 9.87 9.74 4 10.24l4.46 4.35-1.64 5.73z"/></svg>
      Favoritos
    </div>
    <div style="padding:16px 16px 6px;margin-top:8px;border-top:1px solid var(--border);font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);">Agrupar por</div>
    <div class="nav-item" id="grp-date" onclick="setGroup('date',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      Fecha
    </div>
    <div class="nav-item" id="grp-type" onclick="setGroup('type',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      Tipo
    </div>
    <div class="nav-item" id="grp-none" onclick="setGroup('none',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      Sin agrupar
    </div>
  </div>
  <div id="sideStats" style="padding:12px 16px;border-top:1px solid var(--border);font-size:11px;color:var(--muted);"></div>
</aside>
<div id="main">
  <header id="topbar">
    <button onclick="openSidebar()" id="hamBtn" style="display:none;background:none;border:none;color:var(--muted-l);cursor:pointer;padding:4px;margin-right:4px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <div class="search-wrap">
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <input id="search" placeholder="Buscar archivos…" autocomplete="off">
    </div>
    <div style="flex:1"></div>
    <div style="position:relative;">
      <button class="tbtn" id="sortBtn" onclick="toggleSortMenu()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
        <span id="sortLabel">Más reciente</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;margin-left:2px"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div id="sortMenu">
        <div class="sort-label">Orden cronológico</div>
        <div class="sort-item active" data-sort="date-desc" onclick="setSort(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h13M3 8h9m-9 4h6m4 0 4-4 4 4"/><path d="M20 4v12"/></svg>
          Más reciente primero
        </div>
        <div class="sort-item" data-sort="date-asc" onclick="setSort(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h13M3 8h9m-9 4h9m5-4v12"/><path d="m17 16 4 4 4-4"/></svg>
          Más antiguo primero
        </div>
        <div class="sort-divider"></div>
        <div class="sort-label">Por tamaño</div>
        <div class="sort-item" data-sort="heavy-desc" onclick="setSort(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Más pesados primero
        </div>
        <div class="sort-item" data-sort="heavy-asc" onclick="setSort(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Más ligeros primero
        </div>
        <div class="sort-divider"></div>
        <div class="sort-label">Alfabético</div>
        <div class="sort-item" data-sort="name-asc" onclick="setSort(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h13M3 8h9m-9 4h9m5-4v12"/></svg>
          Nombre A → Z
        </div>
        <div class="sort-item" data-sort="name-desc" onclick="setSort(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h13M3 8h9m-9 4h6m4 0 4-4 4 4"/></svg>
          Nombre Z → A
        </div>
        <div class="sort-divider"></div>
        <div class="sort-label">Invertido</div>
        <div class="sort-item" data-sort="invert" onclick="setSort(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          Invertir orden actual
        </div>
      </div>
    </div>
    <button class="tbtn" id="viewBtn" onclick="toggleLayout()" title="Cambiar vista">
      <svg id="viewIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
    </button>
    <button class="tbtn" id="selectModeBtn" onclick="toggleSelectMode()" title="Seleccionar archivos">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <span id="selectModeLbl">Seleccionar</span>
    </button>
    <button class="tbtn" id="deleteSelectedBtn" onclick="deleteSelectedFiles()" title="Eliminar seleccionadas" style="display:none;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      <span id="deleteSelectedLbl">Eliminar (0)</span>
    </button>
    <button class="tbtn" id="cfgBtn" onclick="openConfigModal()" title="Configuración">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0A1.65 1.65 0 0 0 9.91 3H10a2 2 0 1 1 4 0h.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0A1.65 1.65 0 0 0 21 9.91H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
    </button>
    <button class="tbtn" id="uploadBtn" onclick="openUploadPicker()" title="Subir fotos/videos">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <span>Subir</span>
    </button>
    <input id="uploadInput" type="file" multiple accept="image/*,video/*,audio/*" style="display:none;">
  </header>
  <div id="subbar">
    <div id="entryFilterWrap" style="display:none;align-items:center;gap:6px;">
      <label for="entryFilter" style="font-size:11px;color:var(--muted);">Entrada</label>
      <select id="entryFilter" class="tbtn" style="justify-content:flex-start;min-width:180px;">
        <option value="all">Todas</option>
      </select>
    </div>
    <div id="selectionChip" class="pill" style="display:none;">
      <span class="dot" style="background:var(--accent);"></span>
      <span id="selectionChipText">0 seleccionados</span>
    </div>
    <div id="statsRow" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1;"></div>
  </div>
  <div id="app" style="padding:20px;flex:1;">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;">
      <div class="skeleton" style="aspect-ratio:1;"></div>
      <div class="skeleton" style="aspect-ratio:1;"></div>
      <div class="skeleton" style="aspect-ratio:1;"></div>
      <div class="skeleton" style="aspect-ratio:1;"></div>
      <div class="skeleton" style="aspect-ratio:1;"></div>
      <div class="skeleton" style="aspect-ratio:1;"></div>
    </div>
  </div>
</div>
<div id="sentinel" style="height:1px;"></div>
<div id="zoomBar">
  <button onclick="stepZoom(-1)" title="Cuadrícula más pequeña">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="5" y1="12" x2="19" y2="12"/></svg>
  </button>
  <input type="range" id="zoomSlider" min="0" max="4" step="1" value="3" oninput="setZoomBySlider(this.value)">
  <button onclick="stepZoom(1)" title="Cuadrícula más grande">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  </button>
  <span id="zoomPct">M</span>
</div>
<div id="viewer">
  <div id="viewerTopBar">
    <span id="viewerName" style="font-size:13px;color:var(--muted-l);max-width:40vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>
    <div style="display:flex;align-items:center;gap:8px;">
      <a id="viewerDl" download style="display:flex;align-items:center;gap:6px;background:var(--accent);color:#fff;font-size:12px;font-weight:500;padding:6px 12px;border-radius:8px;text-decoration:none;transition:background 0.15s;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Descargar
      </a>
      <button id="viewerFavBtn" onclick="toggleViewerFavorite()" style="display:flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--border);color:var(--muted-l);font-size:12px;font-weight:500;padding:6px 10px;border-radius:8px;cursor:pointer;">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:13px;height:13px"><path d="m12 17.27 5.18 3.05-1.64-5.73L20 10.24l-5.87-.5L12 4.5 9.87 9.74 4 10.24l4.46 4.35-1.64 5.73z"/></svg>
        Favorito
      </button>
      <button onclick="closeViewer()" style="background:var(--panel);border:1px solid var(--border);color:var(--muted-l);width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:background 0.15s;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>
  <div id="viewerStage">
    <button class="vbtn" style="left:16px;" onclick="viewerNav(-1)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <img id="viewerMedia" src="" alt="" style="display:none;">
    <video id="viewerVideo" controls loop playsinline webkit-playsinline="true" style="display:none;max-width:92vw;max-height:82vh;"></video>
    <div id="viewerVideoFallback" style="display:none;flex-direction:column;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--border);padding:18px 16px;border-radius:12px;max-width:520px;">
      <p style="font-size:13px;color:var(--muted-l);text-align:center;">No se pudo reproducir este video (codec no compatible o archivo dañado). Intenta descargarlo y reproducirlo en tu computadora.</p>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;">
        <a id="viewerOpenTab" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:6px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-size:12px;font-weight:500;padding:7px 12px;border-radius:8px;text-decoration:none;">
          Abrir en pestaña
        </a>
        <a id="viewerFallbackDl" download style="display:flex;align-items:center;gap:6px;background:var(--accent);color:#fff;font-size:12px;font-weight:500;padding:7px 12px;border-radius:8px;text-decoration:none;">
          Descargar
        </a>
      </div>
    </div>
    <div id="viewerAudio" style="display:none;flex-direction:column;align-items:center;gap:20px;color:var(--muted-l);">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" style="width:80px;height:80px;opacity:.6"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <p id="viewerAudioName" style="font-size:13px;"></p>
      <audio id="viewerAudioEl" controls style="width:260px;"></audio>
    </div>
    <button class="vbtn" style="right:16px;" onclick="viewerNav(1)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="m9 18 6-6-6-6"/></svg>
    </button>
  </div>
  <div id="viewerBottomBar">
    <span id="viewerIdx" style="font-family:var(--mono);"></span>
    <span id="viewerLiveHint" style="display:none;font-size:11px;color:var(--muted);">Generando versión optimizada…</span>
    <div class="viewer-zoom-row">
      <button class="vzbtn" onclick="viewerZoom(-0.25)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <span id="viewerZoomLbl" style="font-family:var(--mono);font-size:11px;color:var(--muted);min-width:38px;text-align:center;">100%</span>
      <button class="vzbtn" onclick="viewerZoom(0.25)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button class="vzbtn" onclick="viewerZoom(0)" style="margin-left:4px;font-size:11px;">Restablecer</button>
    </div>
    <span id="viewerDate" style="font-size:11px;color:var(--muted);"></span>
  </div>
</div>
<div id="toast"></div>
<div id="cfgModal" style="display:none;position:fixed;inset:0;z-index:85;background:rgba(0,0,0,.65);backdrop-filter:blur(2px);">
  <div style="max-width:680px;margin:8vh auto;background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);">
      <strong style="font-size:13px;">Configuración de Sources</strong>
      <button class="tbtn" onclick="closeConfigModal()">Cerrar</button>
    </div>
    <div style="padding:14px;display:flex;flex-direction:column;gap:10px;">
      <label style="font-size:12px;color:var(--muted-l);">Modo activo</label>
      <select id="cfgSourceMode" class="tbtn" style="justify-content:flex-start;width:220px;">
        <option value="filesystem">filesystem (mediaRoots)</option>
        <option value="autoindex">autoindex (autoindexRootUrls)</option>
        <option value="mixed">mixed (mediaRoots + autoindexRootUrls)</option>
      </select>
      <label style="font-size:12px;color:var(--muted-l);">mediaRoots (uno por línea)</label>
      <textarea id="cfgMediaRoots" style="width:100%;min-height:92px;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px;font-family:var(--mono);font-size:12px;"></textarea>
      <label style="font-size:12px;color:var(--muted-l);">autoindexRootUrls (uno por línea)</label>
      <textarea id="cfgAutoRoots" style="width:100%;min-height:92px;background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px;font-family:var(--mono);font-size:12px;"></textarea>
      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
        <button class="tbtn" onclick="loadConfigModalData()">Recargar</button>
        <button class="tbtn active" onclick="saveConfigModalData()">Guardar</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;justify-content:flex-start;flex-wrap:wrap;padding-top:4px;border-top:1px solid var(--border);">
        <button class="tbtn" onclick="cleanupCacheTargets(['thumb-cache'])">Limpiar .thumb-cache</button>
        <button class="tbtn" onclick="cleanupCacheTargets(['temp-livephotos'])">Limpiar .temp_livephotos</button>
        <button class="tbtn" onclick="cleanupCacheTargets(['thumb-cache','temp-livephotos'])">Limpiar ambas</button>
        <button class="tbtn" onclick="loadCacheStats()">Refrescar tamaños</button>
      </div>
      <div id="cacheStatsBox" style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
        <div>.thumb-cache: <span id="cacheThumbSize" style="font-family:var(--mono);">-</span></div>
        <div>.temp_livephotos: <span id="cacheLiveSize" style="font-family:var(--mono);">-</span></div>
        <div>Total: <span id="cacheTotalSize" style="font-family:var(--mono);">-</span></div>
      </div>
      <div style="font-size:11px;color:var(--muted);">Nota: mixed usa ambas listas; filesystem/autoindex usan solo su lista. Después de guardar, reinicia el servidor para aplicar cambios.</div>
    </div>
  </div>
</div>
<script type="module" src="./js/app/main.js"></script>
</body>
</html>
```

## File: server.mjs
```javascript
async function readConfig()
⋮----
async function writeConfig(cfg)
⋮----
function json(res, code, payload)
⋮----
function nowIso()
⋮----
function toBool(value, fallback = false)
⋮----
async function pathExists(p)
⋮----
function buildFilesystemFingerprintFromIndex(files)
⋮----
function sanitizeFilename(name)
⋮----
function parseMultipartParts(buffer, boundary)
⋮----
function parseContentDisposition(value)
⋮----
async function runWithConcurrency(items, limit, worker)
⋮----
async function boot()
⋮----
const log = (...args) =>
⋮----
async function serveFile(req, res, absolutePath)
⋮----
// Be tolerant with client prefetch ranges (e.g. bytes=0-65535 on small files).
⋮----
async function persistIndex(payload)
⋮----
async function loadPersistedIndex()
⋮----
async function buildFilesystemQuickFingerprint()
⋮----
async function ensureScan()
⋮----
function triggerScanDebounced()
⋮----
async function triggerScanIfFilesystemChanged(reason = "periodic")
⋮----
// Keep service running even if recursive watch is not supported.
⋮----
function resolveWorkerCount()
⋮----
function shouldUseCluster()
⋮----
async function start()
```

## File: js/app/main.js
```javascript
class PreloadManager
⋮----
reset()
⋮----
enqueue(task)
⋮----
drain()
⋮----
function videoTaskKey(src, mode = "thumb")
⋮----
function isFavorite(url)
⋮----
function persistFavorites()
⋮----
function toggleFavorite(url)
⋮----
function updateFavOnlyBtn()
⋮----
function toggleFavoritesOnly()
⋮----
function updateViewerFavoriteBtn(file)
⋮----
function toggleViewerFavorite()
⋮----
function updateSelectionUI()
⋮----
function refreshVisibleSelectionState()
⋮----
function toggleSelectMode()
⋮----
function getFilteredIndexByUrl(url)
⋮----
function selectRange(fromUrl, toUrl)
⋮----
function handleItemSelection(file, evt)
⋮----
// Click normal in selection mode: toggle without clearing others.
⋮----
async function deleteSelectedFiles()
⋮----
function queueVideoThumbLoad(el, src)
⋮----
onStateChange: (state) =>
run: async (attempt) =>
⋮----
function cleanupVideoThumb(el)
⋮----
function requestVideoThumbPreview(
  el,
  src,
  delayMs = VIDEO_THUMB_DEFER_MS,
  force = false,
)
⋮----
const run = () =>
⋮----
function resetThumbPrewarmState()
⋮----
async function fetchThumbWithRetry(url, retries = THUMB_PREWARM_RETRIES)
⋮----
function drainThumbPrewarmQueue()
⋮----
function enqueueThumbPrewarm(files)
⋮----
function openSidebar()
function closeSidebar()
⋮----
function isIosWebkitLike()
⋮----
function disableStickyForIosMobile()
⋮----
function checkMobile()
⋮----
function syncStickyBars()
⋮----
function enforceMobileGridSize()
⋮----
function guessDate(name, path)
⋮----
function dbg(...args)
⋮----
async function loadConfigModalData()
⋮----
function openConfigModal()
⋮----
function closeConfigModal()
⋮----
function formatDateGroupLabel(groupKey)
⋮----
function openUploadPicker()
⋮----
async function uploadSelectedFiles(evt)
⋮----
async function saveConfigModalData()
⋮----
async function cleanupCacheTargets(targets)
⋮----
function formatBytes(bytes)
⋮----
async function loadCacheStats()
⋮----
function setViewerVideoFallback(file, visible)
⋮----
function showViewerStaticFromVideo(file, reason = "")
⋮----
function nowMs()
⋮----
function needsWebVideoTranscode(file)
⋮----
function setLiveHint(msg = "")
⋮----
function stopLiveStatusPolling()
⋮----
function fallbackToDirectVideoPlayback(file, videoEl)
⋮----
async function startLivePrepareAndPoll(
  file,
  videoEl,
  autoPlayWhenReady = false,
)
⋮----
function bindViewerVideoEvents(videoEl)
⋮----
const softRecover = (kind) =>
⋮----
function normalizeDate(dateStr, fallbackName, fallbackUrl)
⋮----
function normalizeIndexedFile(f)
⋮----
function updateEntryFilterUI()
⋮----
async function loadIndex()
⋮----
function indexBackoffMs()
⋮----
function applyNewFileSet(nextFiles, source)
⋮----
function startIndexPolling()
⋮----
function updateStats()
⋮----
function placeholder(type)
⋮----
// Legacy chunk/lazy/infinite rendering removed. Virtual renderer is the
// single source of DOM updates and thumbnail hydration.
⋮----
function suspendThumbLoading(on)
⋮----
// Keep legacy observers disconnected. Virtual renderer hydrates thumbs.
⋮----
function beginViewerPriorityLoad()
⋮----
function endViewerPriorityLoad(token, preloadNeighbors = true)
⋮----
// Keep grid/background thumbnail loading paused while viewer is open.
// It will be resumed on closeViewer().
⋮----
// ── REORDER ───────────────────────────────────────────────────
function reorder(srcUrl, dstUrl)
⋮----
// ── ZOOM BAR ─────────────────────────────────────────────────
⋮----
function stepZoom(d)
function setZoomBySlider(v)
⋮----
// ── LAYOUT ────────────────────────────────────────────────────
function toggleLayout()
⋮----
// ── SORT ─────────────────────────────────────────────────────
⋮----
function toggleSortMenu()
function setSort(el)
⋮----
// ── SIDEBAR NAV ───────────────────────────────────────────────
function setTypeFilter(type, el)
function setGroup(g, el)
⋮----
// ── VIEWER ────────────────────────────────────────────────────
function openViewer(idx)
⋮----
function preloadViewerNeighbors(centerIdx)
⋮----
run: async () =>
⋮----
function renderViewer()
⋮----
const promoteOriginal = (attempt = 0) =>
⋮----
// iPhone: show a good preview quickly, then upgrade to original.
⋮----
img.onerror = () =>
⋮----
function closeViewer()
⋮----
function viewerNav(d)
⋮----
function viewerZoom(d)
⋮----
// Wheel zoom in viewer
⋮----
// Drag-to-pan in viewer
⋮----
// Mobile swipe navigation (images only)
⋮----
// Keyboard
⋮----
// Close viewer on background click
⋮----
// ── TOAST ─────────────────────────────────────────────────────
function toast(msg, ms = 2200)
⋮----
// ── EVENTS ────────────────────────────────────────────────────
⋮----
// ── VIRTUAL RENDER + IDB THUMB CACHE ────────────────────────
⋮----
function scheduleIdbSweep()
⋮----
function getThumbNodeState(el)
⋮----
status: "idle", // idle|loading|loaded|failed|stale
⋮----
function openThumbDb()
⋮----
req.onupgradeneeded = () =>
req.onsuccess = ()
req.onerror = ()
⋮----
async function idbGet(key)
⋮----
async function idbPut(record)
⋮----
tx.oncomplete = ()
tx.onerror = ()
⋮----
async function idbSweep(limitBytes = THUMB_MAX_BYTES)
⋮----
function makeThumbCacheKey(file, src, level = "u")
⋮----
async function getThumbObjectUrl(
  file,
  src,
  level = "u",
  signal,
  allowWhenSuspended = false,
)
⋮----
async function mountThumbWithSwap(el, file, src, level = "u", blurPx = 0)
⋮----
img.onload = ()
img.onerror = ()
⋮----
// Commit only after successful decode/load; keep previous image until now.
⋮----
function revokeObjectUrlsInNode(node)
⋮----
function invalidateVirtualRowCache()
⋮----
function makeThumbNode(file, isList = false, shouldHydrate = true)
⋮----
function hydrateThumbNode(el, file)
⋮----
const retryLater = () =>
⋮----
function rehydrateFailedThumbs(container)
⋮----
// Non-destructive rehydrate: keep previous visual when available.
⋮----
function getGridColumns()
⋮----
function rebuildVirtualRows()
⋮----
function findRowIndexAt(offsetPx)
⋮----
function renderVirtualViewport()
⋮----
const shouldHydrateRow = (rowIdx)
⋮----
const createRowNode = (row, rowIdx) =>
⋮----
card.onclick = (e) =>
⋮----
dl.onclick = (ev)
⋮----
el.onclick = (e) =>
⋮----
function getStableViewportWidth()
⋮----
function getViewportOrientation()
⋮----
function hasCoarsePointer()
⋮----
function useStaticViewportOnIosMobile()
⋮----
function captureVirtualAnchor()
⋮----
function restoreVirtualAnchor(anchor)
function scheduleVirtualRender()
⋮----
function applyFilters()
⋮----
// ── INIT ──────────────────────────────────────────────────────
```
