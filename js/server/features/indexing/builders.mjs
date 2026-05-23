import { URL } from "node:url";
import path from "node:path";
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

async function buildFilesystemIndex(ctx) {
  const { fs, mediaRoots, detectLivePhotoFilesystem } = ctx;
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
      const mediaSrc = `/media/${rootIdx}/${rel}`;
      const liveMeta = type === "video" ? await detectLivePhotoFilesystem(abs) : null;
      files.push({
        url: mediaSrc,
        name,
        type,
        date: dateInfo.date,
        datePatched: dateInfo.patched,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
        thumbUrl:
          type === "video"
            ? `/thumb/video?src=${encodeURIComponent(mediaSrc)}&v=${Math.floor(st.mtimeMs)}`
            : null,
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
        files.push({
          url: url.href,
          name,
          type,
          date: dateInfo.date,
          datePatched: dateInfo.patched,
          size: 0,
          mtimeMs: 0,
          thumbUrl:
            type === "video"
              ? `/thumb/video?src=${encodeURIComponent(url.href)}&v=0`
              : null,
          entryId,
          entryLabel,
        });
      }
    }
  }
  return files;
}

function buildIndexPayloadFactory(ctx) {
  const { sourceMode, log, crypto } = ctx;
  return async function buildIndexPayload() {
    log(`Index build start mode=${sourceMode}`);
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
    files.sort((a, b) => a.url.localeCompare(b.url));
    const version = crypto.createHash("sha1").update(JSON.stringify(files)).digest("hex").slice(0, 12);
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
