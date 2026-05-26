import path from "node:path";
import { URL } from "node:url";

const IMG = /\.(jpg|jpeg|png|gif|webp|bmp|heic|heif|avif)$/i;
const VID = /\.(mp4|webm|mov|mkv|avi|3gp)$/i;
const AUD = /\.(mp3|m4a|wav|ogg|flac)$/i;

function detectType(name) {
  if (IMG.test(name)) return "image";
  if (VID.test(name)) return "video";
  if (AUD.test(name)) return "audio";
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
  return { date: "0000-sin-fecha", patched: true };
}

function toPosix(p) {
  return p.split(path.sep).join("/");
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
    const n = p.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(n);
  } catch {
    return "";
  }
}

function entryLabelFromFilesystemRoot(rootPath) {
  const normalized = String(rootPath).replace(/[\\/]+$/, "");
  const base = path.basename(normalized);
  return base || normalized || "Entrada";
}

function entryLabelFromAutoindexRoot(rootUrl) {
  try {
    const u = new URL(String(rootUrl));
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || u.host || u.href;
  } catch {
    return String(rootUrl);
  }
}

function dedupeFilesByUrl(files) {
  const out = [];
  const seen = new Set();
  for (const file of files) {
    if (!file?.url) continue;
    if (seen.has(file.url)) continue;
    seen.add(file.url);
    out.push(file);
  }
  return out;
}

function dedupeMixedImagesByFingerprint(files) {
  const out = [];
  const seenImageKeys = new Set();
  for (const file of files) {
    if (!file) continue;
    if (file.type !== "image") {
      out.push(file);
      continue;
    }
    const key = [
      String(Number.isFinite(file.size) ? file.size : 0),
      String(file.name || ""),
      String(file.date || ""),
    ].join("|");
    if (seenImageKeys.has(key)) continue;
    seenImageKeys.add(key);
    out.push(file);
  }
  return out;
}

export {
  detectType,
  guessDateDetailed,
  toPosix,
  parseAutoindexLinks,
  toFileNameFromUrl,
  entryLabelFromFilesystemRoot,
  entryLabelFromAutoindexRoot,
  dedupeFilesByUrl,
  dedupeMixedImagesByFingerprint,
};
