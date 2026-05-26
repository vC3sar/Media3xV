import { URL } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  detectType,
  dedupeFilesByUrl,
  dedupeMixedImagesByFingerprint,
  entryLabelFromAutoindexRoot,
  entryLabelFromFilesystemRoot,
  guessDateDetailed,
  parseAutoindexLinks,
  toFileNameFromUrl,
  toPosix,
} from "../../shared/media-utils.mjs";

async function walk(fs, dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && [".thumb-cache", ".temp_livephotos"].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fs, full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
  return out;
}

async function runCommand(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d || "");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exit ${code}`));
    });
  });
}

async function runCommandCapture(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d || "");
    });
    child.stderr.on("data", (d) => {
      stderr += String(d || "");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exit ${code}`));
    });
  });
}

async function probeDimensions(absInput) {
  try {
    const raw = await runCommandCapture("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      absInput,
    ]);
    const parsed = JSON.parse(raw || "{}");
    const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : null;
    const width = Number(stream?.width) || 0;
    const height = Number(stream?.height) || 0;
    if (!width || !height) return { width: null, height: null };
    return { width, height };
  } catch {
    return { width: null, height: null };
  }
}

function normalizeDateFromText(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  let m = text.match(/(20\d{2})[:\-\/](\d{2})[:\-\/](\d{2})/);
  if (m) {
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  m = text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (m) {
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  return null;
}

async function probeImageExifDateFallback(absInput) {
  try {
    const raw = await runCommandCapture("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_entries",
      "format_tags=creation_time,com.apple.quicktime.creationdate,DateTimeOriginal,DateTimeDigitized,DateTime",
      absInput,
    ]);
    const parsed = JSON.parse(raw || "{}");
    const tags = parsed?.format?.tags || {};
    const candidates = [
      tags.DateTimeOriginal,
      tags.DateTimeDigitized,
      tags.DateTime,
      tags.creation_time,
      tags["com.apple.quicktime.creationdate"],
    ];
    for (const c of candidates) {
      const normalized = normalizeDateFromText(c);
      if (normalized) return normalized;
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureImageThumbFilesystem(ctx, mediaSrc, mtimeMs, absInput, size = 512) {
  const { fs, path, thumbCacheDir, log } = ctx;
  if (!thumbCacheDir) return;
  const hash = createHash("sha1").update(`img|${mediaSrc}|${Math.floor(mtimeMs)}|${size}`).digest("hex");
  const outFile = path.resolve(thumbCacheDir, `${hash}.webp`);
  try {
    const st = await fs.stat(outFile);
    if (st.isFile() && st.size > 0) return;
  } catch {}
  try {
    await runCommand("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      absInput,
      "-frames:v",
      "1",
      "-filter_complex",
      `[0:v]scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=lanczos[v]`,
      "-map",
      "[v]",
      "-q:v",
      "42",
      "-compression_level",
      "6",
      "-preset",
      "picture",
      "-f",
      "webp",
      outFile,
    ]);
  } catch (err) {
    log(`image thumb pregeneration failed src=${mediaSrc} size=${size} err=${err.message}`);
  }
}

function normalizeDateSortKey(dateStr, mtimeMs) {
  const s = String(dateStr || "");
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return Number(`${full[1]}${full[2]}${full[3]}`);
  const yearOnly = s.match(/^(\d{4})-XX-XX$/);
  if (yearOnly) return Number(`${yearOnly[1]}0000`);
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) {
    const d = new Date(mtimeMs);
    const y = d.getUTCFullYear();
    const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
    const day = `${d.getUTCDate()}`.padStart(2, "0");
    return Number(`${y}${m}${day}`);
  }
  return 0;
}

function deriveDateGroup(dateStr, mtimeMs) {
  const s = String(dateStr || "");
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${full[1]}-${full[2]}`;
  const yearOnly = s.match(/^(\d{4})-XX-XX$/);
  if (yearOnly) return `${yearOnly[1]}-XX`;
  if (Number.isFinite(mtimeMs) && mtimeMs > 0) {
    const d = new Date(mtimeMs);
    const y = d.getUTCFullYear();
    const m = `${d.getUTCMonth() + 1}`.padStart(2, "0");
    return `${y}-${m}`;
  }
  return "0000-XX";
}

function encodePathForUrl(relPosixPath) {
  return String(relPosixPath || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function buildFilesystemIndex(ctx) {
  const { fs, mediaRoots, detectLivePhotoFilesystem, fastIndexMode, detectLivePhotos } = ctx;
  const files = [];
  for (let rootIdx = 0; rootIdx < mediaRoots.length; rootIdx += 1) {
    const mediaRoot = mediaRoots[rootIdx];
    const entryId = `fs:${rootIdx}`;
    const entryLabel = entryLabelFromFilesystemRoot(mediaRoot);
    const absFiles = await walk(fs, mediaRoot);
    for (const abs of absFiles) {
      const rel = toPosix(path.relative(mediaRoot, abs));
      const type = detectType(rel);
      if (!type) continue;
      const st = await fs.stat(abs);
      const name = decodeURIComponent(path.basename(rel));
      const dateInfo = guessDateDetailed(name, rel);
      let resolvedDate = dateInfo.date;
      let datePatched = dateInfo.patched;
      if (resolvedDate === "0000-sin-fecha") {
        const exifDate = await probeImageExifDateFallback(abs);
        if (exifDate) {
          resolvedDate = exifDate;
          datePatched = false;
        }
      }
      const relDir = toPosix(path.dirname(rel));
      const folderGroup = relDir === "." ? "root" : relDir;
      const mediaSrc = `/media/${rootIdx}/${encodePathForUrl(rel)}`;
      const dims = fastIndexMode
        ? { width: null, height: null }
        : await probeDimensions(abs);
      if (type === "image") {
        if (!fastIndexMode) {
          await ensureImageThumbFilesystem(ctx, mediaSrc, st.mtimeMs, abs, 128);
          await ensureImageThumbFilesystem(ctx, mediaSrc, st.mtimeMs, abs, 512);
        }
      }
      const liveMeta =
        type === "video" && detectLivePhotos
          ? await detectLivePhotoFilesystem(abs)
          : null;
      const thumb128Url =
        type === "image"
          ? `/thumb/image?src=${encodeURIComponent(mediaSrc)}&v=${Math.floor(st.mtimeMs)}&size=128`
          : null;
      const thumb512Url =
        type === "image"
          ? `/thumb/image?src=${encodeURIComponent(mediaSrc)}&v=${Math.floor(st.mtimeMs)}&size=512`
          : null;
      files.push({
        id: createHash("sha1").update(mediaSrc).digest("hex").slice(0, 16),
        url: mediaSrc,
        name,
        type,
        date: resolvedDate,
        dateGroup: deriveDateGroup(resolvedDate, st.mtimeMs),
        dateSortKey: normalizeDateSortKey(resolvedDate, st.mtimeMs),
        folderGroup,
        datePatched,
        width: dims.width,
        height: dims.height,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        thumbUrl:
          type === "video"
            ? `/thumb/video?src=${encodeURIComponent(mediaSrc)}&v=${Math.floor(st.mtimeMs)}`
            : type === "image"
              ? thumb512Url
              : null,
        thumb128Url,
        thumb512Url,
        livePhoto: liveMeta
          ? {
              enabled: true,
              snapshotUrl: `/live/snapshot?src=${encodeURIComponent(mediaSrc)}&v=${Math.floor(st.mtimeMs)}`,
              webVideoUrl: `/live/web-video?src=${encodeURIComponent(mediaSrc)}&v=${Math.floor(st.mtimeMs)}`,
            }
          : null,
        entryId,
        entryLabel,
      });
    }
  }
  return files;
}

async function buildAutoindexIndex(ctx) {
  const { autoindexRootUrls, log } = ctx;
  const files = [];
  for (let rootIdx = 0; rootIdx < autoindexRootUrls.length; rootIdx += 1) {
    const rootUrl = autoindexRootUrls[rootIdx];
    const entryId = `ax:${rootIdx}`;
    const entryLabel = entryLabelFromAutoindexRoot(rootUrl);
    const root = new URL(rootUrl);
    const queue = [root.href];
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      const res = await fetch(current, { cache: "no-store" });
      if (!res.ok) {
        log(`Autoindex fetch skip url=${current} status=${res.status}`);
        continue;
      }
      const html = await res.text();
      const links = parseAutoindexLinks(html);

      for (const href of links) {
        if (!href || href.startsWith("?") || href === "../") continue;
        const url = new URL(href, current);
        if (url.origin !== root.origin) continue;
        if (!url.pathname.startsWith(root.pathname)) continue;

        if (href.endsWith("/")) {
          queue.push(url.href);
          continue;
        }

        const type = detectType(url.pathname);
        if (!type) continue;
        const name = toFileNameFromUrl(url.href);
        const dateInfo = guessDateDetailed(name, url.pathname);
        const folderFromUrl = toPosix(path.posix.dirname(url.pathname)).replace(
          /^\/+/,
          "",
        );
        const folderGroup = folderFromUrl || "root";
        const thumb128Url =
          type === "image" ? `/thumb/image?src=${encodeURIComponent(url.href)}&v=0&size=128` : null;
        const thumb512Url =
          type === "image" ? `/thumb/image?src=${encodeURIComponent(url.href)}&v=0&size=512` : null;
        files.push({
          id: createHash("sha1").update(url.href).digest("hex").slice(0, 16),
          url: url.href,
          name,
          type,
          date: dateInfo.date,
          dateGroup: deriveDateGroup(dateInfo.date, 0),
          dateSortKey: normalizeDateSortKey(dateInfo.date, 0),
          folderGroup,
          datePatched: dateInfo.patched,
          width: null,
          height: null,
          size: 0,
          mtimeMs: 0,
          thumbUrl:
            type === "video"
              ? `/thumb/video?src=${encodeURIComponent(url.href)}&v=0`
              : type === "image"
                ? thumb512Url
                : null,
          thumb128Url,
          thumb512Url,
          entryId,
          entryLabel,
        });
      }
    }
  }
  return files;
}

function buildIndexPayloadFactory(ctx) {
  const { sourceMode, log, fastIndexMode } = ctx;
  return async function buildIndexPayload() {
    log(`Index build start mode=${sourceMode} fastIndexMode=${fastIndexMode ? "true" : "false"}`);
    const filesRaw =
      sourceMode === "filesystem"
        ? await buildFilesystemIndex(ctx)
        : sourceMode === "autoindex"
          ? await buildAutoindexIndex(ctx)
          : [
              ...(await buildFilesystemIndex(ctx)),
              ...(await buildAutoindexIndex(ctx)),
            ];
    const filesByUrl = dedupeFilesByUrl(filesRaw);
    const files = sourceMode === "mixed" ? dedupeMixedImagesByFingerprint(filesByUrl) : filesByUrl;
    files.sort((a, b) => {
      const d = (Number(b.dateSortKey) || 0) - (Number(a.dateSortKey) || 0);
      if (d !== 0) return d;
      const fg = String(a.folderGroup || "").localeCompare(String(b.folderGroup || ""));
      if (fg !== 0) return fg;
      const nm = String(a.name || "").localeCompare(String(b.name || ""));
      if (nm !== 0) return nm;
      return String(a.url || "").localeCompare(String(b.url || ""));
    });
    const version = createHash("sha1").update(JSON.stringify(files)).digest("hex").slice(0, 12);
    log(`Index build done mode=${sourceMode} count=${files.length} version=${version}`);
    return {
      status: "ready",
      version,
      generatedAt: new Date().toISOString(),
      count: files.length,
      files,
    };
  };
}

export { buildIndexPayloadFactory };
