#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const IMG = /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/i;
const VID = /\.(mp4|webm|mov|mkv|avi|3gp)$/i;
const AUD = /\.(mp3|m4a|wav|ogg|flac)$/i;

function detectType(name) {
  if (IMG.test(name)) return 'image';
  if (VID.test(name)) return 'video';
  if (AUD.test(name)) return 'audio';
  return null;
}

function guessDate(name, relPath) {
  const text = decodeURIComponent(`${name} ${relPath}`);
  let m = text.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/(20\d{2})/);
  if (m) return `${m[1]}-XX-XX`;
  return '0000-sin-fecha';
}

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(fullPath);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

async function main() {
  const mediaRoot = path.resolve(process.argv[2] || './takeout-20260520T011015Z-3-001');
  const urlBase = (process.argv[3] || '/takeout-20260520T011015Z-3-001/').replace(/\/?$/, '/');
  const outPath = path.resolve(process.argv[4] || './media-index.json');

  const files = await walk(mediaRoot);
  const mapped = [];
  for (const abs of files) {
    const rel = toPosix(path.relative(mediaRoot, abs));
    const type = detectType(rel);
    if (!type) continue;
    const st = await fs.stat(abs);
    const name = decodeURIComponent(path.basename(rel));
    mapped.push({
      url: `${urlBase}${rel}`,
      name,
      type,
      date: guessDate(name, rel),
      size: st.size,
      mtimeMs: Math.floor(st.mtimeMs)
    });
  }

  mapped.sort((a, b) => a.url.localeCompare(b.url));
  const hash = crypto.createHash('sha1').update(JSON.stringify(mapped)).digest('hex').slice(0, 12);
  const payload = {
    version: hash,
    generatedAt: new Date().toISOString(),
    count: mapped.length,
    files: mapped
  };

  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  process.stdout.write(`Index generado: ${outPath} (${mapped.length} archivos)\n`);
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
