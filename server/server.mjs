#!/usr/bin/env node
import http from "node:http";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import cluster from "node:cluster";
import os from "node:os";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import {
  defaults,
  normalizeSourceLists,
  readConfig as readConfigFile,
  writeConfig as writeConfigFile,
} from "./js/features/config/repository.mjs";
import { buildIndexPayloadFactory } from "./js/features/indexing/builders.mjs";
import { createCacheService } from "./js/features/cache/service.mjs";
import { createThumbHandler } from "./js/features/thumb/handler.mjs";
import { createLiveService } from "./js/features/live/service.mjs";
import { createTaskScheduler } from "./js/shared/task-scheduler.mjs";
import { detectType, toPosix } from "./js/shared/media-utils.mjs";
import { createClientHttpModule } from "./client-http/index.mjs";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVER_DIR, "..");
const CLIENT_HTTP_DIR = path.resolve(SERVER_DIR, "client-http");
const CONFIG_FILE = path.resolve(SERVER_DIR, "config.json");

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
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
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
  fsQuickFingerprint: null,
  partitions: {},
  lastScanDurationMs: 0,
  lastScanAt: null,
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

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function buildFilesystemFingerprintFromIndex(files) {
  const digest = crypto.createHash("sha1");
  for (const f of files) {
    if (!f || typeof f.url !== "string") continue;
    if (!f.url.startsWith("/media/")) continue;
    const size = Number.isFinite(f.size) ? f.size : 0;
    const mtimeMs = Number.isFinite(f.mtimeMs) ? Math.floor(f.mtimeMs) : 0;
    digest.update(`${f.url}|${size}|${mtimeMs}\n`);
  }
  return digest.digest("hex").slice(0, 16);
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "").trim());
  const cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  return cleaned || `upload_${Date.now()}`;
}

function parseMultipartParts(buffer, boundary) {
  const token = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(token);
  while (start !== -1) {
    start += token.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const next = buffer.indexOf(token, start);
    if (next === -1) break;
    let end = next;
    if (buffer[end - 2] === 13 && buffer[end - 1] === 10) end -= 2;
    parts.push(buffer.slice(start, end));
    start = next;
  }
  return parts;
}

function parseContentDisposition(value) {
  const out = { name: "", filename: "" };
  if (!value) return out;
  const n = value.match(/name="([^"]+)"/i);
  const f = value.match(/filename="([^"]*)"/i);
  if (n) out.name = n[1];
  if (f) out.filename = f[1];
  return out;
}

function encodePathForUrl(relPath) {
  return String(relPath || "")
    .split(/[\\/]+/)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function runWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (idx < items.length) {
      const current = idx;
      idx += 1;
      out[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return out;
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
  const THUMB_CACHE_DIR = path.resolve(PROJECT_ROOT, ".thumb-cache");
  const LIVE_TEMP_DIR = path.resolve(PROJECT_ROOT, ".temp_livephotos");
  const LIVE_SNAPSHOT_DIR = path.resolve(LIVE_TEMP_DIR, "snapshots");
  const LIVE_WEB_DIR = path.resolve(LIVE_TEMP_DIR, "web");
  const WATCH_DEBOUNCE_MS = Number(
    process.env.WATCH_DEBOUNCE_MS || cfg.watchDebounceMs,
  );
  const FILESYSTEM_REFRESH_MS = Number(
    process.env.FILESYSTEM_REFRESH_MS || cfg.filesystemRefreshMs || 15000,
  );
  const AUTOINDEX_REFRESH_MS = Number(
    process.env.AUTOINDEX_REFRESH_MS || cfg.autoindexRefreshMs || 20000,
  );
  const MAX_UPLOAD_BYTES = Number(
    process.env.MAX_UPLOAD_BYTES || cfg.maxUploadBytes || 300 * 1024 * 1024,
  );
  const FAST_INDEX_MODE = toBool(
    process.env.FAST_INDEX_MODE ?? cfg.fastIndexMode,
    false,
  );
  const DETECT_LIVE_PHOTOS = toBool(
    process.env.DETECT_LIVE_PHOTOS ?? cfg.detectLivePhotos,
    true,
  );
  const DEBUG = toBool(process.env.DEBUG ?? cfg.debug, false);
  const API_TOKEN = String(process.env.API_TOKEN || cfg.apiToken || "").trim();
  const CLIENT_HTTP_ENABLED = toBool(
    process.env.CLIENT_HTTP_ENABLED ?? cfg.clientHttpEnabled,
    true,
  );
  const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const RATE_LIMIT_MAX_MUTATIONS = Number(
    process.env.RATE_LIMIT_MAX_MUTATIONS || 90,
  );
  const rateLimitByIp = new Map();
  const metrics = {
    requestsTotal: 0,
    mutationDeniedAuth: 0,
    mutationDeniedRate: 0,
    scansStarted: 0,
    scansCompleted: 0,
    scansFailed: 0,
  };
  const forcedReindexPartitions = new Set();
  const scheduler = createTaskScheduler({
    ffprobe: Number(process.env.MAX_FFPROBE_JOBS || 2),
    thumb: Number(process.env.MAX_FFMPEG_THUMB_JOBS || 2),
    transcode: Number(process.env.MAX_FFMPEG_TRANSCODE_JOBS || 1),
  });

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

  function getClientIp(req) {
    const xfwd = String(req.headers["x-forwarded-for"] || "").trim();
    if (xfwd) return xfwd.split(",")[0].trim();
    const xreal = String(req.headers["x-real-ip"] || "").trim();
    if (xreal) return xreal;
    return String(req.socket?.remoteAddress || "unknown");
  }

  function isMutationPath(pathname, method) {
    if (method !== "POST") return false;
    return (
      pathname === "/api/config" ||
      pathname === "/api/cache-cleanup" ||
      pathname === "/api/upload-media" ||
      pathname === "/api/delete-media" ||
      pathname === "/api/reindex-partition"
    );
  }

  function checkRateLimit(ip) {
    const now = Date.now();
    const row = rateLimitByIp.get(ip) || { windowStart: now, count: 0 };
    if (now - row.windowStart >= RATE_LIMIT_WINDOW_MS) {
      row.windowStart = now;
      row.count = 0;
    }
    row.count += 1;
    rateLimitByIp.set(ip, row);
    return row.count <= RATE_LIMIT_MAX_MUTATIONS;
  }

  function checkAuth(req) {
    if (!API_TOKEN) return true;
    const got =
      String(req.headers["x-api-token"] || "").trim() ||
      String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    return got && got === API_TOKEN;
  }

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
        if (Number.isNaN(start) || Number.isNaN(end) || start < 0) {
          log(
            `RANGE 416 invalid-numeric start=${start} end=${end} total=${total} path=${absolutePath}`,
          );
          res.writeHead(416, { "Content-Range": `bytes */${total}` });
          return res.end();
        }
        if (start >= total) {
          log(
            `RANGE 416 unsat start=${start} end=${end} total=${total} path=${absolutePath}`,
          );
          res.writeHead(416, { "Content-Range": `bytes */${total}` });
          return res.end();
        }
        if (end < start) {
          log(
            `RANGE 416 invalid-order start=${start} end=${end} total=${total} path=${absolutePath}`,
          );
          res.writeHead(416, { "Content-Range": `bytes */${total}` });
          return res.end();
        }
        // Be tolerant with client prefetch ranges (e.g. bytes=0-65535 on small files).
        if (end >= total) end = total - 1;
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
    execFfprobe: (args, dedupeKey = "") =>
      scheduler.enqueue(
        "ffprobe",
        () =>
          new Promise((resolve, reject) => {
            const child = spawn("ffprobe", args, {
              stdio: ["ignore", "pipe", "pipe"],
            });
            let out = "";
            let stderr = "";
            child.stdout.on("data", (d) => {
              out += String(d || "");
            });
            child.stderr.on("data", (d) => {
              stderr += String(d || "");
            });
            child.on("error", reject);
            child.on("close", (code) => {
              if (code === 0) resolve(out);
              else reject(new Error(stderr.trim() || `ffprobe exit ${code}`));
            });
          }),
        dedupeKey,
      ),
    execFfmpegTranscode: (args, dedupeKey = "") =>
      scheduler.enqueue(
        "transcode",
        () =>
          new Promise((resolve, reject) => {
            const child = spawn("ffmpeg", args, {
              stdio: ["ignore", "ignore", "pipe"],
            });
            let stderr = "";
            child.stderr.on("data", (d) => {
              stderr += String(d || "");
            });
            child.on("error", reject);
            child.on("close", (code) => {
              if (code === 0) resolve("");
              else reject(new Error(stderr.trim() || `ffmpeg exit ${code}`));
            });
          }),
        dedupeKey,
      ),
  });
  const thumbHandler = createThumbHandler({
    fs,
    path,
    crypto,
    createReadStream,
    mediaRoots: MEDIA_ROOTS,
    thumbCacheDir: THUMB_CACHE_DIR,
    log,
    execFfmpegThumb: (args, dedupeKey = "") =>
      scheduler.enqueue(
        "thumb",
        () =>
          new Promise((resolve, reject) => {
            const child = spawn("ffmpeg", args, {
              stdio: ["ignore", "ignore", "pipe"],
            });
            let stderr = "";
            child.stderr.on("data", (d) => {
              stderr += String(d || "");
            });
            child.on("error", reject);
            child.on("close", (code) => {
              if (code === 0) resolve("");
              else reject(new Error(stderr.trim() || `ffmpeg exit ${code}`));
            });
          }),
        dedupeKey,
      ),
  });
  const clientHttp = createClientHttpModule({
    fs,
    path,
    clientHttpDir: CLIENT_HTTP_DIR,
    enabled: CLIENT_HTTP_ENABLED,
    serveFile,
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
      state.partitions =
        parsed.partitions && typeof parsed.partitions === "object"
          ? parsed.partitions
          : {};
      state.fsQuickFingerprint = buildFilesystemFingerprintFromIndex(parsed.files);
      log(
        `Loaded persisted index version=${state.version || "n/a"} count=${state.count} fsQuick=${state.fsQuickFingerprint || "n/a"}`,
      );
      return true;
    } catch {
      log("No persisted index available");
      return false;
    }
  }

  const buildIndexPayload = buildIndexPayloadFactory({
    fs,
    path,
    mediaRoots: MEDIA_ROOTS,
    autoindexRootUrls: AUTOINDEX_ROOT_URLS,
    sourceMode: SOURCE_MODE,
    crypto,
    thumbCacheDir: THUMB_CACHE_DIR,
    log,
    detectLivePhotoFilesystem: liveService.detectLivePhotoFilesystem,
    fastIndexMode: FAST_INDEX_MODE,
    detectLivePhotos: DETECT_LIVE_PHOTOS,
    getPreviousIndex: () => ({
      files: Array.isArray(state.files) ? state.files : [],
      partitions:
        state.partitions && typeof state.partitions === "object"
          ? state.partitions
          : {},
    }),
    getForcedPartitions: () => Array.from(forcedReindexPartitions),
  });

  async function buildFilesystemQuickFingerprint() {
    if (!(SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed")) return null;
    const digest = crypto.createHash("sha1");
    for (let rootIdx = 0; rootIdx < MEDIA_ROOTS.length; rootIdx += 1) {
      const mediaRoot = MEDIA_ROOTS[rootIdx];
      const stack = [mediaRoot];
      while (stack.length) {
        const currentDir = stack.pop();
        let entries = [];
        try {
          entries = await fs.readdir(currentDir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          if (
            entry.isDirectory() &&
            [".thumb-cache", ".temp_livephotos"].includes(entry.name)
          ) {
            continue;
          }
          const full = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (!entry.isFile()) continue;
          const rel = toPosix(path.relative(mediaRoot, full));
          if (!detectType(rel)) continue;
          try {
            const st = await fs.stat(full);
            digest.update(
              `${rootIdx}/${rel}|${st.size}|${Math.floor(st.mtimeMs)}\n`,
            );
          } catch {}
        }
      }
    }
    return digest.digest("hex").slice(0, 16);
  }

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
    const scanT0 = Date.now();
    metrics.scansStarted += 1;
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
        state.partitions =
          payload.partitions && typeof payload.partitions === "object"
            ? payload.partitions
            : {};
        state.fsQuickFingerprint = buildFilesystemFingerprintFromIndex(
          payload.files,
        );
        log(
          `Scan state=ready refreshing=false count=${state.count} version=${state.version} fsQuick=${state.fsQuickFingerprint || "n/a"}`,
        );
        state.lastScanDurationMs = Date.now() - scanT0;
        state.lastScanAt = nowIso();
        metrics.scansCompleted += 1;
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
        state.lastScanDurationMs = Date.now() - scanT0;
        state.lastScanAt = nowIso();
        metrics.scansFailed += 1;
        throw err;
      } finally {
        forcedReindexPartitions.clear();
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

  async function triggerScanIfFilesystemChanged(reason = "periodic") {
    if (!(SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed")) return;
    if (state.scanPromise) return;
    const quick = await buildFilesystemQuickFingerprint().catch(() => null);
    if (!quick) {
      triggerScanDebounced();
      return;
    }
    if (!state.fsQuickFingerprint) {
      state.fsQuickFingerprint = quick;
      log(`FS quick baseline=${quick} reason=${reason}`);
      return;
    }
    if (quick !== state.fsQuickFingerprint) {
      log(
        `FS quick changed old=${state.fsQuickFingerprint} new=${quick} reason=${reason}`,
      );
      state.fsQuickFingerprint = quick;
      triggerScanDebounced();
      return;
    }
    log(`FS quick unchanged=${quick} reason=${reason}`);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    metrics.requestsTotal += 1;
    log(`HTTP ${req.method} ${pathname}`);

    if (isMutationPath(pathname, req.method)) {
      const ip = getClientIp(req);
      if (!checkAuth(req)) {
        metrics.mutationDeniedAuth += 1;
        return json(res, 401, { error: "Unauthorized" });
      }
      if (!checkRateLimit(ip)) {
        metrics.mutationDeniedRate += 1;
        return json(res, 429, { error: "Too many requests" });
      }
    }

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

    if (pathname === "/api/media-index-lite") {
      if (state.status === "ready") {
        const files = state.files.map((f) => ({
          id: f.id || null,
          url: f.url,
          name: f.name,
          type: f.type,
          date: f.date,
          dateGroup: typeof f.dateGroup === "string" ? f.dateGroup : "",
          folderGroup: typeof f.folderGroup === "string" ? f.folderGroup : "",
          width: Number.isFinite(f.width) ? f.width : null,
          height: Number.isFinite(f.height) ? f.height : null,
          thumb128Url: typeof f.thumb128Url === "string" ? f.thumb128Url : "",
          thumb512Url: typeof f.thumb512Url === "string" ? f.thumb512Url : "",
          thumbUrl: typeof f.thumbUrl === "string" ? f.thumbUrl : "",
          entryId: f.entryId,
          entryLabel: f.entryLabel,
          size: Number.isFinite(f.size) ? f.size : 0,
          mtimeMs: Number.isFinite(f.mtimeMs) ? f.mtimeMs : 0,
          livePhoto: f.livePhoto || null,
        }));
        return json(res, 200, {
          status: "ready",
          refreshing: state.refreshing,
          version: state.version,
          generatedAt: state.generatedAt,
          count: files.length,
          files,
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
        forcedPartitionsPending: forcedReindexPartitions.size,
      });
    }

    if (pathname === "/api/partitions") {
      if (req.method !== "GET") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      const rows = Object.entries(state.partitions || {}).map(([key, meta]) => ({
        key,
        count: Number(meta?.count) || 0,
        fingerprint: String(meta?.fingerprint || ""),
      }));
      rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
      return json(res, 200, {
        ok: true,
        count: rows.length,
        partitions: rows,
      });
    }

    if (pathname === "/api/metrics") {
      if (req.method !== "GET") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      return json(res, 200, {
        ok: true,
        metrics: {
          ...metrics,
          rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
          rateLimitMaxMutations: RATE_LIMIT_MAX_MUTATIONS,
          rateLimitTrackedIps: rateLimitByIp.size,
          scan: {
            lastScanDurationMs: state.lastScanDurationMs,
            lastScanAt: state.lastScanAt,
            status: state.status,
            refreshing: state.refreshing,
            count: state.count,
            version: state.version,
          },
          scheduler: scheduler.snapshot(),
        },
      });
    }

    if (pathname === "/api/config") {
      if (req.method === "GET") {
        const liveCfg = await readConfig();
        const liveLists = normalizeSourceLists(liveCfg);
        return json(res, 200, {
          sourceMode: String(liveCfg.sourceMode || SOURCE_MODE).toLowerCase(),
          clientHttpEnabled: toBool(
            liveCfg.clientHttpEnabled ?? CLIENT_HTTP_ENABLED,
            true,
          ),
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
            clientHttpEnabled: toBool(
              payload.clientHttpEnabled ?? baseCfg.clientHttpEnabled,
              true,
            ),
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

    if (pathname === "/api/reindex-partition") {
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        const directKeys = Array.isArray(payload.partitionKeys)
          ? payload.partitionKeys.map((x) => String(x || "").trim()).filter(Boolean)
          : [];
        const rootIdx = Number(payload.rootIdx);
        const hasRootIdx = Number.isInteger(rootIdx) && rootIdx >= 0;
        const folderGroup = String(payload.folderGroup || "").trim();
        const month = String(payload.month || "").trim();
        const shouldMatch =
          hasRootIdx || folderGroup.length > 0 || month.length > 0;
        const matched = [];
        if (shouldMatch) {
          for (const key of Object.keys(state.partitions || {})) {
            const m = key.match(/^fs:(\d+):(.*):(\d{4}-\d{2}|0000-00)$/);
            if (!m) continue;
            const kRoot = Number(m[1]);
            const kFolder = m[2];
            const kMonth = m[3];
            if (hasRootIdx && kRoot !== rootIdx) continue;
            if (folderGroup && kFolder !== folderGroup) continue;
            if (month && kMonth !== month) continue;
            matched.push(key);
          }
        }
        const finalKeys = [...new Set([...directKeys, ...matched])];
        if (finalKeys.length === 0) {
          return json(res, 400, {
            error: "No se encontraron particiones para reindexar",
          });
        }
        for (const k of finalKeys) forcedReindexPartitions.add(k);
        triggerScanDebounced();
        ensureScan().catch(() => {});
        return json(res, 200, {
          ok: true,
          forced: finalKeys.length,
          partitionKeys: finalKeys,
          indexing: true,
        });
      } catch (err) {
        return json(res, 400, {
          error: err.message || "payload inválido",
        });
      }
    }

    if (pathname === "/api/upload-media") {
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      if (!(SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed")) {
        return json(res, 400, {
          error: "Subida disponible solo en sourceMode filesystem/mixed",
        });
      }
      const contentType = String(req.headers["content-type"] || "");
      const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
      if (!boundaryMatch) {
        return json(res, 400, { error: "multipart/form-data requerido" });
      }
      const boundary = boundaryMatch[1];
      const targetRootIdxRaw = Number(url.searchParams.get("root") || 0);
      const targetRootIdx = Number.isInteger(targetRootIdxRaw)
        ? targetRootIdxRaw
        : 0;
      const mediaRoot = MEDIA_ROOTS[targetRootIdx];
      if (!mediaRoot) {
        return json(res, 400, { error: "Media root inválido" });
      }
      const uploadDir = path.resolve(mediaRoot, "Uploads");
      if (!uploadDir.startsWith(mediaRoot)) {
        return json(res, 403, { error: "Destino inválido" });
      }
      try {
        await fs.mkdir(uploadDir, { recursive: true });
      } catch (err) {
        return json(res, 500, {
          error: `No se pudo crear carpeta destino (${err.message})`,
        });
      }
      const chunks = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > MAX_UPLOAD_BYTES) {
          return json(res, 413, {
            error: `Payload demasiado grande. Límite: ${MAX_UPLOAD_BYTES} bytes`,
          });
        }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const parts = parseMultipartParts(body, boundary);
      const saved = [];
      for (const part of parts) {
        const sep = part.indexOf(Buffer.from("\r\n\r\n"));
        if (sep < 0) continue;
        const headerRaw = part.slice(0, sep).toString("utf8");
        const content = part.slice(sep + 4);
        const headers = headerRaw.split("\r\n");
        const cdLine = headers.find((h) =>
          h.toLowerCase().startsWith("content-disposition:"),
        );
        const cd = parseContentDisposition(cdLine || "");
        if (!cd.filename || !content.length) continue;
        const safeName = sanitizeFilename(cd.filename);
        let outPath = path.resolve(uploadDir, safeName);
        if (!outPath.startsWith(uploadDir)) continue;
        const ext = path.extname(safeName);
        const stem = path.basename(safeName, ext);
        let i = 1;
        while (await pathExists(outPath)) {
          outPath = path.resolve(uploadDir, `${stem}_${i}${ext}`);
          i += 1;
        }
        await fs.writeFile(outPath, content);
        const rel = outPath.slice(mediaRoot.length).replace(/^[\\/]+/, "");
        saved.push({
          name: path.basename(outPath),
          url: `/media/${targetRootIdx}/${encodePathForUrl(rel)}`,
          bytes: content.length,
        });
      }
      if (saved.length === 0) {
        return json(res, 400, { error: "No se recibieron archivos" });
      }
      triggerScanDebounced();
      ensureScan().catch(() => {});
      return json(res, 200, {
        ok: true,
        uploaded: saved.length,
        files: saved,
        indexing: true,
      });
    }

    if (pathname === "/api/delete-media") {
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end("Method not allowed");
      }
      if (!(SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed")) {
        return json(res, 400, {
          error: "Borrado disponible solo en sourceMode filesystem/mixed",
        });
      }
      try {
        let body = "";
        for await (const chunk of req) body += chunk;
        const payload = JSON.parse(body || "{}");
        const urls = Array.isArray(payload?.urls) ? payload.urls : [];
        if (!urls.length) return json(res, 400, { error: "Sin urls para borrar" });
        const results = await runWithConcurrency(urls, 8, async (rawUrl) => {
          const src = String(rawUrl || "");
          if (!src.startsWith("/media/")) {
            return { ok: false, url: src, reason: "unsupported-url" };
          }
          const relAll = src.slice("/media/".length);
          const slash = relAll.indexOf("/");
          if (slash < 1) {
            return { ok: false, url: src, reason: "bad-media-path" };
          }
          const rootIdx = Number(relAll.slice(0, slash));
          const rel = relAll.slice(slash + 1);
          const mediaRoot = MEDIA_ROOTS[rootIdx];
          if (!mediaRoot) {
            return { ok: false, url: src, reason: "media-root-not-found" };
          }
          const abs = path.resolve(mediaRoot, rel);
          if (!abs.startsWith(mediaRoot)) {
            return { ok: false, url: src, reason: "forbidden" };
          }
          try {
            await fs.unlink(abs);
            return { ok: true, url: src };
          } catch (err) {
            return {
              ok: false,
              url: src,
              reason: err?.code || err?.message || "delete-failed",
            };
          }
        });
        const deleted = results.filter((r) => r?.ok).map((r) => r.url);
        const failed = results
          .filter((r) => r && !r.ok)
          .map((r) => ({ url: r.url, reason: r.reason }));
        if (deleted.length > 0) {
          triggerScanDebounced();
          ensureScan().catch(() => {});
        }
        return json(res, 200, {
          ok: failed.length === 0,
          deleted,
          failed,
          indexing: deleted.length > 0,
        });
      } catch (err) {
        return json(res, 400, { error: err.message || "delete payload inválido" });
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
      return thumbHandler.handleVideo(req, res, url);
    }
    if (pathname === "/thumb/image") {
      return thumbHandler.handleImage(req, res, url);
    }
    if (pathname === "/thumb/web-image") {
      if (typeof thumbHandler.handleWebImage === "function") {
        return thumbHandler.handleWebImage(req, res, url);
      }
      return thumbHandler.handleImage(req, res, url);
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

    if (await clientHttp.handle(req, res, pathname)) {
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  await loadPersistedIndex();
  ensureScan().catch(() => {});
  if (SOURCE_MODE === "filesystem" || SOURCE_MODE === "mixed") {
    for (const mediaRoot of MEDIA_ROOTS) {
      try {
        fs.watch(mediaRoot, { recursive: true }, () => {
          triggerScanIfFilesystemChanged("fs-watch").catch(() => {});
        });
        log(`Watching filesystem path=${mediaRoot}`);
      } catch {
        // Keep service running even if recursive watch is not supported.
        log(`fs.watch recursive not available for ${mediaRoot}`);
      }
    }
    if (FILESYSTEM_REFRESH_MS > 0) {
      log(`Filesystem periodic refresh everyMs=${FILESYSTEM_REFRESH_MS}`);
      setInterval(
        () => triggerScanIfFilesystemChanged("filesystem-periodic").catch(() => {}),
        FILESYSTEM_REFRESH_MS,
      );
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

function resolveWorkerCount() {
  const fromEnv = Number(process.env.CLUSTER_WORKERS || 0);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  const cpuCount = Array.isArray(os.cpus()) ? os.cpus().length : 1;
  return Math.max(1, cpuCount - 1);
}

function shouldUseCluster() {
  const argOn = process.argv.includes("--cluster");
  const envOn = String(process.env.ENABLE_CLUSTER || "").toLowerCase() === "true";
  return argOn || envOn;
}

async function start() {
  if (!shouldUseCluster()) {
    return boot();
  }
  const workers = resolveWorkerCount();
  if (workers <= 1) {
    return boot();
  }
  if (cluster.isPrimary) {
    process.stdout.write(
      `Cluster mode ON. Primary=${process.pid} workers=${workers}\n`,
    );
    for (let i = 0; i < workers; i += 1) cluster.fork();
    cluster.on("exit", (worker, code, signal) => {
      process.stderr.write(
        `Worker ${worker.process.pid} exited (code=${code} signal=${signal || "n/a"}). Restarting...\n`,
      );
      cluster.fork();
    });
    return;
  }
  return boot();
}

start().catch((err) => {
  process.stderr.write(`Failed to boot: ${err.message}\n`);
  process.exit(1);
});
