import {
  INDEX_URL,
  CONFIG_URL,
  CACHE_CLEANUP_URL,
  CACHE_STATS_URL,
  UPLOAD_URL,
  DELETE_URL,
  LIVE_PREPARE_URL,
  LIVE_STATUS_URL,
  FAVORITES_KEY,
  INDEX_POLL_MS,
  DEBUG_CLIENT,
  IMG,
  VID,
  AUD,
  SIZES,
  SIZE_PX,
} from "./config.js";
import { createStore } from "./state/store.js";
import { createFavoritesRepository } from "./infrastructure/favorites.repository.js";
import {
  prettyDate,
  dateRank,
  monthGroupKey,
  monthGroupRank,
  monthGroupLabel,
} from "./core/date-utils.js";
import { applyFiltersUseCase } from "./application/apply-filters.usecase.js";

let allFiles = [],
  filteredFiles = [];
let sizeIdx = 3;
let lastDesktopSizeIdx = 3;
let mobileGridInitialized = false;
let layoutMode = "grid";
let currentSort = "date-desc";
let lastSort = "date-desc";
let currentGroup = "date";
let currentType = "all";
let currentEntry = "all";
let favoritesOnly = false;
let dragSrc = null;
let renderedGroups = 0,
  groupKeys = [],
  groupMap = {};
let vZoom = 1,
  vOffX = 0,
  vOffY = 0,
  vDragging = false,
  vLastX = 0,
  vLastY = 0;
let currentViewerIdx = 0;
let touchStartX = 0,
  touchStartY = 0,
  touchLastX = 0,
  touchLastY = 0,
  touchTracking = false;
let currentIndexVersion = null;
let indexPollTimer = null;
let indexRetryCount = 0;
let sentinelObs = null;
let viewerVideoErrBound = false;
let viewerVideoPerf = null;
let thumbLoadingSuspended = false;
let viewerPriorityToken = 0;
let viewerPriorityActive = false;
let viewerIsOpen = false;
let viewerLivePlayBound = false;
let liveStatusTimer = null;
let livePrepareInFlightKey = "";
let livePrepareLastStartAt = 0;
const appStore = createStore({
  sizeIdx,
  lastDesktopSizeIdx,
  layoutMode,
  currentSort,
  currentGroup,
  currentType,
  currentEntry,
  favoritesOnly,
});
const favoritesRepo = createFavoritesRepository(FAVORITES_KEY);
let favoriteUrls = favoritesRepo.load();
const dataMetrics = {
  rawCount: 0,
  validCount: 0,
  discardedCount: 0,
  fallbackDateCount: 0,
};
const VIDEO_MAX_CONCURRENT = 2;
const VIDEO_RETRY_COUNT = 2;
const VIDEO_RETRY_BASE_DELAY_MS = 220;
const VIDEO_THUMB_DEFER_MS = 260;
const THUMB_PREWARM_CONCURRENCY = 2;
const THUMB_PREWARM_RETRIES = 2;
const videoLoader = new window.MediaLoader.VideoQueueLoader({
  maxConcurrent: VIDEO_MAX_CONCURRENT,
  retryCount: VIDEO_RETRY_COUNT,
  retryBaseDelayMs: VIDEO_RETRY_BASE_DELAY_MS,
});
let thumbPrewarmQueue = [];
let thumbPrewarmActive = 0;
let thumbPrewarmSeen = new Set();
let thumbPrewarmInFlight = new Set();
const PRELOAD_WINDOW = 2;

class PreloadManager {
  constructor(options = {}) {
    this.maxConcurrent = Number.isInteger(options.maxConcurrent)
      ? options.maxConcurrent
      : 2;
    this.queue = [];
    this.active = 0;
    this.generation = 0;
    this.seen = new Set();
  }

  reset() {
    this.generation += 1;
    this.queue = [];
  }

  enqueue(task) {
    if (!task?.key || this.seen.has(task.key)) return;
    this.seen.add(task.key);
    this.queue.push({ ...task, generation: this.generation });
    this.queue.sort((a, b) => (a.priority || 99) - (b.priority || 99));
    this.drain();
  }

  drain() {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) continue;
      this.active += 1;
      Promise.resolve()
        .then(() => {
          if (task.generation !== this.generation) return;
          return task.run?.();
        })
        .catch(() => {})
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const preloadManager = new PreloadManager({ maxConcurrent: 2 });
let selectionMode = false;
let selectedUrls = new Set();
let lastSelectedUrl = "";

function videoTaskKey(src, mode = "thumb") {
  return `video:${mode}:${src}`;
}

function isFavorite(url) {
  return favoriteUrls.has(url);
}

function persistFavorites() {
  favoritesRepo.save(favoriteUrls);
}

function toggleFavorite(url) {
  if (!url) return;
  if (favoriteUrls.has(url)) favoriteUrls.delete(url);
  else favoriteUrls.add(url);
  persistFavorites();
}

function updateFavOnlyBtn() {
  const btn = document.getElementById("favOnlyBtn");
  if (!btn) return;
  btn.classList.toggle("active", favoritesOnly);
}

function toggleFavoritesOnly() {
  favoritesOnly = !favoritesOnly;
  updateFavOnlyBtn();
  applyFilters();
}

function updateViewerFavoriteBtn(file) {
  const btn = document.getElementById("viewerFavBtn");
  if (!btn) return;
  const canFav = file && (file.type === "image" || file.type === "video");
  btn.style.display = canFav ? "flex" : "none";
  if (!canFav) return;
  const active = isFavorite(file.url);
  btn.style.color = active ? "var(--accent-h)" : "var(--muted-l)";
  btn.style.borderColor = active ? "var(--accent)" : "var(--border)";
}

function toggleViewerFavorite() {
  const f = filteredFiles[currentViewerIdx];
  if (!f || (f.type !== "image" && f.type !== "video")) return;
  toggleFavorite(f.url);
  updateViewerFavoriteBtn(f);
  applyFilters();
}

function updateSelectionUI() {
  const modeBtn = document.getElementById("selectModeBtn");
  const modeLbl = document.getElementById("selectModeLbl");
  const delBtn = document.getElementById("deleteSelectedBtn");
  const delLbl = document.getElementById("deleteSelectedLbl");
  const chip = document.getElementById("selectionChip");
  const chipText = document.getElementById("selectionChipText");
  if (modeBtn) modeBtn.classList.toggle("active", selectionMode);
  if (modeLbl)
    modeLbl.textContent = selectionMode ? "Seleccionando" : "Seleccionar";
  if (delBtn) delBtn.style.display = selectionMode ? "flex" : "none";
  if (delLbl) delLbl.textContent = `Eliminar (${selectedUrls.size})`;
  if (chip) chip.style.display = selectionMode ? "inline-flex" : "none";
  if (chipText)
    chipText.textContent = `${selectedUrls.size} seleccionado${selectedUrls.size === 1 ? "" : "s"}`;
  syncStickyBars();
}

function refreshVisibleSelectionState() {
  document
    .querySelectorAll(".media-card[data-url], .list-row[data-url]")
    .forEach((el) => {
      const url = el.dataset.url || "";
      const selected = Boolean(selectionMode && url && selectedUrls.has(url));
      el.classList.toggle("selected", selected);
      const prev = el.querySelector(".sel-indicator");
      if (!selected) {
        if (prev) prev.remove();
        return;
      }
      if (prev) return;
      const mark = document.createElement("div");
      mark.className = "sel-indicator";
      mark.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg>';
      if (el.classList.contains("list-row")) {
        el.insertBefore(mark, el.firstChild);
      } else {
        el.appendChild(mark);
      }
    });
}

function toggleSelectMode() {
  selectionMode = !selectionMode;
  if (!selectionMode) {
    selectedUrls.clear();
    lastSelectedUrl = "";
  }
  updateSelectionUI();
  refreshVisibleSelectionState();
}

function getFilteredIndexByUrl(url) {
  return filteredFiles.findIndex((f) => f?.url === url);
}

function selectRange(fromUrl, toUrl) {
  const a = getFilteredIndexByUrl(fromUrl);
  const b = getFilteredIndexByUrl(toUrl);
  if (a < 0 || b < 0) return;
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  for (let i = start; i <= end; i += 1) {
    const u = filteredFiles[i]?.url;
    if (u) selectedUrls.add(u);
  }
}

function handleItemSelection(file, evt) {
  if (!selectionMode || !file?.url) return false;
  const url = file.url;
  if (evt?.shiftKey && lastSelectedUrl) {
    selectRange(lastSelectedUrl, url);
  } else if (evt?.ctrlKey || evt?.metaKey) {
    if (selectedUrls.has(url)) selectedUrls.delete(url);
    else selectedUrls.add(url);
    lastSelectedUrl = url;
  } else {
    // Click normal in selection mode: toggle without clearing others.
    if (selectedUrls.has(url)) selectedUrls.delete(url);
    else selectedUrls.add(url);
    lastSelectedUrl = url;
  }
  updateSelectionUI();
  refreshVisibleSelectionState();
  return true;
}

async function deleteSelectedFiles() {
  if (!selectionMode) return;
  if (!selectedUrls.size) {
    toast("No hay archivos seleccionados");
    return;
  }
  const count = selectedUrls.size;
  const ok = window.confirm(
    `¿Eliminar ${count} archivo${count !== 1 ? "s" : ""} de la lista actual?`,
  );
  if (!ok) return;
  const urls = Array.from(selectedUrls);
  try {
    const res = await fetch(DELETE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    const deletedSet = new Set(
      Array.isArray(payload.deleted) ? payload.deleted : [],
    );
    const deletedCount = deletedSet.size;
    allFiles = allFiles.filter((f) => !deletedSet.has(f.url));
    selectedUrls.clear();
    lastSelectedUrl = "";
    updateSelectionUI();
    applyFilters();
    if (deletedCount > 0) {
      toast(
        `${deletedCount} archivo${deletedCount !== 1 ? "s" : ""} eliminado${deletedCount !== 1 ? "s" : ""}`,
      );
    }
    const failed = Array.isArray(payload.failed) ? payload.failed.length : 0;
    if (failed > 0) {
      toast(
        `${failed} archivo${failed !== 1 ? "s" : ""} no se pudieron borrar`,
        4200,
      );
    }
  } catch (err) {
    toast(`No se pudo eliminar: ${err.message}`, 4200);
  }
}

function queueVideoThumbLoad(el, src) {
  const key = videoTaskKey(src, "thumb");
  return videoLoader.enqueue({
    key,
    priority: "normal",
    onStateChange: (state) => {
      el.dataset.videoState = state;
      if (state === "failed") {
        el.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--card);color:var(--muted);font-size:10px;">No se pudo cargar</div>`;
      }
    },
    run: async (attempt) => {
      const staticThumb = el.dataset.thumb || "";
      if (staticThumb) {
        try {
          const img = await window.MediaLoader.loadImageWithRetry(
            attempt === 0
              ? staticThumb
              : `${staticThumb}${staticThumb.includes("?") ? "&" : "?"}r=${Date.now()}`,
            { retries: 1, retryDelayMs: 120 },
          );
          img.style.cssText =
            "width:100%;height:100%;object-fit:cover;border-radius:inherit;";
          el.innerHTML = "";
          el.appendChild(img);
          el.dataset.loaded = "1";
          return img;
        } catch (_) {
          // Cache miss after cleanup: fallback to dynamic video preview.
        }
      }
      let vid = el.querySelector("video");
      if (!vid) {
        vid = document.createElement("video");
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = "none";
        vid.style.cssText = "width:100%;height:100%;object-fit:cover;";
        el.innerHTML = "";
        el.appendChild(vid);
      }
      await window.MediaLoader.loadVideoPreview(vid, src, attempt);
      el.dataset.loaded = "1";
      return vid;
    },
  });
}

function cleanupVideoThumb(el) {
  const src = el.dataset.src;
  if (!src || el.dataset.type !== "video") return;
  videoLoader.cancel(videoTaskKey(src, "thumb"));
  const vid = el.querySelector("video");
  if (vid) window.MediaLoader.releaseVideo(vid);
  el.dataset.loaded = "0";
  el.dataset.loading = "0";
  el.dataset.videoRequested = "0";
  el.dataset.videoState = "idle";
  el.innerHTML = placeholder("video");
}

function requestVideoThumbPreview(
  el,
  src,
  delayMs = VIDEO_THUMB_DEFER_MS,
  force = false,
) {
  if (thumbLoadingSuspended) return;
  if (!el || !src) return;
  if (
    !force &&
    (el.dataset.loaded === "1" ||
      el.dataset.loading === "1" ||
      el.dataset.videoRequested === "1")
  )
    return;
  el.dataset.videoRequested = "1";
  const run = () => {
    el.dataset.loading = "1";
    queueVideoThumbLoad(el, src)
      .catch((err) => {
        el.dataset.loaded = "0";
        dbg("video thumb failed", {
          url: src,
          reason: err?.message || "unknown",
        });
      })
      .finally(() => {
        el.dataset.loading = "0";
        el.dataset.videoRequested = "0";
      });
  };
  if (delayMs > 0) setTimeout(run, delayMs);
  else run();
}

function resetThumbPrewarmState() {
  thumbPrewarmQueue = [];
  thumbPrewarmActive = 0;
  thumbPrewarmSeen = new Set();
  thumbPrewarmInFlight = new Set();
}

async function fetchThumbWithRetry(url, retries = THUMB_PREWARM_RETRIES) {
  if (thumbLoadingSuspended) throw new Error("suspended");
  let attempt = 0;
  while (attempt <= retries) {
    try {
      if (thumbLoadingSuspended) throw new Error("suspended");
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return true;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    attempt += 1;
  }
  return false;
}

function drainThumbPrewarmQueue() {
  if (thumbLoadingSuspended) return;
  while (
    thumbPrewarmActive < THUMB_PREWARM_CONCURRENCY &&
    thumbPrewarmQueue.length > 0
  ) {
    const task = thumbPrewarmQueue.shift();
    if (!task || !task.url) continue;
    if (thumbPrewarmSeen.has(task.url)) continue;
    if (thumbPrewarmInFlight.has(task.url)) continue;
    thumbPrewarmInFlight.add(task.url);
    thumbPrewarmActive += 1;
    fetchThumbWithRetry(task.url, THUMB_PREWARM_RETRIES)
      .then(() => {
        thumbPrewarmSeen.add(task.url);
      })
      .catch(() => {
        // keep non-blocking: card-level loader will still attempt on demand
      })
      .finally(() => {
        thumbPrewarmInFlight.delete(task.url);
        thumbPrewarmActive -= 1;
        drainThumbPrewarmQueue();
      });
  }
}

function enqueueThumbPrewarm(files) {
  if (!Array.isArray(files) || files.length === 0) return;
  for (const f of files) {
    if (!f || f.type !== "video") continue;
    const u =
      typeof f.thumbUrl === "string" && f.thumbUrl.trim()
        ? f.thumbUrl.trim()
        : `/thumb/video?src=${encodeURIComponent(f.url)}&v=0`;
    if (!u) continue;
    if (thumbPrewarmSeen.has(u) || thumbPrewarmInFlight.has(u)) continue;
    thumbPrewarmQueue.push({ url: u });
  }
  drainThumbPrewarmQueue();
}

// ── MOBILE SIDEBAR ───────────────────────────────────────────
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("overlay").classList.add("open");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("open");
}

let stickyScrollAt = 0;
let stickySyncTimer = null;

function isIosWebkitLike() {
  const ua = navigator.userAgent || "";
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIOS;
}

function disableStickyForIosMobile() {
  if (!isIosWebkitLike()) return;
  if (window.innerWidth > 768) return;
  const topbar = document.getElementById("topbar");
  const subbar = document.getElementById("subbar");
  if (topbar) {
    topbar.style.position = "relative";
    topbar.style.top = "auto";
  }
  if (subbar) {
    subbar.style.position = "relative";
    subbar.style.top = "auto";
    subbar.style.zIndex = "1";
  }
}

// Check if mobile
function checkMobile() {
  const isMobile = window.innerWidth <= 768;
  document.getElementById("hamBtn").style.display = isMobile ? "flex" : "none";
  disableStickyForIosMobile();
  syncStickyBars();
}
window.addEventListener("resize", checkMobile);
checkMobile();
disableStickyForIosMobile();

function syncStickyBars() {
  const topbar = document.getElementById("topbar");
  if (!topbar) return;
  // iOS/WebKit: while scrolling, URL bar transitions trigger rapid viewport changes.
  // Updating sticky offsets in that moment can cause visible snap/jump.
  if (isIosWebkitLike() && window.innerWidth <= 768) {
    if (Date.now() - stickyScrollAt < 420) {
      if (stickySyncTimer) clearTimeout(stickySyncTimer);
      stickySyncTimer = setTimeout(() => {
        stickySyncTimer = null;
        syncStickyBars();
      }, 260);
      return;
    }
  }
  const h = Math.max(
    56,
    Math.ceil(
      topbar.getBoundingClientRect().height || topbar.offsetHeight || 56,
    ),
  );
  const root = document.documentElement;
  const prev =
    Number.parseInt(
      getComputedStyle(root).getPropertyValue("--topbar-h"),
      10,
    ) || 56;
  if (Math.abs(prev - h) < 2) return;
  root.style.setProperty("--topbar-h", `${h}px`);
}
window.addEventListener("resize", syncStickyBars, { passive: true });
window.addEventListener(
  "scroll",
  () => {
    stickyScrollAt = Date.now();
  },
  { passive: true },
);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", disableStickyForIosMobile, {
    passive: true,
  });
  window.visualViewport.addEventListener("resize", syncStickyBars, {
    passive: true,
  });
  window.visualViewport.addEventListener(
    "scroll",
    () => {
      stickyScrollAt = Date.now();
    },
    { passive: true },
  );
}

function enforceMobileGridSize() {
  const isMobile = window.innerWidth <= 768;
  const slider = document.getElementById("zoomSlider");
  if (isMobile) {
    if (!mobileGridInitialized) {
      if (sizeIdx !== 2) lastDesktopSizeIdx = sizeIdx;
      sizeIdx = 2; // M on phones
      if (slider) slider.value = "2";
      document.getElementById("zoomPct").textContent = SIZES[sizeIdx];
      mobileGridInitialized = true;
      if (groupKeys.length) {
        rebuildVirtualRows();
        scheduleVirtualRender();
      }
    }
    return;
  }
  mobileGridInitialized = false;
  if (sizeIdx === 2 && lastDesktopSizeIdx !== 2) {
    sizeIdx = lastDesktopSizeIdx;
    if (slider) slider.value = String(sizeIdx);
    document.getElementById("zoomPct").textContent = SIZES[sizeIdx];
    if (groupKeys.length) {
      rebuildVirtualRows();
      scheduleVirtualRender();
    }
  }
}
window.addEventListener("resize", enforceMobileGridSize);

// ── DATE GUESS ───────────────────────────────────────────────
function guessDate(name, path) {
  const text = decodeURIComponent(name + " " + path);
  let m = text.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) {
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)
      return `${m[1]}-${m[2]}-${m[3]}`;
  }
  m = text.match(/(20\d{2})/);
  if (m) return `${m[1]}-XX-XX`;
  return "0000-sin-fecha";
}

// ── LOAD FILES ───────────────────────────────────────────────
async function listDir(path) {
  const res = await fetch(path);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const a of doc.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("?") || href === "../") continue;
    const full = new URL(href, location.origin + path).pathname;
    if (href.endsWith("/")) {
      await listDir(full);
      continue;
    }
    const type = IMG.test(href)
      ? "image"
      : VID.test(href)
        ? "video"
        : AUD.test(href)
          ? "audio"
          : null;
    if (!type) continue;
    // estimate size from name pattern or default
    const sizeEst = Math.floor(Math.random() * 8000000) + 200000; // placeholder until actual HEAD requests
    allFiles.push({
      url: full,
      name: decodeURIComponent(href),
      type,
      date: guessDate(href, full),
      size: sizeEst,
    });
  }
}

function dbg(...args) {
  if (!DEBUG_CLIENT) return;
  console.log("[DEBUG-CLIENT]", ...args);
}

async function loadConfigModalData() {
  try {
    const res = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    document.getElementById("cfgSourceMode").value =
      cfg.sourceMode || "filesystem";
    document.getElementById("cfgMediaRoots").value = (
      cfg.mediaRoots || []
    ).join("\n");
    document.getElementById("cfgAutoRoots").value = (
      cfg.autoindexRootUrls || []
    ).join("\n");
  } catch (err) {
    toast(`No se pudo cargar config: ${err.message}`);
  }
}

function openConfigModal() {
  document.getElementById("cfgModal").style.display = "block";
  loadConfigModalData();
  loadCacheStats();
}

function closeConfigModal() {
  document.getElementById("cfgModal").style.display = "none";
}

function formatDateGroupLabel(groupKey) {
  const k = String(groupKey || "");
  if (k === "0000-sin-fecha") return "Sin fecha";
  const full = k.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) {
    return `${monthGroupLabel(`${full[1]}-${full[2]}`)} · ${full[3]}`;
  }
  const yearOnly = k.match(/^(\d{4})-XX-XX$/);
  if (yearOnly) return yearOnly[1];
  return monthGroupLabel(k);
}

function openUploadPicker() {
  const input = document.getElementById("uploadInput");
  if (!input) return;
  input.value = "";
  input.click();
}

async function uploadSelectedFiles(evt) {
  const input = evt?.target;
  const files = Array.from(input?.files || []);
  if (!files.length) return;
  const btn = document.getElementById("uploadBtn");
  const prevLabel = btn?.querySelector("span")?.textContent || "Subir";
  if (btn) {
    btn.disabled = true;
    const label = btn.querySelector("span");
    if (label) label.textContent = "Subiendo...";
  }
  try {
    const form = new FormData();
    for (const f of files) form.append("files", f, f.name);
    const res = await fetch(UPLOAD_URL, {
      method: "POST",
      body: form,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    toast(`Subidos ${payload.uploaded || files.length}. Reindexando...`, 2800);
    try {
      const idx = await loadIndex();
      if (idx.version !== currentIndexVersion) {
        currentIndexVersion = idx.version;
        applyNewFileSet(idx.files, "poll");
      }
    } catch (_) {
      // polling will refresh when index is ready
    }
  } catch (err) {
    toast(`Error al subir: ${err.message}`, 4200);
  } finally {
    if (btn) {
      btn.disabled = false;
      const label = btn.querySelector("span");
      if (label) label.textContent = prevLabel;
    }
    if (input) input.value = "";
  }
}

async function saveConfigModalData() {
  const sourceMode = document.getElementById("cfgSourceMode").value;
  const mediaRoots = document
    .getElementById("cfgMediaRoots")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const autoindexRootUrls = document
    .getElementById("cfgAutoRoots")
    .value.split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  try {
    const res = await fetch(CONFIG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceMode, mediaRoots, autoindexRootUrls }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    closeConfigModal();
    toast("Configuración guardada. Reinicia el servidor para aplicar.", 5200);
  } catch (err) {
    toast(`No se pudo guardar: ${err.message}`);
  }
}

async function cleanupCacheTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return;
  const label = targets.join(", ");
  if (!window.confirm(`¿Limpiar caché temporal de: ${label}?`)) return;
  try {
    const res = await fetch(CACHE_CLEANUP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    toast(`Limpieza completada: ${(payload.cleaned || []).join(", ")}`, 3800);
    resetThumbPrewarmState();
    enqueueThumbPrewarm(allFiles);
    loadCacheStats();
  } catch (err) {
    toast(`No se pudo limpiar caché: ${err.message}`, 5200);
  }
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let idx = 0;
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024;
    idx += 1;
  }
  return `${v.toFixed(v >= 100 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

async function loadCacheStats() {
  const thumbEl = document.getElementById("cacheThumbSize");
  const liveEl = document.getElementById("cacheLiveSize");
  const totalEl = document.getElementById("cacheTotalSize");
  if (!thumbEl || !liveEl || !totalEl) return;
  thumbEl.textContent = "...";
  liveEl.textContent = "...";
  totalEl.textContent = "...";
  try {
    const res = await fetch(CACHE_STATS_URL, { cache: "no-store" });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
    const stats = payload?.stats || {};
    thumbEl.textContent = formatBytes(stats?.["thumb-cache"]?.bytes || 0);
    liveEl.textContent = formatBytes(stats?.["temp-livephotos"]?.bytes || 0);
    totalEl.textContent = formatBytes(stats?.totalBytes || 0);
  } catch (err) {
    thumbEl.textContent = "-";
    liveEl.textContent = "-";
    totalEl.textContent = "-";
    toast(`No se pudo leer tamaños de caché: ${err.message}`, 4200);
  }
}

function setViewerVideoFallback(file, visible) {
  const fb = document.getElementById("viewerVideoFallback");
  const openA = document.getElementById("viewerOpenTab");
  const dlA = document.getElementById("viewerFallbackDl");
  if (!fb || !openA || !dlA) return;
  if (visible && file) {
    openA.href = file.url;
    dlA.href = file.url;
    dlA.download = file.name || "video";
    fb.style.display = "flex";
  } else {
    fb.style.display = "none";
  }
}

function showViewerStaticFromVideo(file, reason = "") {
  if (!file?.thumbUrl) return false;
  const viewer = document.getElementById("viewer");
  const img = document.getElementById("viewerMedia");
  const vid = document.getElementById("viewerVideo");
  const aud = document.getElementById("viewerAudio");
  viewer.classList.remove("video-mode");
  setViewerVideoFallback(null, false);
  try {
    vid.pause();
  } catch (_) {}
  window.MediaLoader.releaseVideo(vid);
  vid.style.display = "none";
  aud.style.display = "none";
  img.style.display = "block";
  img.src = file.thumbUrl;
  img.style.transform = `translate(${vOffX}px,${vOffY}px) scale(${vZoom})`;
  document.getElementById("viewerZoomLbl").textContent =
    Math.round(vZoom * 100) + "%";
  if (reason) dbg("viewer video->static fallback", { url: file.url, reason });
  return true;
}

function nowMs() {
  return window.performance && performance.now ? performance.now() : Date.now();
}

function needsWebVideoTranscode(file) {
  if (!file || file.type !== "video") return false;
  if (file.livePhoto?.enabled) return true;
  return /\.mov($|\?)/i.test(String(file.url || ""));
}

function setLiveHint(msg = "") {
  const el = document.getElementById("viewerLiveHint");
  if (!el) return;
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.style.display = "inline";
}

function stopLiveStatusPolling() {
  if (!liveStatusTimer) return;
  clearInterval(liveStatusTimer);
  liveStatusTimer = null;
}

function fallbackToDirectVideoPlayback(file, videoEl) {
  if (!videoEl || !file?.url) return;
  stopLiveStatusPolling();
  setLiveHint("");
  videoEl.dataset.liveWebReady = "1";
  videoEl.dataset.livePreparing = "0";
  livePrepareInFlightKey = "";
  videoEl.preload = "auto";
  if (videoEl.src !== file.url) {
    videoEl.src = file.url;
    videoEl.load();
  }
  const p = videoEl.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

async function startLivePrepareAndPoll(
  file,
  videoEl,
  autoPlayWhenReady = false,
) {
  if (!needsWebVideoTranscode(file)) return false;
  const inFlightNow = videoEl.dataset.livePreparing === "1";
  const cooldownMs = 2000;
  if (inFlightNow) return false;
  if (nowMs() - livePrepareLastStartAt < cooldownMs) return false;
  const versionKey = String(file.url);
  const requestKey = `${file.url}|${versionKey}`;
  if (livePrepareInFlightKey && livePrepareInFlightKey === requestKey) return false;
  const prepUrl = `${LIVE_PREPARE_URL}?src=${encodeURIComponent(file.url)}&v=${encodeURIComponent(versionKey)}`;
  const statusUrl = `${LIVE_STATUS_URL}?src=${encodeURIComponent(file.url)}&v=${encodeURIComponent(versionKey)}`;
  livePrepareInFlightKey = requestKey;
  livePrepareLastStartAt = nowMs();
  videoEl.dataset.livePreparing = "1";
  setLiveHint("Generando versión optimizada…");
  try {
    const prepRes = await fetch(prepUrl, { method: "POST" });
    const prepPayload = await prepRes.json().catch(() => ({}));
    if (prepRes.ok && prepPayload?.live === false) {
      fallbackToDirectVideoPlayback(file, videoEl);
      return false;
    }
    if (prepRes.ok && prepPayload?.ready && prepPayload?.url) {
      videoEl.dataset.liveWebReady = "1";
      setLiveHint("");
      if (videoEl.src !== prepPayload.url) {
        videoEl.src = prepPayload.url;
        videoEl.load();
      }
      if (autoPlayWhenReady) {
        const p = videoEl.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      videoEl.dataset.livePreparing = "0";
      livePrepareInFlightKey = "";
      return true;
    }

    stopLiveStatusPolling();
    liveStatusTimer = setInterval(async () => {
      try {
        const statusRes = await fetch(statusUrl, { cache: "no-store" });
        const statusPayload = await statusRes.json();
        if (!statusRes.ok) return;
        if (filteredFiles[currentViewerIdx]?.url !== file.url) {
          stopLiveStatusPolling();
          setLiveHint("");
          return;
        }
        if (statusPayload?.ready && statusPayload?.url) {
          stopLiveStatusPolling();
          videoEl.dataset.liveWebReady = "1";
          videoEl.dataset.livePreparing = "0";
          livePrepareInFlightKey = "";
          setLiveHint("");
          if (videoEl.src !== statusPayload.url) {
            videoEl.src = statusPayload.url;
            videoEl.load();
          }
          if (autoPlayWhenReady) {
            const p = videoEl.play();
            if (p && typeof p.catch === "function") p.catch(() => {});
          }
        }
        if (statusPayload?.live === false) {
          fallbackToDirectVideoPlayback(file, videoEl);
        }
      } catch (_) {}
    }, 900);
    return true;
  } catch (_) {
    fallbackToDirectVideoPlayback(file, videoEl);
    return true;
  }
}

function bindViewerVideoEvents(videoEl) {
  if (viewerVideoErrBound) return;
  viewerVideoErrBound = true;

  videoEl.addEventListener("loadedmetadata", () => {
    const curr = filteredFiles[currentViewerIdx];
    if (!curr || curr.type !== "video") return;
    dbg("viewer video loadedmetadata", {
      url: curr.url,
      videoWidth: videoEl.videoWidth || 0,
      videoHeight: videoEl.videoHeight || 0,
      t_open_to_metadata_ms: viewerVideoPerf
        ? Math.round(nowMs() - viewerVideoPerf.openAt)
        : null,
    });
  });

  videoEl.addEventListener("canplay", () => {
    const curr = filteredFiles[currentViewerIdx];
    if (!curr || curr.type !== "video") return;
    dbg("viewer video canplay", {
      url: curr.url,
      t_open_to_canplay_ms: viewerVideoPerf
        ? Math.round(nowMs() - viewerVideoPerf.openAt)
        : null,
    });
    const img = document.getElementById("viewerMedia");
    if (img) img.style.display = "none";
    setViewerVideoFallback(null, false);
    if (!curr.livePhoto?.enabled) {
      const p = videoEl.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  });

  videoEl.addEventListener("canplaythrough", () => {
    const curr = filteredFiles[currentViewerIdx];
    if (!curr || curr.type !== "video") return;
    dbg("viewer video canplaythrough", { url: curr.url });
  });

  videoEl.addEventListener("playing", () => {
    const curr = filteredFiles[currentViewerIdx];
    if (!curr || curr.type !== "video") return;
    dbg("viewer video playing", {
      url: curr.url,
      t_open_to_playing_ms: viewerVideoPerf
        ? Math.round(nowMs() - viewerVideoPerf.openAt)
        : null,
    });
    if (viewerVideoPerf) viewerVideoPerf.lastPlayingAt = nowMs();
  });

  const softRecover = (kind) => {
    const curr = filteredFiles[currentViewerIdx];
    if (!curr || curr.type !== "video") return;
    // For live photos, avoid play/wait loops before the web-ready video is prepared.
    if (needsWebVideoTranscode(curr) && videoEl.dataset.liveWebReady !== "1") return;
    dbg(`viewer video ${kind}`, { url: curr.url });
    if (viewerVideoPerf && nowMs() - viewerVideoPerf.openAt < 15000) {
      const p = videoEl.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  };
  videoEl.addEventListener("waiting", () => softRecover("waiting"));
  videoEl.addEventListener("stalled", () => softRecover("stalled"));

  videoEl.addEventListener("error", () => {
    const curr = filteredFiles[currentViewerIdx];
    if (!curr || curr.type !== "video") return;
    if (showViewerStaticFromVideo(curr, "decode-error")) {
      toast(
        "Mostrando vista estática (Video no compatible). Descarga el video para verlo.",
        6200,
      );
      return;
    }
    dbg("viewer video error", {
      code: videoEl.error?.code || null,
      message: videoEl.error?.message || null,
      url: curr.url,
    });
    setViewerVideoFallback(curr, true);
    toast("Video no compatible en este navegador");
  });

  if (!viewerLivePlayBound) {
    viewerLivePlayBound = true;
    videoEl.addEventListener("play", () => {
      const curr = filteredFiles[currentViewerIdx];
      if (!curr || curr.type !== "video") return;
      if (!needsWebVideoTranscode(curr)) return;
      if (videoEl.dataset.liveWebReady === "1") return;
      videoEl.pause();
      startLivePrepareAndPoll(curr, videoEl, true).catch(() => {});
    });
  }
}

function normalizeDate(dateStr, fallbackName, fallbackUrl) {
  const src = (dateStr || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(src)) {
    const [, mmRaw, ddRaw] = src.split("-");
    const mm = Number(mmRaw);
    const dd = Number(ddRaw);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)
      return { value: src, fallback: false };
  }
  if (/^\d{4}-XX-XX$/.test(src)) return { value: src, fallback: false };
  const fallback = guessDate(fallbackName || "", fallbackUrl || "");
  return { value: fallback, fallback: true };
}

function normalizeIndexedFile(f) {
  dataMetrics.rawCount += 1;
  const rawUrl = typeof f?.url === "string" ? f.url.trim() : "";
  const name =
    typeof f?.name === "string" && f.name.trim()
      ? f.name.trim()
      : decodeURIComponent((rawUrl || "").split("/").pop() || "");
  const type =
    (typeof f?.type === "string" ? f.type.trim() : "") ||
    (IMG.test(rawUrl || "")
      ? "image"
      : VID.test(rawUrl || "")
        ? "video"
        : AUD.test(rawUrl || "")
          ? "audio"
          : null);
  if (!type || !rawUrl || !name) {
    dataMetrics.discardedCount += 1;
    return null;
  }
  const normalizedDate = normalizeDate(
    typeof f?.date === "string" ? f.date : "",
    name,
    rawUrl,
  );
  if (normalizedDate.fallback) dataMetrics.fallbackDateCount += 1;
  dataMetrics.validCount += 1;
  return {
    id: typeof f?.id === "string" && f.id.trim() ? f.id.trim() : rawUrl,
    url: rawUrl,
    name,
    type,
    date: normalizedDate.value,
    width: Number.isFinite(f?.width) ? Number(f.width) : null,
    height: Number.isFinite(f?.height) ? Number(f.height) : null,
    size: Number.isFinite(f.size) ? f.size : 0,
    mtimeMs: Number.isFinite(f?.mtimeMs) ? Number(f.mtimeMs) : 0,
    thumbUrl:
      typeof f?.thumbUrl === "string" && f.thumbUrl.trim()
        ? f.thumbUrl.trim()
        : "",
    thumb128Url:
      typeof f?.thumb128Url === "string" && f.thumb128Url.trim()
        ? f.thumb128Url.trim()
        : typeof f?.thumbUrl === "string" && f.thumbUrl.trim()
          ? f.thumbUrl.trim()
          : "",
    thumb512Url:
      typeof f?.thumb512Url === "string" && f.thumb512Url.trim()
        ? f.thumb512Url.trim()
        : typeof f?.thumbUrl === "string" && f.thumbUrl.trim()
          ? f.thumbUrl.trim()
          : "",
    livePhoto:
      f?.livePhoto && typeof f.livePhoto === "object" && f.livePhoto.enabled
        ? {
            enabled: true,
            snapshotUrl:
              typeof f.livePhoto.snapshotUrl === "string"
                ? f.livePhoto.snapshotUrl
                : "",
            webVideoUrl:
              typeof f.livePhoto.webVideoUrl === "string"
                ? f.livePhoto.webVideoUrl
                : "",
          }
        : null,
    entryId:
      typeof f?.entryId === "string" && f.entryId.trim()
        ? f.entryId.trim()
        : "entry:0",
    entryLabel:
      typeof f?.entryLabel === "string" && f.entryLabel.trim()
        ? f.entryLabel.trim()
        : "Entrada",
  };
}

function updateEntryFilterUI() {
  const wrap = document.getElementById("entryFilterWrap");
  const sel = document.getElementById("entryFilter");
  if (!wrap || !sel) return;

  const entryMap = new Map();
  for (const f of allFiles) {
    if (!f?.entryId) continue;
    if (!entryMap.has(f.entryId))
      entryMap.set(f.entryId, f.entryLabel || f.entryId);
  }
  const entries = [...entryMap.entries()];

  sel.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "Todas";
  sel.appendChild(optAll);
  entries.forEach(([id, label]) => {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = label;
    sel.appendChild(o);
  });

  if (entries.length <= 1) {
    currentEntry = "all";
    sel.value = "all";
    sel.disabled = true;
    wrap.style.display = "none";
    return;
  }

  wrap.style.display = "flex";
  sel.disabled = false;
  if (currentEntry !== "all" && !entryMap.has(currentEntry))
    currentEntry = "all";
  sel.value = currentEntry;
}

async function loadIndex() {
  const res = await fetch(INDEX_URL, { cache: "no-store" });
  if (res.status === 202) {
    const payload = await res.json();
    const err = new Error("INDEXING");
    err.code = "INDEXING";
    err.payload = payload;
    throw err;
  }
  if (!res.ok) throw new Error(`Index HTTP ${res.status}`);
  const payload = await res.json();
  if (!payload || !Array.isArray(payload.files))
    throw new Error("Índice inválido");
  dataMetrics.rawCount = 0;
  dataMetrics.validCount = 0;
  dataMetrics.discardedCount = 0;
  dataMetrics.fallbackDateCount = 0;
  const files = payload.files.map(normalizeIndexedFile).filter(Boolean);
  dbg("loadIndex metrics", { ...dataMetrics, apiCount: payload.files.length });
  return {
    version: payload.version || payload.generatedAt || `${files.length}`,
    files,
  };
}

function indexBackoffMs() {
  const base = Math.min(10000, 1200 * (indexRetryCount + 1));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

function applyNewFileSet(nextFiles, source) {
  const prevCount = allFiles.length;
  allFiles = nextFiles;
  enqueueThumbPrewarm(allFiles);
  updateEntryFilterUI();
  renderedGroups = 0;
  groupKeys = [];
  groupMap = {};
  applyFilters();
  if (source === "poll" && prevCount !== nextFiles.length) {
    toast("Lista actualizada");
  }
}

function startIndexPolling() {
  if (indexPollTimer) clearInterval(indexPollTimer);
  indexPollTimer = setInterval(async () => {
    try {
      const idx = await loadIndex();
      if (idx.version === currentIndexVersion) return;
      currentIndexVersion = idx.version;
      applyNewFileSet(idx.files, "poll");
    } catch (_) {
      // keep current list when index is temporarily unavailable
    }
  }, INDEX_POLL_MS);
}

// ── FILTER + SORT + GROUP ────────────────────────────────────
// ── STATS ────────────────────────────────────────────────────
function updateStats() {
  const c = { image: 0, video: 0, live: 0, audio: 0 };
  const recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let recent = 0;
  allFiles.forEach((f) => {
    if (Number.isFinite(f?.mtimeMs) && Number(f.mtimeMs) >= recentCutoff)
      recent += 1;
    if (f.type === "video" && f.livePhoto?.enabled) c.live += 1;
    else if (f.type === "video") c.video += 1;
    else c[f.type] = (c[f.type] || 0) + 1;
  });
  document.getElementById("cnt-all").textContent = allFiles.length;
  document.getElementById("cnt-recent").textContent = recent;
  document.getElementById("cnt-image").textContent = c.image;
  document.getElementById("cnt-video").textContent = c.video;
  document.getElementById("cnt-live").textContent = c.live;
  document.getElementById("cnt-audio").textContent = c.audio;
  document.getElementById("sideStats").innerHTML =
    `<span style="font-family:var(--mono)">${filteredFiles.length}</span> archivo${filteredFiles.length !== 1 ? "s" : ""} visibles`;

  const sr = document.getElementById("statsRow");
  const fc = { image: 0, video: 0, live: 0, audio: 0 };
  filteredFiles.forEach((f) => {
    if (f.type === "video" && f.livePhoto?.enabled) fc.live += 1;
    else if (f.type === "video") fc.video += 1;
    else fc[f.type] = (fc[f.type] || 0) + 1;
  });
  sr.innerHTML = "";
  const isMobileStats = window.innerWidth <= 768;
  if (isMobileStats) {
    const compact = [
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
        val: String(fc.image),
      },
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
        val: String(fc.video),
      },
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        val: String(fc.live),
      },
      {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        val: String(fc.audio),
      },
    ];
    compact.forEach((ch) => {
      const d = document.createElement("div");
      d.className = "stat-chip stat-chip--compact";
      d.innerHTML = ch.icon + `<span>${ch.val}</span>`;
      sr.appendChild(d);
    });
    return;
  }
  const chips = [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
      val: fc.image + " fotos",
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
      val: fc.video + " videos",
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      val: fc.live + " live photos",
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
      val: fc.audio + " audios",
    },
  ];
  chips.forEach((ch) => {
    const d = document.createElement("div");
    d.className = "stat-chip";
    d.innerHTML = ch.icon + `<span>${ch.val}</span>`;
    sr.appendChild(d);
  });
}

// ── RENDER CHUNKS ────────────────────────────────────────────
const CHUNK = 3;
function renderChunk() {
  const app = document.getElementById("app");
  if (renderedGroups === 0) app.innerHTML = "";
  if (!groupKeys.length) {
    app.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg><p>Sin resultados</p></div>`;
    return;
  }
  const end = Math.min(renderedGroups + CHUNK, groupKeys.length);
  for (let i = renderedGroups; i < end; i++)
    app.appendChild(buildGroup(groupKeys[i], groupMap[groupKeys[i]]));
  renderedGroups = end;
}

function buildGroup(label, files) {
  const sec = document.createElement("section");
  sec.style.marginBottom = "28px";
  const h = document.createElement("div");
  h.className = "section-head";
  const displayLabel =
    currentGroup === "date" ? formatDateGroupLabel(label) : label;
  h.innerHTML = `<span>${displayLabel}</span><span style="font-size:11px;font-family:var(--mono);color:var(--muted);margin-left:6px;">${files.length}</span>`;
  sec.appendChild(h);
  sec.appendChild(layoutMode === "list" ? buildList(files) : buildGrid(files));
  return sec;
}

// ── GRID ─────────────────────────────────────────────────────
function buildGrid(files) {
  const px = SIZE_PX[sizeIdx];
  const g = document.createElement("div");
  g.style.cssText = `display:grid;grid-template-columns:repeat(auto-fill,minmax(${px}px,1fr));gap:6px;`;
  files.forEach((f) => {
    const card = document.createElement("div");
    card.className = "media-card";
    card.style.aspectRatio = "1";
    card.setAttribute("draggable", "true");

    const thumb = document.createElement("div");
    thumb.style.cssText = "width:100%;height:100%;";
    thumb.dataset.src = f.url;
    thumb.dataset.type = f.type;
    if (f.type === "video" && f.thumbUrl) thumb.dataset.thumb = f.thumbUrl;
    thumb.innerHTML = placeholder(f.type);
    card.appendChild(thumb);

    const ov = document.createElement("div");
    ov.className = "card-overlay";
    ov.innerHTML = `<span class="card-name">${f.name}</span>`;
    card.appendChild(ov);

    if (f.type !== "image") {
      const badge = document.createElement("div");
      badge.className = "type-badge";
      badge.innerHTML =
        f.type === "video"
          ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>Video`
          : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/></svg>Audio`;
      card.appendChild(badge);
    }

    const gi = filteredFiles.findIndex((x) => x.url === f.url);
    card.onclick = () => openViewer(gi);
    card.addEventListener("dragstart", () => {
      dragSrc = f.url;
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () =>
      card.classList.remove("drag-over"),
    );
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      reorder(dragSrc, f.url);
    });
    if (f.type === "video") {
      card.addEventListener("mouseenter", () => {
        requestVideoThumbPreview(thumb, f.url, 0);
      });
      card.addEventListener("click", () => {
        requestVideoThumbPreview(thumb, f.url, 0);
      });
    }
    g.appendChild(card);
    lazyObs.observe(thumb);
    if (f.type === "video") videoReleaseObs.observe(thumb);
  });
  return g;
}

function placeholder(type) {
  const icons = {
    image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="width:32px;height:32px;color:var(--panel)"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`,
    video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="width:32px;height:32px;color:var(--panel)"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
    audio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="width:32px;height:32px;color:var(--panel)"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  };
  return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--card);">${icons[type] || ""}</div>`;
}

// ── LIST ─────────────────────────────────────────────────────
function buildList(files) {
  const ul = document.createElement("div");
  ul.style.cssText = "display:flex;flex-direction:column;gap:4px;";
  files.forEach((f) => {
    const gi = filteredFiles.findIndex((x) => x.url === f.url);
    const row = document.createElement("div");
    row.className = "list-row";
    const typeIco = {
      image: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="width:18px;height:18px"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`,
      video: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="width:18px;height:18px"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
      audio: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="width:18px;height:18px"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    }[f.type];

    const thumb = document.createElement("div");
    thumb.className = "list-thumb";
    thumb.dataset.src = f.url;
    thumb.dataset.type = f.type;
    if (f.type === "video" && f.thumbUrl) thumb.dataset.thumb = f.thumbUrl;
    thumb.innerHTML = typeIco;

    const rowBody = document.createElement("div");
    rowBody.style.cssText = "flex:1;min-width:0;";
    rowBody.innerHTML = `<div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${prettyDate(f.date)}</div>`;
    const rowDl = document.createElement("a");
    rowDl.href = f.url;
    rowDl.download = f.name;
    rowDl.setAttribute("onclick", "event.stopPropagation()");
    rowDl.style.cssText =
      "background:var(--panel);border:1px solid var(--border);color:var(--muted-l);padding:5px 9px;border-radius:7px;text-decoration:none;font-size:12px;transition:background 0.15s;display:flex;align-items:center;gap:4px;";
    rowDl.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    row.appendChild(thumb);
    row.appendChild(rowBody);
    row.appendChild(rowDl);
    if (f.type === "video") {
      row.addEventListener("mouseenter", () => {
        requestVideoThumbPreview(thumb, f.url, 0);
      });
      row.addEventListener("click", () => {
        requestVideoThumbPreview(thumb, f.url, 0);
      });
    }
    row.onclick = () => openViewer(gi);
    ul.appendChild(row);
    lazyObs.observe(thumb);
    if (f.type === "video") videoReleaseObs.observe(thumb);
  });
  return ul;
}

// ── LAZY LOAD ─────────────────────────────────────────────────
const lazyObs = new IntersectionObserver(
  (entries) => {
    if (thumbLoadingSuspended) return;
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target;
      if (!document.body.contains(el)) return;
      if (el.dataset.loaded === "1" || el.dataset.loading === "1") return;
      el.dataset.loading = "1";
      lazyObs.unobserve(el);
      const { src, type } = el.dataset;
      if (currentType !== "all" && type !== currentType) {
        el.dataset.loading = "0";
        return;
      }
      if (!src) {
        el.dataset.loading = "0";
        return;
      }
      if (type === "image") {
        window.MediaLoader.loadImageWithRetry(src, {
          retries: 2,
          retryDelayMs: 200,
        })
          .then((img) => {
            img.className = el.classList.contains("list-thumb")
              ? ""
              : "w-full h-full object-cover";
            img.style.cssText =
              "width:100%;height:100%;object-fit:cover;border-radius:inherit;";
            el.innerHTML = "";
            el.appendChild(img);
            el.dataset.loaded = "1";
          })
          .catch(() => {
            el.dataset.loaded = "0";
            el.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--card);color:var(--muted);font-size:10px;">No se pudo cargar</div>`;
            setTimeout(() => lazyObs.observe(el), 1200);
          })
          .finally(() => {
            el.dataset.loading = "0";
          });
      } else if (type === "video") {
        requestVideoThumbPreview(el, src, VIDEO_THUMB_DEFER_MS, true);
      }
    });
  },
  { rootMargin: "400px" },
);

const videoReleaseObs = new IntersectionObserver(
  (entries) => {
    if (thumbLoadingSuspended) return;
    entries.forEach((e) => {
      const el = e.target;
      if (!el || el.dataset.type !== "video") return;
      if (e.isIntersecting) return;
      cleanupVideoThumb(el);
      videoReleaseObs.unobserve(el);
      setTimeout(() => {
        if (document.body.contains(el)) {
          lazyObs.observe(el);
          videoReleaseObs.observe(el);
        }
      }, 200);
    });
  },
  { rootMargin: "1200px" },
);

// Infinite scroll
function resetInfiniteObserver() {
  const sentinel = document.getElementById("sentinel");
  if (!sentinel) return;
  if (sentinelObs) sentinelObs.disconnect();
  sentinelObs = new IntersectionObserver(
    (e) => {
      if (e[0].isIntersecting && renderedGroups < groupKeys.length)
        renderChunk();
    },
    { rootMargin: "500px" },
  );
  sentinelObs.observe(sentinel);
}
resetInfiniteObserver();

function resubscribeThumbObservers() {
  const thumbs = document.querySelectorAll("[data-src][data-type]");
  thumbs.forEach((el) => {
    lazyObs.observe(el);
    if (el.dataset.type === "video") videoReleaseObs.observe(el);
  });
}

function suspendThumbLoading(on) {
  thumbLoadingSuspended = on;
  if (on) {
    lazyObs.disconnect();
    videoReleaseObs.disconnect();
    videoLoader.cancelByPrefix("video:thumb:");
    document.querySelectorAll("[data-src][data-type]").forEach((el) => {
      const st = getThumbNodeState(el);
      if (st.abortController) st.abortController.abort();
      st.inFlightPromise = null;
      if (st.status === "loading") st.status = "stale";
      el.dataset.loading = "0";
    });
    return;
  }
  resubscribeThumbObservers();
}

function beginViewerPriorityLoad() {
  viewerPriorityToken += 1;
  viewerPriorityActive = true;
  suspendThumbLoading(true);
  preloadManager.reset();
  return viewerPriorityToken;
}

function endViewerPriorityLoad(token, preloadNeighbors = true) {
  if (!token || token !== viewerPriorityToken) return;
  if (!viewerPriorityActive) return;
  viewerPriorityActive = false;
  // Keep grid/background thumbnail loading paused while viewer is open.
  // It will be resumed on closeViewer().
  if (
    preloadNeighbors &&
    document.getElementById("viewer").style.display !== "none"
  ) {
    preloadViewerNeighbors(currentViewerIdx);
  }
}

// ── REORDER ───────────────────────────────────────────────────
function reorder(srcUrl, dstUrl) {
  const si = allFiles.findIndex((f) => f.url === srcUrl);
  const di = allFiles.findIndex((f) => f.url === dstUrl);
  if (si < 0 || di < 0 || si === di) return;
  const [m] = allFiles.splice(si, 1);
  allFiles.splice(di, 0, m);
  applyFilters();
  toast("Orden actualizado");
}

// ── ZOOM BAR ─────────────────────────────────────────────────
const zLabels = SIZE_PX.map((_, i) => SIZES[i]);
function stepZoom(d) {
  sizeIdx = Math.max(0, Math.min(4, sizeIdx + d));
  lastDesktopSizeIdx = sizeIdx;
  document.getElementById("zoomSlider").value = sizeIdx;
  document.getElementById("zoomPct").textContent = SIZES[sizeIdx];
  applyFilters();
}
function setZoomBySlider(v) {
  sizeIdx = +v;
  lastDesktopSizeIdx = sizeIdx;
  document.getElementById("zoomPct").textContent = SIZES[sizeIdx];
  applyFilters();
}

// ── LAYOUT ────────────────────────────────────────────────────
function toggleLayout() {
  layoutMode = layoutMode === "grid" ? "list" : "grid";
  const ic = document.getElementById("viewIcon");
  ic.innerHTML =
    layoutMode === "grid"
      ? `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`
      : `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`;
  document.getElementById("zoomBar").style.display =
    layoutMode === "list" ? "none" : "flex";
  applyFilters();
}

// ── SORT ─────────────────────────────────────────────────────
const sortLabels = {
  "date-desc": "Más reciente",
  "date-asc": "Más antiguo",
  "name-asc": "A → Z",
  "name-desc": "Z → A",
  "heavy-desc": "Más pesados",
  "heavy-asc": "Más ligeros",
  invert: "Invertido",
};
function toggleSortMenu() {
  document.getElementById("sortMenu").classList.toggle("open");
}
function setSort(el) {
  const val = el.dataset.sort;
  lastSort = currentSort !== "invert" ? currentSort : lastSort;
  currentSort = val;
  document
    .querySelectorAll(".sort-item")
    .forEach((i) => i.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("sortLabel").textContent = sortLabels[val] || val;
  document.getElementById("sortMenu").classList.remove("open");
  applyFilters();
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#sortBtn") && !e.target.closest("#sortMenu"))
    document.getElementById("sortMenu").classList.remove("open");
});

// ── SIDEBAR NAV ───────────────────────────────────────────────
function setTypeFilter(type, el) {
  currentType = type;
  document.querySelectorAll(".nav-item").forEach((n) => {
    if (
      ["all", "recent", "image", "video", "live", "audio"].some((t) =>
        n.onclick?.toString().includes(`'${t}'`),
      )
    )
      n.classList.remove("active");
  });
  el.classList.add("active");
  applyFilters();
  if (window.innerWidth <= 768) closeSidebar();
}
function setGroup(g, el) {
  currentGroup = g;
  ["grp-date", "grp-type", "grp-none"].forEach((id) =>
    document.getElementById(id)?.classList.remove("active"),
  );
  el.classList.add("active");
  applyFilters();
  if (window.innerWidth <= 768) closeSidebar();
}
document.getElementById("grp-date").classList.add("active");

// ── VIEWER ────────────────────────────────────────────────────
function openViewer(idx) {
  viewerIsOpen = true;
  currentViewerIdx = idx;
  vZoom = 1;
  vOffX = 0;
  vOffY = 0;
  beginViewerPriorityLoad();
  renderViewer();
  document.getElementById("viewer").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function preloadViewerNeighbors(centerIdx) {
  if (!Number.isInteger(centerIdx)) return;
  if (!viewerIsOpen) return;
  preloadManager.reset();
  const targets = [];
  for (let d = 1; d <= PRELOAD_WINDOW; d += 1) {
    targets.push(centerIdx + d, centerIdx - d);
  }
  let prio = 0;
  for (const idx of targets) {
    const f = filteredFiles[idx];
    if (!f) continue;
    if (f.type === "image") {
      const t512 = f.thumb512Url || f.thumbUrl || "";
      if (t512) {
        preloadManager.enqueue({
          key: `t512:${f.id || f.url}`,
          priority: prio,
          run: async () => {
            await getThumbObjectUrl(f, t512, "512", undefined, true);
          },
        });
      }
      preloadManager.enqueue({
        key: `origwarm:${f.id || f.url}`,
        priority: prio + 1,
        run: async () => {
          try {
            await fetch(f.url, {
              headers: { Range: "bytes=0-65535" },
              cache: "no-store",
            });
          } catch (_) {}
        },
      });
    }
    prio += 1;
  }
}

function renderViewer() {
  const f = filteredFiles[currentViewerIdx];
  if (!f) return;
  const viewer = document.getElementById("viewer");
  document.getElementById("viewerName").textContent = f.name;
  document.getElementById("viewerDl").href = f.url;
  document.getElementById("viewerDl").download = f.name;
  document.getElementById("viewerIdx").textContent =
    `${currentViewerIdx + 1} / ${filteredFiles.length}`;
  document.getElementById("viewerDate").textContent = prettyDate(f.date);
  document.getElementById("viewerZoomLbl").textContent = "100%";
  updateViewerFavoriteBtn(f);

  const img = document.getElementById("viewerMedia");
  const vid = document.getElementById("viewerVideo");
  const aud = document.getElementById("viewerAudio");
  img.style.display = "none";
  vid.style.display = "none";
  aud.style.display = "none";
  img.style.visibility = "hidden";
  stopLiveStatusPolling();
  setLiveHint("");
  setViewerVideoFallback(null, false);
  vid.pause();
  window.MediaLoader.releaseVideo(vid);
  bindViewerVideoEvents(vid);

  if (f.type === "image") {
    const loadToken = beginViewerPriorityLoad();
    viewer.classList.remove("video-mode");
    img.style.display = "block";
    img.style.width = "92vw";
    img.style.height = "82vh";
    img.style.maxWidth = "92vw";
    img.style.maxHeight = "82vh";
    img.style.objectFit = "contain";
    img.removeAttribute("src");
    img.dataset.viewerQuality = "pending";
    img.dataset.viewerTarget = f.url;
    const isHeic =
      f.url.toLowerCase().endsWith(".heic") ||
      f.url.toLowerCase().endsWith(".heif");
    if (isHeic) {
      toast(
        "Este navegador no es 100% compatible con HEIC/HEIF. Descarga la imagen para ver la original.",
        4200,
      );
    }
    const targetUrl = isHeic
      ? `/thumb/web-image?src=${encodeURIComponent(f.url)}`
      : f.url;

    const t512 = f.thumb512Url || f.thumbUrl || "";
    const preferOriginalFirst = useStaticViewportOnIosMobile();
    const promoteOriginal = (attempt = 0) => {
      const src =
        attempt === 0
          ? targetUrl
          : `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}_vr=${Date.now()}_${attempt}`;
      const retries = attempt === 0 ? 2 : 1;
      return window.MediaLoader.loadImageWithRetry(src, {
        retries,
        retryDelayMs: 220,
      })
        .then((loaded) => {
          if (filteredFiles[currentViewerIdx]?.url !== f.url) return false;
          img.style.opacity = "1";
          img.src = loaded.src;
          img.style.visibility = "visible";
          img.style.transform = `translate(${vOffX}px,${vOffY}px) scale(${vZoom})`;
          img.dataset.viewerQuality = "original";
          document.getElementById("viewerZoomLbl").textContent =
            Math.round(vZoom * 100) + "%";
          endViewerPriorityLoad(loadToken, true);
          return true;
        })
        .catch(() => {
          if (filteredFiles[currentViewerIdx]?.url !== f.url) return false;
          if (attempt >= 2) {
            endViewerPriorityLoad(loadToken, true);
            if (img.dataset.viewerQuality !== "low")
              toast("No se pudo cargar la imagen");
            return false;
          }
          return promoteOriginal(attempt + 1);
        });
    };
    if (preferOriginalFirst) {
      // iPhone: show a good preview quickly, then upgrade to original.
      if (t512) {
        window.MediaLoader.loadImageWithRetry(t512, {
          retries: 1,
          retryDelayMs: 120,
        })
          .then((loaded) => {
            if (filteredFiles[currentViewerIdx]?.url !== f.url) return;
            img.style.opacity = "0.92";
            img.src = loaded.src;
            img.style.visibility = "visible";
            img.style.transform = `translate(${vOffX}px,${vOffY}px) scale(${vZoom})`;
            img.dataset.viewerQuality = "low";
            document.getElementById("viewerZoomLbl").textContent =
              Math.round(vZoom * 100) + "%";
          })
          .catch(() => {});
      }
      promoteOriginal();
    } else {
      window.MediaLoader.loadImageWithRetry(t512 || targetUrl, {
        retries: 1,
        retryDelayMs: 120,
      })
        .then((loaded) => {
          if (filteredFiles[currentViewerIdx]?.url !== f.url) return;
          img.style.opacity = "0.85";
          img.src = loaded.src;
          img.style.visibility = "visible";
          img.style.transform = `translate(${vOffX}px,${vOffY}px) scale(${vZoom})`;
          img.dataset.viewerQuality = "low";
          document.getElementById("viewerZoomLbl").textContent =
            Math.round(vZoom * 100) + "%";
        })
        .catch(() => {});
      promoteOriginal();
    }
  } else if (f.type === "video") {
    img.style.visibility = "visible";
    endViewerPriorityLoad(viewerPriorityToken, true);
    viewer.classList.add("video-mode");
    viewerVideoPerf = { openAt: nowMs(), lastPlayingAt: 0 };
    videoLoader.cancelByPrefix("video:thumb:");
    const isLive = Boolean(f.livePhoto?.enabled);
    const needsWeb = needsWebVideoTranscode(f);
    if (isLive && f.livePhoto?.snapshotUrl) {
      img.style.display = "block";
      img.src = f.livePhoto.snapshotUrl;
      img.onerror = () => {
        img.onerror = null;
        img.style.display = "none";
        fallbackToDirectVideoPlayback(f, vid);
      };
      img.style.transform = `translate(${vOffX}px,${vOffY}px) scale(${vZoom})`;
    } else {
      img.style.display = "none";
    }
    vid.style.display = "block";
    vid.loop = true;
    vid.playsInline = true;
    vid.preload = needsWeb ? "none" : "auto";
    vid.dataset.liveWebReady = needsWeb ? "0" : "1";
    vid.src = f.url;
    if (needsWeb) {
      setLiveHint("Preparando versión optimizada…");
      startLivePrepareAndPoll(f, vid, false).catch(() => {});
    }
  } else {
    img.style.visibility = "hidden";
    endViewerPriorityLoad(viewerPriorityToken, true);
    viewer.classList.remove("video-mode");
    aud.style.display = "flex";
    document.getElementById("viewerAudioName").textContent = f.name;
    document.getElementById("viewerAudioEl").src = f.url;
  }
}

function closeViewer() {
  const viewer = document.getElementById("viewer");
  viewer.style.display = "none";
  viewerIsOpen = false;
  viewer.classList.remove("video-mode");
  const viewerVideo = document.getElementById("viewerVideo");
  viewerVideo.pause();
  window.MediaLoader.releaseVideo(viewerVideo);
  stopLiveStatusPolling();
  setLiveHint("");
  viewerVideoPerf = null;
  setViewerVideoFallback(null, false);
  document.body.style.overflow = "";
  viewerPriorityToken += 1;
  viewerPriorityActive = false;
  suspendThumbLoading(false);
}

function viewerNav(d) {
  const n = currentViewerIdx + d;
  if (n < 0 || n >= filteredFiles.length) return;
  currentViewerIdx = n;
  vZoom = 1;
  vOffX = 0;
  vOffY = 0;
  renderViewer();
}

function viewerZoom(d) {
  if (d === 0) {
    vZoom = 1;
    vOffX = 0;
    vOffY = 0;
  } else vZoom = Math.max(0.2, Math.min(6, vZoom + d));
  document.getElementById("viewerZoomLbl").textContent =
    Math.round(vZoom * 100) + "%";
  const img = document.getElementById("viewerMedia");
  if (img.style.display !== "none")
    img.style.transform = `translate(${vOffX}px,${vOffY}px) scale(${vZoom})`;
}

// Wheel zoom in viewer
document.getElementById("viewerStage").addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    viewerZoom(e.deltaY < 0 ? 0.15 : -0.15);
  },
  { passive: false },
);

// Drag-to-pan in viewer
const vStage = document.getElementById("viewerStage");
vStage.addEventListener("mousedown", (e) => {
  if (e.target !== document.getElementById("viewerMedia")) return;
  vDragging = true;
  vLastX = e.clientX;
  vLastY = e.clientY;
  e.preventDefault();
});
window.addEventListener("mousemove", (e) => {
  if (!vDragging) return;
  vOffX += e.clientX - vLastX;
  vOffY += e.clientY - vLastY;
  vLastX = e.clientX;
  vLastY = e.clientY;
  const img = document.getElementById("viewerMedia");
  if (img.style.display !== "none")
    img.style.transform = `translate(${vOffX}px,${vOffY}px) scale(${vZoom})`;
});
window.addEventListener("mouseup", () => {
  vDragging = false;
});

// Mobile swipe navigation (images only)
vStage.addEventListener(
  "touchstart",
  (e) => {
    if (window.innerWidth > 768) return;
    if (document.getElementById("viewer").style.display === "none") return;
    const f = filteredFiles[currentViewerIdx];
    if (!f || f.type !== "image") return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    touchTracking = true;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
  },
  { passive: true },
);

vStage.addEventListener(
  "touchmove",
  (e) => {
    if (!touchTracking) return;
    const t = e.changedTouches?.[0];
    if (!t) return;
    touchLastX = t.clientX;
    touchLastY = t.clientY;
  },
  { passive: true },
);

vStage.addEventListener(
  "touchend",
  () => {
    if (!touchTracking) return;
    touchTracking = false;
    const dx = touchLastX - touchStartX;
    const dy = touchLastY - touchStartY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const SWIPE_X_PX = 48;
    const DIRECTION_RATIO = 1.2;
    if (absX < SWIPE_X_PX) return;
    if (absX < absY * DIRECTION_RATIO) return;
    if (dx < 0) viewerNav(1);
    else viewerNav(-1);
  },
  { passive: true },
);

// Keyboard
document.addEventListener("keydown", (e) => {
  if (document.getElementById("viewer").style.display === "none") return;
  if (e.key === "ArrowLeft") viewerNav(-1);
  if (e.key === "ArrowRight") viewerNav(1);
  if (e.key === "Escape") closeViewer();
  if (e.key === "+" || e.key === "=") viewerZoom(0.25);
  if (e.key === "-") viewerZoom(-0.25);
  if (e.key === "0") viewerZoom(0);
});

// Close viewer on background click
document.getElementById("viewer").addEventListener("click", (e) => {
  if (
    e.target === document.getElementById("viewer") ||
    e.target === document.getElementById("viewerStage")
  )
    closeViewer();
});

// ── TOAST ─────────────────────────────────────────────────────
function toast(msg, ms = 2200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
}

// ── EVENTS ────────────────────────────────────────────────────
document.getElementById("search").addEventListener("input", applyFilters);
document.getElementById("entryFilter").addEventListener("change", (e) => {
  currentEntry = e.target.value || "all";
  applyFilters();
});
updateSelectionUI();

// ── VIRTUAL RENDER + IDB THUMB CACHE ────────────────────────
const THUMB_DB_NAME = "media3xv-thumbs";
const THUMB_DB_STORE = "thumbs";
const THUMB_DB_VERSION = 1;
const THUMB_MAX_BYTES = 220 * 1024 * 1024;
const THUMB_TTL_MS = 1000 * 60 * 60 * 24 * 21;
const VIRTUAL_OVERSCAN_PX = 900;
const GRID_PREVIEW_NEIGHBOR_ROWS = 2;
const virtualState = {
  rows: [],
  offsets: [],
  totalHeight: 0,
  gridCols: 1,
  lastStartIdx: -1,
  lastEndIdx: -1,
  lastCoreStartIdx: -1,
  lastCoreEndIdx: -1,
  lastTopPad: -1,
  lastBottomPad: -1,
  rowNodeCache: new Map(),
};
let thumbDbPromise = null;
const thumbNodeState = new WeakMap();
let idbSweepPending = false;

function scheduleIdbSweep() {
  if (idbSweepPending) return;
  idbSweepPending = true;
  setTimeout(() => {
    idbSweep();
    idbSweepPending = false;
  }, 5000);
}

function getThumbNodeState(el) {
  let st = thumbNodeState.get(el);
  if (!st) {
    st = {
      inFlightPromise: null,
      abortController: null,
      currentLevel: "",
      lastSuccessSrc: "",
      status: "idle", // idle|loading|loaded|failed|stale
      objectUrls: new Set(),
      token: "",
    };
    thumbNodeState.set(el, st);
  }
  return st;
}

function openThumbDb() {
  if (!("indexedDB" in window)) return Promise.resolve(null);
  if (thumbDbPromise) return thumbDbPromise;
  thumbDbPromise = new Promise((resolve) => {
    const req = indexedDB.open(THUMB_DB_NAME, THUMB_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(THUMB_DB_STORE)) {
        const store = db.createObjectStore(THUMB_DB_STORE, { keyPath: "key" });
        store.createIndex("touchedAt", "touchedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return thumbDbPromise;
}

async function idbGet(key) {
  const db = await openThumbDb();
  if (!db) return null;
  return await new Promise((resolve) => {
    const tx = db.transaction(THUMB_DB_STORE, "readonly");
    const store = tx.objectStore(THUMB_DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(record) {
  const db = await openThumbDb();
  if (!db) return;
  await new Promise((resolve) => {
    const tx = db.transaction(THUMB_DB_STORE, "readwrite");
    tx.objectStore(THUMB_DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function idbSweep(limitBytes = THUMB_MAX_BYTES) {
  const db = await openThumbDb();
  if (!db) return;
  const now = Date.now();
  const records = await new Promise((resolve) => {
    const tx = db.transaction(THUMB_DB_STORE, "readonly");
    const req = tx.objectStore(THUMB_DB_STORE).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => resolve([]);
  });
  const expired = records.filter(
    (r) => !r || !r.blob || now - Number(r.createdAt || 0) > THUMB_TTL_MS,
  );
  const valid = records.filter(
    (r) => r && r.blob && now - Number(r.createdAt || 0) <= THUMB_TTL_MS,
  );
  let total = valid.reduce((acc, r) => acc + (Number(r.bytes) || 0), 0);
  valid.sort((a, b) => Number(a.touchedAt || 0) - Number(b.touchedAt || 0));
  const toDelete = expired.map((r) => r.key);
  for (const r of valid) {
    if (total <= limitBytes) break;
    toDelete.push(r.key);
    total -= Number(r.bytes) || 0;
  }
  if (!toDelete.length) return;
  await new Promise((resolve) => {
    const tx = db.transaction(THUMB_DB_STORE, "readwrite");
    const store = tx.objectStore(THUMB_DB_STORE);
    toDelete.forEach((k) => store.delete(k));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function makeThumbCacheKey(file, src, level = "u") {
  const fid = file?.id || file?.url || "na";
  return `${currentIndexVersion || "nov"}::${fid}::${level}::${src}`;
}

async function getThumbObjectUrl(
  file,
  src,
  level = "u",
  signal,
  allowWhenSuspended = false,
) {
  if (thumbLoadingSuspended && !allowWhenSuspended)
    throw new Error("suspended");
  const key = makeThumbCacheKey(file, src, level);
  const cached = await idbGet(key);
  if (cached?.blob) {
    cached.touchedAt = Date.now();
    idbPut(cached).catch(() => {});
    return URL.createObjectURL(cached.blob);
  }
  const res = await fetch(src, { cache: "default", signal });
  if (!res.ok) throw new Error(`Thumb HTTP ${res.status}`);
  const blob = await res.blob();
  idbPut({
    key,
    blob,
    bytes: blob.size || 0,
    createdAt: Date.now(),
    touchedAt: Date.now(),
  }).catch(() => {});
  scheduleIdbSweep();
  return URL.createObjectURL(blob);
}

async function mountThumbWithSwap(el, file, src, level = "u", blurPx = 0) {
  if (thumbLoadingSuspended) throw new Error("suspended");
  const st = getThumbNodeState(el);
  if (st.abortController) st.abortController.abort();
  st.abortController = new AbortController();
  const signal = st.abortController.signal;
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  st.token = token;
  st.status = "loading";
  st.currentLevel = level;
  dbg("thumb loading", { fileId: file?.id || file?.url, level, token });

  const promise = (async () => {
    const objUrl = await getThumbObjectUrl(file, src, level, signal);
    if (signal.aborted) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch (_) {}
      throw new Error("aborted");
    }
    if (!document.body.contains(el)) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch (_) {}
      throw new Error("detached");
    }
    if (st.token !== token) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch (_) {}
      throw new Error("stale-token");
    }

    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.src = objUrl;
    try {
      if (img.decode) await img.decode();
    } catch {}
    await new Promise((resolve, reject) => {
      if (img.complete && img.naturalWidth > 0) return resolve();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("img-load-failed"));
    });
    if (signal.aborted) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch (_) {}
      throw new Error("aborted");
    }
    if (st.token !== token) {
      try {
        URL.revokeObjectURL(objUrl);
      } catch (_) {}
      throw new Error("stale-token");
    }

    // Commit only after successful decode/load; keep previous image until now.
    img.dataset.objurl = objUrl;
    img.style.cssText =
      "width:100%;height:100%;object-fit:cover;border-radius:inherit;filter:none;transform:none;transition:opacity 180ms ease;";
    const prevImgs = [...el.querySelectorAll("img[data-objurl]")];
    el.innerHTML = "";
    el.appendChild(img);
    prevImgs.forEach((p) => {
      const prevUrl = p.dataset.objurl;
      if (prevUrl) {
        try {
          URL.revokeObjectURL(prevUrl);
        } catch (_) {}
        st.objectUrls.delete(prevUrl);
      }
    });
    st.objectUrls.add(objUrl);
    st.lastSuccessSrc = src;
    const prevStatus = st.status;
    st.status = "loaded";
    el.dataset.loaded = "1";
    el.dataset.loading = "0";
    el.dataset.failed = "0";
    el.dataset.retryCount = "0";
    if (prevStatus === "loaded" && level === "512") {
      dbg("thumb loaded -> upgraded", {
        fileId: file?.id || file?.url,
        level,
        token,
      });
    } else {
      dbg("thumb loading -> loaded", {
        fileId: file?.id || file?.url,
        level,
        token,
      });
    }
    return img;
  })();

  st.inFlightPromise = promise;
  return promise;
}

function revokeObjectUrlsInNode(node) {
  if (!node) return;
  const st = getThumbNodeState(node);
  if (st.abortController) st.abortController.abort();
  st.inFlightPromise = null;
  st.status = st.status === "loaded" ? "stale" : st.status;
  st.objectUrls.forEach((u) => {
    try {
      URL.revokeObjectURL(u);
    } catch (_) {}
  });
  st.objectUrls.clear();
  dbg("thumb evicted -> revoked", { token: st.token, level: st.currentLevel });
  node.querySelectorAll("img[data-objurl]").forEach((img) => {
    const u = img.dataset.objurl;
    if (!u) return;
    try {
      URL.revokeObjectURL(u);
    } catch (_) {}
    img.removeAttribute("data-objurl");
  });
}

function invalidateVirtualRowCache() {
  for (const node of virtualState.rowNodeCache.values())
    revokeObjectUrlsInNode(node);
  virtualState.rowNodeCache.clear();
}

function makeThumbNode(file, isList = false, shouldHydrate = true) {
  const thumb = document.createElement("div");
  if (isList) thumb.className = "list-thumb";
  thumb.style.cssText = isList ? "" : "width:100%;height:100%;";
  thumb.dataset.src = file.url;
  thumb.dataset.type = file.type;
  if (file.thumbUrl) thumb.dataset.thumb = file.thumbUrl;
  thumb.dataset.retryCount = "0";
  thumb.dataset.loading = "0";
  thumb.innerHTML = placeholder(file.type);
  const st = getThumbNodeState(thumb);
  st.status = "idle";
  st.lastSuccessSrc = "";
  st.currentLevel = "";
  if (shouldHydrate) hydrateThumbNode(thumb, file);
  return thumb;
}

function hydrateThumbNode(el, file) {
  if (thumbLoadingSuspended) return;
  if (!file) return;
  const st = getThumbNodeState(el);
  if (st.status === "loading" && st.inFlightPromise) return;
  const hydrationToken = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  el.dataset.hydrationToken = hydrationToken;
  el.dataset.loading = "1";
  const maxRetries = 6;
  const retryCount = Number(el.dataset.retryCount || "0") || 0;
  const retryLater = () => {
    const next = retryCount + 1;
    el.dataset.retryCount = String(next);
    el.dataset.loading = "0";
    if (next > maxRetries) {
      if (!document.body.contains(el)) return;
      if (el.dataset.hydrationToken !== hydrationToken) return;
      el.dataset.failed = "1";
      el.dataset.retryCount = "0";
      el.dataset.loading = "0";
      if (st.status !== "loaded") {
        el.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--card);color:var(--muted);font-size:10px;">Generando preview…</div>`;
      }
      st.status = st.lastSuccessSrc ? "stale" : "failed";
      dbg("thumb loading -> failed", {
        fileId: file?.id || file?.url,
        level: st.currentLevel,
        token: st.token,
      });
      setTimeout(() => {
        if (thumbLoadingSuspended) return;
        if (!document.body.contains(el)) return;
        hydrateThumbNode(el, file);
      }, 2200);
      return;
    }
    const delay = Math.min(2000, 220 * 2 ** (next - 1));
    setTimeout(() => {
      if (thumbLoadingSuspended) return;
      if (!document.body.contains(el)) return;
      if (el.dataset.hydrationToken !== hydrationToken) return;
      hydrateThumbNode(el, file);
    }, delay);
  };

  if (file.type === "image") {
    const t128 =
      typeof file.thumb128Url === "string" && file.thumb128Url.trim()
        ? file.thumb128Url.trim()
        : typeof file.thumbUrl === "string" && file.thumbUrl.trim()
          ? file.thumbUrl.trim()
          : file.url;
    const t512 =
      typeof file.thumb512Url === "string" && file.thumb512Url.trim()
        ? file.thumb512Url.trim()
        : typeof file.thumbUrl === "string" && file.thumbUrl.trim()
          ? file.thumbUrl.trim()
          : t128;

    mountThumbWithSwap(el, file, t128, "128", 0)
      .then(() => {
        if (!document.body.contains(el)) return;
        if (el.dataset.hydrationToken !== hydrationToken) return;
        el.dataset.failed = "0";
        el.dataset.loading = "0";
        el.dataset.retryCount = "0";
        el.dataset.loaded = "1";
        return mountThumbWithSwap(el, file, t512, "512", 0)
          .then(() => {
            if (!document.body.contains(el)) return;
            if (el.dataset.hydrationToken !== hydrationToken) return;
            el.dataset.failed = "0";
            el.dataset.loading = "0";
            el.dataset.retryCount = "0";
            el.dataset.loaded = "1";
          })
          .catch(() => {});
      })
      .catch(() => {
        if (!document.body.contains(el)) return;
        if (el.dataset.hydrationToken !== hydrationToken) return;
        retryLater();
      });
    return;
  }
  if (file.type === "video") {
    requestVideoThumbPreview(el, file.url, 0, true);
    el.dataset.loading = "0";
    el.dataset.retryCount = "0";
  }
}

function rehydrateFailedThumbs(container) {
  if (!container) return;
  const pending = container.querySelectorAll("[data-src][data-type]");
  pending.forEach((el) => {
    const st = getThumbNodeState(el);
    if (st.status === "loading" && st.inFlightPromise) return;
    if (st.status === "loaded") return;
    if (
      st.status !== "failed" &&
      st.status !== "stale" &&
      el.dataset.loaded === "1"
    )
      return;
    const src = el.dataset.src;
    if (!src) return;
    const file = filteredFiles.find((f) => f?.url === src);
    if (!file) return;
    // Non-destructive rehydrate: keep previous visual when available.
    if (st.status !== "loaded" && !el.querySelector("img[data-objurl]")) {
      el.innerHTML = placeholder(file.type);
    }
    el.dataset.loading = "0";
    el.dataset.failed = st.status === "failed" ? "1" : "0";
    el.dataset.retryCount = el.dataset.retryCount || "0";
    hydrateThumbNode(el, file);
  });
}

function getGridColumns() {
  const app = document.getElementById("app");
  const px = SIZE_PX[sizeIdx];
  const width = Math.max(320, app.clientWidth || 320);
  return Math.max(1, Math.floor((width + 6) / (px + 6)));
}

function rebuildVirtualRows() {
  const rows = [];
  const gridCols = layoutMode === "grid" ? getGridColumns() : 1;
  const app = document.getElementById("app");
  const appWidth = Math.max(320, app?.clientWidth || 320);
  const gridGap = 6;
  const cellWidth =
    layoutMode === "grid"
      ? Math.max(
          40,
          Math.floor((appWidth - gridGap * (gridCols - 1)) / gridCols),
        )
      : 0;
  const gridRowHeight = layoutMode === "grid" ? cellWidth + gridGap : 0;
  for (const key of groupKeys) {
    const files = groupMap[key] || [];
    const displayLabel =
      currentGroup === "date" ? formatDateGroupLabel(key) : key;
    rows.push({
      kind: "header",
      label: displayLabel,
      count: files.length,
      groupKey: key,
      height: 30,
    });
    if (layoutMode === "list") {
      for (const f of files)
        rows.push({ kind: "list-item", files: [f], height: 58 });
    } else {
      for (let i = 0; i < files.length; i += gridCols) {
        rows.push({
          kind: "grid-row",
          files: files.slice(i, i + gridCols),
          height: gridRowHeight,
        });
      }
    }
  }
  virtualState.rows = rows;
  virtualState.gridCols = gridCols;
  virtualState.offsets = new Array(rows.length);
  let y = 0;
  for (let i = 0; i < rows.length; i += 1) {
    virtualState.offsets[i] = y;
    y += rows[i].height;
  }
  virtualState.totalHeight = y;
  virtualState.lastStartIdx = -1;
  virtualState.lastEndIdx = -1;
  virtualState.lastCoreStartIdx = -1;
  virtualState.lastCoreEndIdx = -1;
  virtualState.lastTopPad = -1;
  virtualState.lastBottomPad = -1;
  for (const node of virtualState.rowNodeCache.values())
    revokeObjectUrlsInNode(node);
  virtualState.rowNodeCache.clear();
}

function findRowIndexAt(offsetPx) {
  const offsets = virtualState.offsets;
  let lo = 0;
  let hi = offsets.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= offsetPx) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function renderVirtualViewport() {
  const app = document.getElementById("app");
  if (!app) return;
  if (!virtualState.rows.length) {
    app.innerHTML = `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg><p>Sin resultados</p></div>`;
    return;
  }
  const staticIosViewport = useStaticViewportOnIosMobile();
  let startIdx = 0;
  let endIdx = virtualState.rows.length - 1;
  let topPad = 0;
  let bottomPad = 0;
  let coreStartIdx = 0;
  let coreEndIdx = virtualState.rows.length - 1;
  if (!staticIosViewport) {
    const rect = app.getBoundingClientRect();
    const appTop = rect.top + window.scrollY;
    const coreViewTop = Math.max(0, window.scrollY - appTop);
    const coreViewBottom = coreViewTop + window.innerHeight;
    coreStartIdx = findRowIndexAt(coreViewTop);
    coreEndIdx = Math.min(
      virtualState.rows.length - 1,
      findRowIndexAt(coreViewBottom),
    );
    const viewTop = Math.max(0, window.scrollY - appTop - VIRTUAL_OVERSCAN_PX);
    const viewBottom = viewTop + window.innerHeight + VIRTUAL_OVERSCAN_PX * 2;
    startIdx = findRowIndexAt(viewTop);
    endIdx = Math.min(virtualState.rows.length - 1, findRowIndexAt(viewBottom));
    topPad = virtualState.offsets[startIdx] || 0;
    const endOffset =
      (virtualState.offsets[endIdx] || 0) + virtualState.rows[endIdx].height;
    bottomPad = Math.max(0, virtualState.totalHeight - endOffset);
  }

  if (
    startIdx === virtualState.lastStartIdx &&
    endIdx === virtualState.lastEndIdx &&
    coreStartIdx === virtualState.lastCoreStartIdx &&
    coreEndIdx === virtualState.lastCoreEndIdx &&
    topPad === virtualState.lastTopPad &&
    bottomPad === virtualState.lastBottomPad
  ) {
    return;
  }

  virtualState.lastStartIdx = startIdx;
  virtualState.lastEndIdx = endIdx;
  virtualState.lastCoreStartIdx = coreStartIdx;
  virtualState.lastCoreEndIdx = coreEndIdx;
  virtualState.lastTopPad = topPad;
  virtualState.lastBottomPad = bottomPad;
  while (app.firstChild) app.removeChild(app.firstChild);
  const topSpacer = document.createElement("div");
  topSpacer.style.height = `${topPad}px`;
  app.appendChild(topSpacer);

  const visibleSet = new Set();
  const hydrateStartIdx = Math.max(
    0,
    coreStartIdx - GRID_PREVIEW_NEIGHBOR_ROWS,
  );
  const hydrateEndIdx = Math.min(
    virtualState.rows.length - 1,
    coreEndIdx + GRID_PREVIEW_NEIGHBOR_ROWS,
  );
  const shouldHydrateRow = (rowIdx) =>
    layoutMode !== "grid" ||
    (rowIdx >= hydrateStartIdx && rowIdx <= hydrateEndIdx);
  const gridGap = 6;
  const appWidthNow = Math.max(320, app.clientWidth || 320);
  const cellWidthNow = Math.max(
    40,
    Math.floor(
      (appWidthNow - gridGap * (virtualState.gridCols - 1)) /
        Math.max(1, virtualState.gridCols),
    ),
  );
  const createRowNode = (row, rowIdx) => {
    if (row.kind === "header") {
      const h = document.createElement("div");
      h.className = "section-head";
      h.style.marginBottom = "10px";
      h.style.marginTop = "8px";
      h.innerHTML = `<span>${row.label}</span><span style="font-size:11px;font-family:var(--mono);color:var(--muted);margin-left:6px;">${row.count}</span>`;
      return h;
    }
    if (row.kind === "grid-row") {
      const g = document.createElement("div");
      g.style.cssText = `display:grid;grid-template-columns:repeat(${virtualState.gridCols}, minmax(0,1fr));gap:6px;margin-bottom:6px;`;
      for (const f of row.files) {
        const card = document.createElement("div");
        card.className = "media-card";
        card.dataset.url = f.url;
        if (selectedUrls.has(f.url)) {
          card.classList.add("selected");
          const mark = document.createElement("div");
          mark.className = "sel-indicator";
          mark.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg>';
          card.appendChild(mark);
        }
        card.style.aspectRatio = "1";
        card.setAttribute("draggable", "true");
        const thumb = makeThumbNode(f, false, shouldHydrateRow(rowIdx));
        card.appendChild(thumb);
        const ov = document.createElement("div");
        ov.className = "card-overlay";
        ov.innerHTML = `<span class="card-name">${f.name}</span>`;
        card.appendChild(ov);
        if (f.type !== "image") {
          const badge = document.createElement("div");
          badge.className = "type-badge";
          badge.innerHTML =
            f.type === "video"
              ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>Video`
              : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>Audio`;
          card.appendChild(badge);
        }
        const gi = filteredFiles.findIndex((x) => x.url === f.url);
        card.onclick = (e) => {
          if (handleItemSelection(f, e)) return;
          openViewer(gi);
        };
        card.addEventListener("dragstart", () => {
          dragSrc = f.url;
        });
        card.addEventListener("dragover", (e) => {
          e.preventDefault();
          card.classList.add("drag-over");
        });
        card.addEventListener("dragleave", () =>
          card.classList.remove("drag-over"),
        );
        card.addEventListener("drop", (e) => {
          e.preventDefault();
          card.classList.remove("drag-over");
          reorder(dragSrc, f.url);
        });
        g.appendChild(card);
      }
      if (row.files.length < virtualState.gridCols) {
        for (
          let iBlank = row.files.length;
          iBlank < virtualState.gridCols;
          iBlank += 1
        ) {
          const blank = document.createElement("div");
          blank.style.cssText = `min-height:${cellWidthNow}px;`;
          g.appendChild(blank);
        }
      }
      return g;
    }
    if (row.kind === "list-item") {
      const f = row.files[0];
      const gi = filteredFiles.findIndex((x) => x.url === f.url);
      const el = document.createElement("div");
      el.className = "list-row";
      el.dataset.url = f.url;
      if (selectedUrls.has(f.url)) {
        el.classList.add("selected");
        const mark = document.createElement("div");
        mark.className = "sel-indicator";
        mark.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:11px;height:11px"><polyline points="20 6 9 17 4 12"/></svg>';
        el.appendChild(mark);
      }
      el.style.marginBottom = "4px";
      const thumb = makeThumbNode(f, true, shouldHydrateRow(rowIdx));
      const body = document.createElement("div");
      body.style.cssText = "flex:1;min-width:0;";
      body.innerHTML = `<div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</div><div style="font-size:11px;color:var(--muted);margin-top:2px;">${prettyDate(f.date)}</div>`;
      const dl = document.createElement("a");
      dl.href = f.url;
      dl.download = f.name;
      dl.onclick = (ev) => ev.stopPropagation();
      dl.style.cssText =
        "background:var(--panel);border:1px solid var(--border);color:var(--muted-l);padding:5px 9px;border-radius:7px;text-decoration:none;font-size:12px;transition:background 0.15s;display:flex;align-items:center;gap:4px;";
      dl.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      el.appendChild(thumb);
      el.appendChild(body);
      el.appendChild(dl);
      el.onclick = (e) => {
        if (handleItemSelection(f, e)) return;
        openViewer(gi);
      };
      return el;
    }
    return document.createElement("div");
  };

  for (let i = startIdx; i <= endIdx; i += 1) {
    visibleSet.add(i);
    const row = virtualState.rows[i];
    if (!row) continue;
    let rowNode = virtualState.rowNodeCache.get(i);
    if (!rowNode) {
      rowNode = createRowNode(row, i);
      virtualState.rowNodeCache.set(i, rowNode);
    } else {
      if (shouldHydrateRow(i)) {
        rehydrateFailedThumbs(rowNode);
        rowNode.querySelectorAll("[data-src][data-type]").forEach((el) => {
          const src = el.dataset.src;
          if (!src) return;
          if (el.dataset.loaded === "1" || el.dataset.loading === "1") return;
          const file = filteredFiles.find((f) => f?.url === src);
          if (!file) return;
          hydrateThumbNode(el, file);
        });
      }
    }
    app.appendChild(rowNode);
  }

  const bottomSpacer = document.createElement("div");
  bottomSpacer.style.height = `${bottomPad}px`;
  app.appendChild(bottomSpacer);

  const evictKeys = [];
  for (const k of virtualState.rowNodeCache.keys()) {
    if (visibleSet.has(k)) continue;
    if (k >= startIdx - 60 && k <= endIdx + 60) continue;
    evictKeys.push(k);
  }
  for (const k of evictKeys) {
    const node = virtualState.rowNodeCache.get(k);
    revokeObjectUrlsInNode(node);
    virtualState.rowNodeCache.delete(k);
  }
}

let virtualRenderScheduled = false;
let lastVirtualViewportWidth = 0;
let lastScrollAt = 0;
let resizeDebounceTimer = null;
const WIDTH_REBUILD_THRESHOLD_PX = 8;
const MOBILE_WIDTH_REBUILD_THRESHOLD_PX = 64;
const SCROLL_GUARD_MS = 280;
let suppressScrollRender = false;
let lastVirtualIsMobile = null;
let lastVirtualOrientation = "";
let lastVirtualGridCols = 1;

function getStableViewportWidth() {
  return Math.round(
    document.documentElement?.clientWidth || window.innerWidth || 0,
  );
}

function getViewportOrientation() {
  return window.matchMedia &&
    window.matchMedia("(orientation: portrait)").matches
    ? "portrait"
    : "landscape";
}

function hasCoarsePointer() {
  return Boolean(
    window.matchMedia && window.matchMedia("(pointer: coarse)").matches,
  );
}

function useStaticViewportOnIosMobile() {
  return isIosWebkitLike() && window.innerWidth <= 768;
}

function captureVirtualAnchor() {
  const app = document.getElementById("app");
  if (!app || !virtualState.rows.length || !virtualState.offsets.length)
    return null;
  const rect = app.getBoundingClientRect();
  const appTop = rect.top + window.scrollY;
  const viewTop = Math.max(0, window.scrollY - appTop);
  const idx = Math.min(virtualState.rows.length - 1, findRowIndexAt(viewTop));
  const rowTop = virtualState.offsets[idx] || 0;
  return { idx, delta: viewTop - rowTop };
}

function restoreVirtualAnchor(anchor) {
  // Never force scroll re-anchor on touch-first devices.
  if (hasCoarsePointer()) return;
  if (!anchor || !virtualState.rows.length) return;
  const app = document.getElementById("app");
  if (!app) return;
  const idx = Math.max(0, Math.min(anchor.idx, virtualState.rows.length - 1));
  const rowTop = virtualState.offsets[idx] || 0;
  const rect = app.getBoundingClientRect();
  const appTop = rect.top + window.scrollY;
  const targetY = Math.max(
    0,
    Math.round(appTop + rowTop + (anchor.delta || 0)),
  );
  suppressScrollRender = true;
  window.scrollTo(0, targetY);
  setTimeout(() => {
    suppressScrollRender = false;
  }, 80);
}
function scheduleVirtualRender() {
  if (virtualRenderScheduled) return;
  virtualRenderScheduled = true;
  requestAnimationFrame(() => {
    virtualRenderScheduled = false;
    renderVirtualViewport();
  });
}

window.addEventListener(
  "scroll",
  () => {
    if (suppressScrollRender) return;
    lastScrollAt = Date.now();
    scheduleVirtualRender();
  },
  { passive: true },
);
window.addEventListener("resize", () => {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    const touchDevice = hasCoarsePointer();
    const isMobile = window.innerWidth <= 768 || touchDevice;
    const orientation = getViewportOrientation();
    const currentWidth = getStableViewportWidth();
    if (!currentWidth) return;

    const widthDelta = Math.abs(
      currentWidth - (lastVirtualViewportWidth || currentWidth),
    );
    const crossedBreakpoint =
      lastVirtualIsMobile !== null && lastVirtualIsMobile !== isMobile;
    const orientationChanged = Boolean(
      lastVirtualOrientation && lastVirtualOrientation !== orientation,
    );
    const currentGridCols = layoutMode === "grid" ? getGridColumns() : 1;
    const colsChanged =
      currentGridCols !== (lastVirtualGridCols || currentGridCols);

    if (isMobile) {
      // Mobile browser chrome changes can emit resize many times while scrolling.
      // Prioritize stability and rebuild only on meaningful layout changes.
      if (Date.now() - lastScrollAt < SCROLL_GUARD_MS) return;
      if (!crossedBreakpoint && !orientationChanged && !colsChanged) {
        if (widthDelta < MOBILE_WIDTH_REBUILD_THRESHOLD_PX) return;
      }
      lastVirtualViewportWidth = currentWidth;
      lastVirtualIsMobile = isMobile;
      lastVirtualOrientation = orientation;
      lastVirtualGridCols = currentGridCols;
      rebuildVirtualRows();
      scheduleVirtualRender();
      return;
    }

    if (
      lastVirtualViewportWidth &&
      widthDelta < WIDTH_REBUILD_THRESHOLD_PX &&
      !crossedBreakpoint &&
      !orientationChanged &&
      !colsChanged
    ) {
      return;
    }
    const anchor = touchDevice ? null : captureVirtualAnchor();
    lastVirtualViewportWidth = currentWidth;
    lastVirtualIsMobile = isMobile;
    lastVirtualOrientation = orientation;
    lastVirtualGridCols = currentGridCols;
    rebuildVirtualRows();
    restoreVirtualAnchor(anchor);
    scheduleVirtualRender();
  }, 180);
});

function applyFilters() {
  const query = document.getElementById("search").value || "";
  const result = applyFiltersUseCase({
    allFiles,
    favoritesOnly,
    currentType,
    currentEntry,
    currentSort,
    currentGroup,
    query,
    isFavorite,
  });
  filteredFiles = result.filteredFiles;
  groupMap = result.groupMap;
  groupKeys = result.groupKeys;
  appStore.setState({
    allFiles,
    filteredFiles,
    sizeIdx,
    lastDesktopSizeIdx,
    layoutMode,
    currentSort,
    currentGroup,
    currentType,
    currentEntry,
    favoritesOnly,
  });
  updateSelectionUI();
  updateStats();
  rebuildVirtualRows();
  scheduleVirtualRender();
}

Object.assign(window, {
  openSidebar,
  closeSidebar,
  toggleFavoritesOnly,
  toggleSortMenu,
  setSort,
  toggleLayout,
  toggleSelectMode,
  deleteSelectedFiles,
  setTypeFilter,
  setGroup,
  stepZoom,
  setZoomBySlider,
  openConfigModal,
  closeConfigModal,
  loadConfigModalData,
  saveConfigModalData,
  openUploadPicker,
  cleanupCacheTargets,
  loadCacheStats,
  toggleViewerFavorite,
  closeViewer,
  viewerNav,
  viewerZoom,
});

// ── INIT ──────────────────────────────────────────────────────
(async () => {
  const uploadInput = document.getElementById("uploadInput");
  if (uploadInput) uploadInput.addEventListener("change", uploadSelectedFiles);
  syncStickyBars();
  enforceMobileGridSize();
  lastVirtualViewportWidth = getStableViewportWidth();
  lastVirtualIsMobile = window.innerWidth <= 768;
  lastVirtualOrientation = getViewportOrientation();
  lastVirtualGridCols = layoutMode === "grid" ? getGridColumns() : 1;
  while (true) {
    try {
      const idx = await loadIndex();
      indexRetryCount = 0;
      currentIndexVersion = idx.version;
      applyNewFileSet(idx.files, "init");
      startIndexPolling();
      break;
    } catch (err) {
      if (err.code === "INDEXING") {
        document.getElementById("app").innerHTML = `
          <div class="empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <p style="font-size:14px;font-weight:500;">Indexando archivos…</p>
            <p style="font-size:12px;">La lista aparecerá automáticamente al terminar.</p>
          </div>`;
        indexRetryCount += 1;
        await new Promise((r) => setTimeout(r, indexBackoffMs()));
        continue;
      }
      document.getElementById("app").innerHTML = `
        <div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p style="font-size:14px;font-weight:500;">Error al cargar índice</p>
          <p style="font-size:12px;">Verifica el servidor Node y la ruta de medios.</p>
          <p style="font-size:11px;font-family:var(--mono);color:var(--muted);">${err.message}</p>
        </div>`;
      break;
    }
  }
})();
