#!/usr/bin/env node
import http from "node:http";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL } from "node:url";
import {
  defaults,
  normalizeSourceLists,
  readConfig as readConfigFile,
  writeConfig as writeConfigFile,
} from "./js/server/features/config/repository.mjs";
import { buildIndexPayloadFactory } from "./js/server/features/indexing/builders.mjs";
import { createCacheService } from "./js/server/features/cache/service.mjs";
import { createThumbHandler } from "./js/server/features/thumb/handler.mjs";
import { createLiveService } from "./js/server/features/live/service.mjs";

const ROOT_DIR = path.resolve(".");
const CONFIG_FILE = path.resolve(ROOT_DIR, "config.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};

const state = {
  status: "idle",
  refreshing: false,
  version: null,
  generatedAt: null,
  count: 0,
  files: [],
  lastError: null,
  scanPromise: null,
  watchTimer: null,
};

async function readConfig() {
  return readConfigFile(fs, CONFIG_FILE);
}

async function writeConfig(cfg) {
  await writeConfigFile(fs, CONFIG_FILE, cfg);
}

function json(res, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function nowIso() {
  return new Date().toISOString();
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function boot() {
  const cfg = await readConfig();
  const HOST = process.env.HOST || cfg.host;
  const PORT = Number(process.env.PORT || cfg.port);
  const SOURCE_MODE = String(
    process.env.SOURCE_MODE || cfg.sourceMode || "filesystem",
  ).toLowerCase();
  const lists = normalizeSourceLists(cfg);
  const MEDIA_ROOTS = process.env.MEDIA_ROOT
    ? [path.resolve(process.env.MEDIA_ROOT)]
    : lists.mediaRoots;
  const AUTOINDEX_ROOT_URLS = process.env.AUTOINDEX_ROOT_URL
    ? [String(process.env.AUTOINDEX_ROOT_URL)]
    : lists.autoindexRootUrls;
  const INDEX_FILE = path.resolve(
    process.env.MEDIA_INDEX_FILE || cfg.mediaIndexFile,
  );
  const INDEX_TMP = `${INDEX_FILE}.tmp`;
  const THUMB_CACHE_DIR = path.resolve(ROOT_DIR, ".thumb-cache");
  const LIVE_TEMP_DIR = path.resolve(ROOT_DIR, ".temp_livephotos");
  const LIVE_SNAPSHOT_DIR = path.resolve(LIVE_TEMP_DIR, "snapshots");
  const LIVE_WEB_DIR = path.resolve(LIVE_TEMP_DIR, "web");
  const WATCH_DEBOUNCE_MS = Number(
    process.env.WATCH_DEBOUNCE_MS || cfg.watchDebounceMs,
  );
  const AUTOINDEX_REFRESH_MS = Number(
    process.env.AUTOINDEX_REFRESH_MS || cfg.autoindexRefreshMs || 20000,
  );
  const DEBUG = String(process.env.DEBUG ?? cfg.debug).toLowerCase() === "true";

  const log = (...args) => {
    if (!DEBUG) return;
    process.stdout.write(`[DEBUG ${nowIso()}] ${args.join(" ")}\n`);
  };

  const cacheService = createCacheService({
    fs,
    path,
    thumbCacheDir: THUMB_CACHE_DIR,
    liveTempDir: LIVE_TEMP_DIR,
  });

  if (!["filesystem", "autoindex", "mixed"].includes(SOURCE_MODE)) {
    throw new Error(
      `sourceMode inválido: ${SOURCE_MODE}. Usa "filesystem", "autoindex" o "mixed".`,
    );
  }
  if (
    (SOURCE_MODE === "autoindex" || SOURCE_MODE === "mixed") &&
    AUTOINDEX_ROOT_URLS.length === 0
  ) {
    throw new Error(
      'autoindexRootUrl(s) es requerido cuando sourceMode="autoindex".',
    );
  }
  if (
    (SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed") &&
    MEDIA_ROOTS.length === 0
  ) {
    throw new Error(
      'mediaRoot(s) es requerido cuando sourceMode="filesystem".',
    );
  }
  if (SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed") {
    for (const mediaRoot of MEDIA_ROOTS) {
      try {
        const st = await fs.stat(mediaRoot);
        if (!st.isDirectory())
          throw new Error("mediaRoot existe pero no es directorio");
      } catch (err) {
        throw new Error(
          `mediaRoot inválido/no accesible: ${mediaRoot} (${err.message})`,
        );
      }
    }
  }
  if (SOURCE_MODE === "autoindex" || SOURCE_MODE === "mixed") {
    for (const rootUrl of AUTOINDEX_ROOT_URLS) {
      let parsed = null;
      try {
        parsed = new URL(rootUrl);
      } catch (err) {
        throw new Error(
          `autoindexRootUrl inválido: ${rootUrl} (${err.message})`,
        );
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(`autoindexRootUrl debe ser http/https: ${rootUrl}`);
      }
      const probe = await fetch(parsed.href, {
        method: "GET",
        cache: "no-store",
      });
      if (!probe.ok) {
        throw new Error(
          `autoindexRootUrl no accesible: HTTP ${probe.status} ${parsed.href}`,
        );
      }
    }
  }
  try {
    await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
    await fs.mkdir(THUMB_CACHE_DIR, { recursive: true });
    await fs.mkdir(LIVE_SNAPSHOT_DIR, { recursive: true });
    await fs.mkdir(LIVE_WEB_DIR, { recursive: true });
  } catch (err) {
    throw new Error(
      `No se puede crear/acceder directorio de índice: ${path.dirname(INDEX_FILE)} (${err.message})`,
    );
  }
  log(`Boot config sourceMode=${SOURCE_MODE} host=${HOST} port=${PORT}`);

  async function serveFile(req, res, absolutePath) {
    try {
      const t0 = Date.now();
      const st = await fs.stat(absolutePath);
      if (!st.isFile()) throw new Error("not file");
      const ext = path.extname(absolutePath).toLowerCase();
      const mimeType = contentTypes[ext] || "application/octet-stream";
      const total = st.size;
      const range = req.headers.range;
      const isMedia = MEDIA_ROOTS.some((root) => absolutePath.startsWith(root));

      if (isMedia && range) {
        const m = String(range).match(/^bytes=(\d*)-(\d*)$/i);
        if (!m) {
          log(`RANGE 416 invalid-range path=${absolutePath}`);
          res.writeHead(416, { "Content-Range": `bytes */${total}` });
          return res.end();
        }
        let start = m[1] === "" ? 0 : Number(m[1]);
        let end = m[2] === "" ? total - 1 : Number(m[2]);
        if (
          Number.isNaN(start) ||
          Number.isNaN(end) ||
          start > end ||
          start < 0 ||
          end >= total
        ) {
          log(
            `RANGE 416 unsat start=${start} end=${end} total=${total} path=${absolutePath}`,
          );
          res.writeHead(416, { "Content-Range": `bytes */${total}` });
          return res.end();
        }
        const chunkSize = end - start + 1;
        log(
          `RANGE 206 mime=${mimeType} start=${start} end=${end} total=${total} path=${absolutePath}`,
        );
        res.writeHead(206, {
          "Content-Type": mimeType,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
        });
        const rs = createReadStream(absolutePath, {
          start,
          end,
          highWaterMark: 256 * 1024,
        });
        rs.on("open", () =>
          log(
            `RANGE 206 open-latency-ms=${Date.now() - t0} bytes=${chunkSize} path=${absolutePath}`,
          ),
        );
        return rs.pipe(res);
      }

      log(
        `RANGE 200 mime=${mimeType} total=${total} path=${absolutePath} range=${range ? "present" : "none"}`,
      );
      res.writeHead(200, {
        "Content-Type": mimeType,
        "Content-Length": total,
        "Accept-Ranges": "bytes",
      });
      const rs = createReadStream(absolutePath, { highWaterMark: 256 * 1024 });
      rs.on("open", () =>
        log(
          `RANGE 200 open-latency-ms=${Date.now() - t0} bytes=${total} path=${absolutePath}`,
        ),
      );
      return rs.pipe(res);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }

  const liveService = createLiveService({
    fs,
    path,
    crypto,
    createReadStream,
    mediaRoots: MEDIA_ROOTS,
    liveSnapshotDir: LIVE_SNAPSHOT_DIR,
    liveWebDir: LIVE_WEB_DIR,
    pathExists,
    serveFile,
    json,
    log,
  });
  const thumbHandler = createThumbHandler({
    fs,
    path,
    crypto,
    createReadStream,
    mediaRoots: MEDIA_ROOTS,
    thumbCacheDir: THUMB_CACHE_DIR,
    log,
  });

  async function persistIndex(payload) {
    log(
      `Persisting index temp=${INDEX_TMP} final=${INDEX_FILE} count=${payload.count} version=${payload.version}`,
    );
    await fs.writeFile(
      INDEX_TMP,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(INDEX_TMP, INDEX_FILE);
  }

  async function loadPersistedIndex() {
    try {
      const raw = await fs.readFile(INDEX_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.files)) return false;
      state.status = "ready";
      state.refreshing = false;
      state.version = parsed.version || null;
      state.generatedAt = parsed.generatedAt || null;
      state.count = parsed.count || parsed.files.length;
      state.files = parsed.files;
      log(
        `Loaded persisted index version=${state.version || "n/a"} count=${state.count}`,
      );
      return true;
    } catch {
      log("No persisted index available");
      return false;
    }
  }

  const buildIndexPayload = buildIndexPayloadFactory({
    fs,
    mediaRoots: MEDIA_ROOTS,
    autoindexRootUrls: AUTOINDEX_ROOT_URLS,
    sourceMode: SOURCE_MODE,
    crypto,
    log,
    detectLivePhotoFilesystem: liveService.detectLivePhotoFilesystem,
  });

  async function ensureScan() {
    if (state.scanPromise) return state.scanPromise;
    const hadReadySnapshot =
      state.status === "ready" &&
      Array.isArray(state.files) &&
      state.files.length >= 0;
    state.status = hadReadySnapshot ? "ready" : "indexing";
    state.refreshing = hadReadySnapshot;
    state.lastError = null;
    log(
      `Scan state=${state.status}${state.refreshing ? " refreshing=true" : ""}`,
    );
    state.scanPromise = (async () => {
      try {
        const payload = await buildIndexPayload();
        await persistIndex(payload);
        state.status = "ready";
        state.refreshing = false;
        state.version = payload.version;
        state.generatedAt = payload.generatedAt;
        state.count = payload.count;
        state.files = payload.files;
        log(
          `Scan state=ready refreshing=false count=${state.count} version=${state.version}`,
        );
        return payload;
      } catch (err) {
        if (!hadReadySnapshot) {
          state.status = "error";
        } else {
          state.status = "ready";
        }
        state.refreshing = false;
        state.lastError = err.message;
        log(
          `Scan state=${state.status} refreshing=false message=${err.message}`,
        );
        throw err;
      } finally {
        state.scanPromise = null;
      }
    })();
    return state.scanPromise;
  }

  function triggerScanDebounced() {
    if (state.watchTimer) clearTimeout(state.watchTimer);
    log(`Scan debounced waitMs=${WATCH_DEBOUNCE_MS}`);
    state.watchTimer = setTimeout(() => {
      ensureScan().catch(() => {});
    }, WATCH_DEBOUNCE_MS);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    log(`HTTP ${req.method} ${pathname}`);

    if (pathname === "/api/media-index") {
      if (state.status === "ready") {
        return json(res, 200, {
          status: "ready",
          refreshing: state.refreshing,
          version: state.version,
          generatedAt: state.generatedAt,
          count: state.count,
          files: state.files,
        });
      }
      if (state.status === "error") {
        return json(res, 500, {
          status: "error",
          message: state.lastError || "Index error",
        });
      }
      ensureScan().catch(() => {});
      return json(res, 202, {
        status: "indexing",
        refreshing: state.refreshing,
        version: state.version,
        generatedAt: state.generatedAt,
        count: state.count,
      });
    }

    if (pathname === "/api/index-status") {
      return json(res, 200, {
        status: state.status,
        refreshing: state.refreshing,
        version: state.version,
        generatedAt: state.generatedAt,
        count: state.count,
        lastError: state.lastError,
      });
    }

    if (pathname === "/api/config") {
      if (req.method === "GET") {
        const liveCfg = await readConfig();
        const liveLists = normalizeSourceLists(liveCfg);
        return json(res, 200, {
          sourceMode: String(liveCfg.sourceMode || SOURCE_MODE).toLowerCase(),
          mediaRoots: liveLists.mediaRoots,
          autoindexRootUrls: liveLists.autoindexRootUrls,
          mediaRoot: liveLists.mediaRoots[0] || "",
          autoindexRootUrl: liveLists.autoindexRootUrls[0] || "",
        });
      }
      if (req.method === "POST") {
        try {
          let body = "";
          for await (const chunk of req) body += chunk;
          const payload = JSON.parse(body || "{}");
          const baseCfg = await readConfig();
          const baseLists = normalizeSourceLists(baseCfg);
          const nextMode = String(
            payload.sourceMode || baseCfg.sourceMode || SOURCE_MODE,
          ).toLowerCase();
          const nextMediaRootsRaw = [
            ...(Array.isArray(payload.mediaRoots) ? payload.mediaRoots : []),
            payload.mediaRoot,
          ]
            .filter(Boolean)
            .map((v) => path.resolve(String(v)));
          const nextAutoRootsRaw = [
            ...(Array.isArray(payload.autoindexRootUrls)
              ? payload.autoindexRootUrls
              : []),
            payload.autoindexRootUrl,
          ]
            .filter(Boolean)
            .map((v) => String(v));
          const nextMediaRoots = nextMediaRootsRaw.length
            ? [...new Set(nextMediaRootsRaw)]
            : baseLists.mediaRoots;
          const nextAutoRoots = nextAutoRootsRaw.length
            ? [...new Set(nextAutoRootsRaw)]
            : baseLists.autoindexRootUrls;
          if (!["filesystem", "autoindex", "mixed"].includes(nextMode)) {
            return json(res, 400, { error: "sourceMode inválido" });
          }
          if (
            (nextMode === "filesystem" || nextMode === "mixed") &&
            nextMediaRoots.length === 0
          ) {
            return json(res, 400, { error: "Agrega al menos un mediaRoot" });
          }
          if (
            (nextMode === "autoindex" || nextMode === "mixed") &&
            nextAutoRoots.length === 0
          ) {
            return json(res, 400, {
              error: "Agrega al menos un autoindexRootUrl",
            });
          }
          const saveCfg = {
            ...baseCfg,
            sourceMode: nextMode,
            mediaRoots: nextMediaRoots,
            autoindexRootUrls: nextAutoRoots,
            mediaRoot: nextMediaRoots[0] || "",
            autoindexRootUrl: nextAutoRoots[0] || "",
          };
          await writeConfig(saveCfg);
          return json(res, 200, { ok: true, requiresRestart: true });
        } catch (err) {
          return json(res, 400, { error: err.message || "config inválida" });
        }
      }
      res.writeHead(405);
      return res.end("Method not allowed");
    }

    if (pathname === "/api/cache-cleanup") {
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        const targets = Array.isArray(payload.targets) ? payload.targets : [];
        const allowedTargets = new Set(["thumb-cache", "temp-livephotos"]);
        const selected = targets.filter((t) => allowedTargets.has(String(t)));
        if (selected.length === 0) {
          return json(res, 400, {
            error: "Selecciona al menos un target válido",
          });
        }
        for (const t of selected) {
          if (t === "thumb-cache") await cacheService.safeClearDir(THUMB_CACHE_DIR);
          if (t === "temp-livephotos") await cacheService.safeClearDir(LIVE_TEMP_DIR);
        }
        return json(res, 200, {
          ok: true,
          cleaned: selected,
          paths: {
            "thumb-cache": THUMB_CACHE_DIR,
            "temp-livephotos": LIVE_TEMP_DIR,
          },
        });
      } catch (err) {
        return json(res, 400, {
          error: err.message || "No se pudo limpiar caché",
        });
      }
    }

    if (pathname === "/api/cache-stats") {
      if (req.method !== "GET") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      try {
        const thumbBytes = await cacheService.dirSizeBytes(THUMB_CACHE_DIR);
        const liveBytes = await cacheService.dirSizeBytes(LIVE_TEMP_DIR);
        return json(res, 200, {
          ok: true,
          stats: {
            "thumb-cache": {
              path: THUMB_CACHE_DIR,
              bytes: thumbBytes,
            },
            "temp-livephotos": {
              path: LIVE_TEMP_DIR,
              bytes: liveBytes,
            },
            totalBytes: thumbBytes + liveBytes,
          },
        });
      } catch (err) {
        return json(res, 400, {
          error: err.message || "No se pudo leer cache stats",
        });
      }
    }

    if (pathname === "/thumb/video") {
      return thumbHandler.handle(req, res, url);
    }

    if (pathname === "/live/snapshot") {
      return liveService.handleSnapshot(req, res, url);
    }

    if (pathname === "/live/web-video") {
      return liveService.handleWebVideo(req, res, url);
    }

    if (pathname === "/live/web-video-prepare") {
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      return liveService.handlePrepare(res, url);
    }

    if (pathname === "/live/web-video-status") {
      if (req.method !== "GET") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      return liveService.handleStatus(res, url);
    }

    if (
      (SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed") &&
      pathname.startsWith("/media/")
    ) {
      const relAll = pathname.slice("/media/".length);
      const slash = relAll.indexOf("/");
      if (slash < 1) {
        res.writeHead(400);
        return res.end("Bad media path");
      }
      const rootIdx = Number(relAll.slice(0, slash));
      const rel = relAll.slice(slash + 1);
      const mediaRoot = MEDIA_ROOTS[rootIdx];
      if (!mediaRoot) {
        res.writeHead(404);
        return res.end("Media root not found");
      }
      const abs = path.resolve(mediaRoot, rel);
      if (!abs.startsWith(mediaRoot)) {
        res.writeHead(403);
        return res.end("Forbidden");
      }
      return serveFile(req, res, abs);
    }

    if (pathname.startsWith("/js/")) {
      return serveFile(req, res, path.resolve(ROOT_DIR, `.${pathname}`));
    }

    if (pathname === "/" || pathname === "/index.html") {
      return serveFile(req, res, path.resolve(ROOT_DIR, "index.html"));
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await loadPersistedIndex();
  ensureScan().catch(() => {});
  if (SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed") {
    for (const mediaRoot of MEDIA_ROOTS) {
      try {
        fs.watch(mediaRoot, { recursive: true }, () => triggerScanDebounced());
        log(`Watching filesystem path=${mediaRoot}`);
      } catch {
        // Keep service running even if recursive watch is not supported.
        log(`fs.watch recursive not available for ${mediaRoot}`);
      }
    }
  }
  if (SOURCE_MODE === "autoindex" || SOURCE_MODE === "mixed") {
    log(`Autoindex periodic refresh everyMs=${AUTOINDEX_REFRESH_MS}`);
    setInterval(() => triggerScanDebounced(), AUTOINDEX_REFRESH_MS);
  }

  server.listen(PORT, HOST, () => {
    process.stdout.write(`Server running at http://${HOST}:${PORT}\n`);
    process.stdout.write(`Source mode: ${SOURCE_MODE}\n`);
    if (SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed")
      process.stdout.write(`Media roots: ${MEDIA_ROOTS.join(" | ")}\n`);
    if (SOURCE_MODE === "autoindex" || SOURCE_MODE === "mixed")
      process.stdout.write(
        `Autoindex roots: ${AUTOINDEX_ROOT_URLS.join(" | ")}\n`,
      );
    process.stdout.write(`Config file: ${CONFIG_FILE}\n`);
    process.stdout.write(`Debug: ${DEBUG ? "ON" : "OFF"}\n`);
  });
}

boot().catch((err) => {
  process.stderr.write(`Failed to boot: ${err.message}\n`);
  process.exit(1);
});
