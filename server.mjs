#!/usr/bin/env node
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const ROOT_DIR = path.resolve('.');
const CONFIG_FILE = path.resolve(ROOT_DIR, 'config.json');

const defaults = {
  host: '127.0.0.1',
  port: 3000,
  sourceMode: 'filesystem',
  mediaRoot: './takeout-20260520T011015Z-3-001',
  autoindexRootUrl: 'http://127.0.0.1:8080/takeout-20260520T011015Z-3-001/',
  mediaIndexFile: './media-index.json',
  watchDebounceMs: 1200,
  autoindexRefreshMs: 20000,
  debug: false
};

const IMG = /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/i;
const VID = /\.(mp4|webm|mov|mkv|avi|3gp)$/i;
const AUD = /\.(mp3|m4a|wav|ogg|flac)$/i;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac'
};

const state = {
  status: 'idle',
  version: null,
  generatedAt: null,
  count: 0,
  files: [],
  lastError: null,
  scanPromise: null,
  watchTimer: null
};

function detectType(name) {
  if (IMG.test(name)) return 'image';
  if (VID.test(name)) return 'video';
  if (AUD.test(name)) return 'audio';
  return null;
}

function guessDateDetailed(name, relPath) {
  const text = decodeURIComponent(`${name} ${relPath}`);
  let m = text.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) {
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return { date: `${m[1]}-${m[2]}-${m[3]}`, patched: false };
    }
  }
  m = text.match(/(20\d{2})/);
  if (m) return { date: `${m[1]}-XX-XX`, patched: true };
  return { date: '0000-sin-fecha', patched: true };
}

function guessDate(name, relPath) {
  return guessDateDetailed(name, relPath).date;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function parseAutoindexLinks(html) {
  const links = [];
  const rx = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m = null;
  while ((m = rx.exec(html)) !== null) links.push(m[1]);
  return links;
}

function toFileNameFromUrl(u) {
  try {
    const p = new URL(u).pathname;
    const n = p.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(n);
  } catch {
    return '';
  }
}

async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
  return out;
}

function json(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function nowIso() {
  return new Date().toISOString();
}

async function boot() {
  const cfg = await readConfig();
  const HOST = process.env.HOST || cfg.host;
  const PORT = Number(process.env.PORT || cfg.port);
  const SOURCE_MODE = String(process.env.SOURCE_MODE || cfg.sourceMode || 'filesystem').toLowerCase();
  const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || cfg.mediaRoot);
  const AUTOINDEX_ROOT_URL = String(process.env.AUTOINDEX_ROOT_URL || cfg.autoindexRootUrl || '');
  const INDEX_FILE = path.resolve(process.env.MEDIA_INDEX_FILE || cfg.mediaIndexFile);
  const INDEX_TMP = `${INDEX_FILE}.tmp`;
  const WATCH_DEBOUNCE_MS = Number(process.env.WATCH_DEBOUNCE_MS || cfg.watchDebounceMs);
  const AUTOINDEX_REFRESH_MS = Number(process.env.AUTOINDEX_REFRESH_MS || cfg.autoindexRefreshMs || 20000);
  const DEBUG = String(process.env.DEBUG ?? cfg.debug).toLowerCase() === 'true';

  const log = (...args) => {
    if (!DEBUG) return;
    process.stdout.write(`[DEBUG ${nowIso()}] ${args.join(' ')}\n`);
  };

  if (!['filesystem', 'autoindex'].includes(SOURCE_MODE)) {
    throw new Error(`sourceMode inválido: ${SOURCE_MODE}. Usa "filesystem" o "autoindex".`);
  }
  if (SOURCE_MODE === 'autoindex' && !AUTOINDEX_ROOT_URL) {
    throw new Error('autoindexRootUrl es requerido cuando sourceMode="autoindex".');
  }
  if (SOURCE_MODE === 'filesystem') {
    try {
      const st = await fs.stat(MEDIA_ROOT);
      if (!st.isDirectory()) throw new Error('mediaRoot existe pero no es directorio');
    } catch (err) {
      throw new Error(`mediaRoot inválido/no accesible: ${MEDIA_ROOT} (${err.message})`);
    }
  } else {
    let parsed = null;
    try {
      parsed = new URL(AUTOINDEX_ROOT_URL);
    } catch (err) {
      throw new Error(`autoindexRootUrl inválido: ${AUTOINDEX_ROOT_URL} (${err.message})`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`autoindexRootUrl debe ser http/https: ${AUTOINDEX_ROOT_URL}`);
    }
    const probe = await fetch(parsed.href, { method: 'GET', cache: 'no-store' });
    if (!probe.ok) {
      throw new Error(`autoindexRootUrl no accesible: HTTP ${probe.status} ${parsed.href}`);
    }
  }
  try {
    await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
  } catch (err) {
    throw new Error(`No se puede crear/acceder directorio de índice: ${path.dirname(INDEX_FILE)} (${err.message})`);
  }
  log(`Boot config sourceMode=${SOURCE_MODE} host=${HOST} port=${PORT}`);

  async function serveFile(req, res, absolutePath) {
    try {
      const t0 = Date.now();
      const st = await fs.stat(absolutePath);
      if (!st.isFile()) throw new Error('not file');
      const ext = path.extname(absolutePath).toLowerCase();
      const mimeType = contentTypes[ext] || 'application/octet-stream';
      const total = st.size;
      const range = req.headers.range;
      const isMedia = absolutePath.startsWith(MEDIA_ROOT);

      if (isMedia && range) {
        const m = String(range).match(/^bytes=(\d*)-(\d*)$/i);
        if (!m) {
          log(`RANGE 416 invalid-range path=${absolutePath}`);
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          return res.end();
        }
        let start = m[1] === '' ? 0 : Number(m[1]);
        let end = m[2] === '' ? total - 1 : Number(m[2]);
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= total) {
          log(`RANGE 416 unsat start=${start} end=${end} total=${total} path=${absolutePath}`);
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          return res.end();
        }
        const chunkSize = end - start + 1;
        log(`RANGE 206 mime=${mimeType} start=${start} end=${end} total=${total} path=${absolutePath}`);
        res.writeHead(206, {
          'Content-Type': mimeType,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize
        });
        const rs = createReadStream(absolutePath, { start, end, highWaterMark: 256 * 1024 });
        rs.on('open', () => log(`RANGE 206 open-latency-ms=${Date.now() - t0} bytes=${chunkSize} path=${absolutePath}`));
        return rs.pipe(res);
      }

      log(`RANGE 200 mime=${mimeType} total=${total} path=${absolutePath} range=${range ? 'present' : 'none'}`);
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': total,
        'Accept-Ranges': 'bytes'
      });
      const rs = createReadStream(absolutePath, { highWaterMark: 256 * 1024 });
      rs.on('open', () => log(`RANGE 200 open-latency-ms=${Date.now() - t0} bytes=${total} path=${absolutePath}`));
      return rs.pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  async function persistIndex(payload) {
    log(`Persisting index temp=${INDEX_TMP} final=${INDEX_FILE} count=${payload.count} version=${payload.version}`);
    await fs.writeFile(INDEX_TMP, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.rename(INDEX_TMP, INDEX_FILE);
  }

  async function loadPersistedIndex() {
    try {
      const raw = await fs.readFile(INDEX_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.files)) return false;
      state.status = 'ready';
      state.version = parsed.version || null;
      state.generatedAt = parsed.generatedAt || null;
      state.count = parsed.count || parsed.files.length;
      state.files = parsed.files;
      log(`Loaded persisted index version=${state.version || 'n/a'} count=${state.count}`);
      return true;
    } catch {
      log('No persisted index available');
      return false;
    }
  }

  async function buildFilesystemIndex() {
    const absFiles = await walk(MEDIA_ROOT);
    const files = [];
    for (const abs of absFiles) {
      const rel = toPosix(path.relative(MEDIA_ROOT, abs));
      const type = detectType(rel);
      if (!type) continue;
      const st = await fs.stat(abs);
      const name = decodeURIComponent(path.basename(rel));
      const dateInfo = guessDateDetailed(name, rel);
      files.push({
        url: `/media/${rel}`,
        name,
        type,
        date: dateInfo.date,
        datePatched: dateInfo.patched,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs)
      });
    }
    return files;
  }

  async function buildAutoindexIndex() {
    const root = new URL(AUTOINDEX_ROOT_URL);
    const queue = [root.href];
    const visited = new Set();
    const files = [];

    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const res = await fetch(current, { cache: 'no-store' });
      if (!res.ok) {
        log(`Autoindex fetch skip url=${current} status=${res.status}`);
        continue;
      }
      const html = await res.text();
      const links = parseAutoindexLinks(html);

      for (const href of links) {
        if (!href || href.startsWith('?') || href === '../') continue;
        const url = new URL(href, current);
        if (url.origin !== root.origin) continue;
        if (!url.pathname.startsWith(root.pathname)) continue;

        if (href.endsWith('/')) {
          queue.push(url.href);
          continue;
        }

        const type = detectType(url.pathname);
        if (!type) continue;
        const name = toFileNameFromUrl(url.href);
        const dateInfo = guessDateDetailed(name, url.pathname);
        files.push({
          url: url.href,
          name,
          type,
          date: dateInfo.date,
          datePatched: dateInfo.patched,
          size: 0,
          mtimeMs: 0
        });
      }
    }
    return files;
  }

  async function buildIndexPayload() {
    log(`Index build start mode=${SOURCE_MODE}`);
    const files = SOURCE_MODE === 'filesystem'
      ? await buildFilesystemIndex()
      : await buildAutoindexIndex();
    files.sort((a, b) => a.url.localeCompare(b.url));
    const version = crypto.createHash('sha1').update(JSON.stringify(files)).digest('hex').slice(0, 12);
    log(`Index build done mode=${SOURCE_MODE} count=${files.length} version=${version}`);
    return { status: 'ready', version, generatedAt: new Date().toISOString(), count: files.length, files };
  }

  async function ensureScan() {
    if (state.scanPromise) return state.scanPromise;
    state.status = 'indexing';
    state.lastError = null;
    log('Scan state=indexing');
    state.scanPromise = (async () => {
      try {
        const payload = await buildIndexPayload();
        await persistIndex(payload);
        state.status = 'ready';
        state.version = payload.version;
        state.generatedAt = payload.generatedAt;
        state.count = payload.count;
        state.files = payload.files;
        log(`Scan state=ready count=${state.count} version=${state.version}`);
        return payload;
      } catch (err) {
        state.status = 'error';
        state.lastError = err.message;
        log(`Scan state=error message=${err.message}`);
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
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);
    log(`HTTP ${req.method} ${pathname}`);

    if (pathname === '/api/media-index') {
      if (state.status === 'ready') {
        return json(res, 200, {
          status: 'ready',
          version: state.version,
          generatedAt: state.generatedAt,
          count: state.count,
          files: state.files
        });
      }
      if (state.status === 'error') {
        return json(res, 500, { status: 'error', message: state.lastError || 'Index error' });
      }
      ensureScan().catch(() => {});
      return json(res, 202, {
        status: 'indexing',
        version: state.version,
        generatedAt: state.generatedAt,
        count: state.count
      });
    }

    if (pathname === '/api/index-status') {
      return json(res, 200, {
        status: state.status,
        version: state.version,
        generatedAt: state.generatedAt,
        count: state.count,
        lastError: state.lastError
      });
    }

    if (SOURCE_MODE === 'filesystem' && pathname.startsWith('/media/')) {
      const rel = pathname.slice('/media/'.length);
      const abs = path.resolve(MEDIA_ROOT, rel);
      if (!abs.startsWith(MEDIA_ROOT)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      return serveFile(req, res, abs);
    }

    if (pathname.startsWith('/js/')) {
      return serveFile(req, res, path.resolve(ROOT_DIR, `.${pathname}`));
    }

    if (pathname === '/' || pathname === '/index.html') {
      return serveFile(req, res, path.resolve(ROOT_DIR, 'index.html'));
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await loadPersistedIndex();
  ensureScan().catch(() => {});
  if (SOURCE_MODE === 'filesystem') {
    try {
      fs.watch(MEDIA_ROOT, { recursive: true }, () => triggerScanDebounced());
      log(`Watching filesystem path=${MEDIA_ROOT}`);
    } catch {
      // Keep service running even if recursive watch is not supported.
      log('fs.watch recursive not available');
    }
  } else {
    log(`Autoindex periodic refresh everyMs=${AUTOINDEX_REFRESH_MS}`);
    setInterval(() => triggerScanDebounced(), AUTOINDEX_REFRESH_MS);
  }

  server.listen(PORT, HOST, () => {
    process.stdout.write(`Server running at http://${HOST}:${PORT}\n`);
    process.stdout.write(`Source mode: ${SOURCE_MODE}\n`);
    if (SOURCE_MODE === 'filesystem') process.stdout.write(`Media root: ${MEDIA_ROOT}\n`);
    if (SOURCE_MODE === 'autoindex') process.stdout.write(`Autoindex root: ${AUTOINDEX_ROOT_URL}\n`);
    process.stdout.write(`Config file: ${CONFIG_FILE}\n`);
    process.stdout.write(`Debug: ${DEBUG ? 'ON' : 'OFF'}\n`);
  });
}

boot().catch(err => {
  process.stderr.write(`Failed to boot: ${err.message}\n`);
  process.exit(1);
});
