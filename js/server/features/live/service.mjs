import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

function createLiveService(ctx) {
  const {
    fs,
    path,
    createReadStream,
    mediaRoots,
    liveSnapshotDir,
    liveWebDir,
    pathExists,
    serveFile,
    json,
    log,
  } = ctx;

  const liveProbeCache = new Map();
  const liveWebJobs = new Map();

  function resolveFilesystemMediaSrc(src) {
    if (!src.startsWith("/media/")) return null;
    const relAll = src.slice("/media/".length);
    const slash = relAll.indexOf("/");
    if (slash < 1) return null;
    const rootIdx = Number(relAll.slice(0, slash));
    const rel = relAll.slice(slash + 1);
    const mediaRoot = mediaRoots[rootIdx];
    if (!mediaRoot) return null;
    const abs = path.resolve(mediaRoot, rel);
    if (!abs.startsWith(mediaRoot)) return null;
    return { rootIdx, rel, mediaRoot, abs };
  }

  async function runCommand(command, args, stdoutPipe = false) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ["ignore", stdoutPipe ? "pipe" : "ignore", "pipe"],
      });
      let out = "";
      let stderr = "";
      if (stdoutPipe) {
        child.stdout.on("data", (d) => {
          out += String(d || "");
        });
      }
      child.stderr.on("data", (d) => {
        stderr += String(d || "");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(stderr.trim() || `${command} exit ${code}`));
      });
    });
  }

  async function probeLivePhotoMetadata(absVideoPath) {
    if (liveProbeCache.has(absVideoPath)) return liveProbeCache.get(absVideoPath);
    const out = await runCommand(
      "ffprobe",
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_entries",
        "format_tags=com.apple.quicktime.content.identifier:stream_tags=com.apple.quicktime.content.identifier",
        absVideoPath,
      ],
      true,
    ).catch(() => "{}");

    let result = false;
    try {
      const parsed = JSON.parse(out || "{}");
      const fmt = parsed?.format?.tags?.["com.apple.quicktime.content.identifier"];
      const streamHit =
        Array.isArray(parsed?.streams) &&
        parsed.streams.some((s) => s?.tags?.["com.apple.quicktime.content.identifier"]);
      result = Boolean(fmt || streamHit);
    } catch {
      result = false;
    }

    liveProbeCache.set(absVideoPath, result);
    return result;
  }

  async function findLiveStillPair(absVideoPath) {
    const ext = path.extname(absVideoPath).toLowerCase();
    if (![".mov", ".mp4"].includes(ext)) return null;
    const base = absVideoPath.slice(0, -ext.length);
    const candidatesBase = new Set([base]);
    // Common duplicate suffixes from mobile/gallery copy operations:
    // IMG_0019(1).MP4 -> try matching still IMG_0019.HEIC
    const noParensDup = base.replace(/\(\d+\)$/i, "");
    if (noParensDup && noParensDup !== base) candidatesBase.add(noParensDup);
    const candidates = [".jpg", ".jpeg", ".heic", ".heif", ".png"];
    for (const candidateBase of candidatesBase) {
      for (const stillExt of candidates) {
        const still = `${candidateBase}${stillExt}`;
        if (await pathExists(still)) return still;
        const stillUpper = `${candidateBase}${stillExt.toUpperCase()}`;
        if (await pathExists(stillUpper)) return stillUpper;
      }
    }
    return null;
  }

  async function detectLivePhotoFilesystem(absVideoPath) {
    const stillPath = await findLiveStillPair(absVideoPath);
    if (!stillPath) return null;
    const hasLiveMetadata = await probeLivePhotoMetadata(absVideoPath);
    const baseName = path.basename(absVideoPath, path.extname(absVideoPath));
    const looksLikeIphoneCapture = /^IMG_\d{4,}$/i.test(baseName);
    if (!hasLiveMetadata && !looksLikeIphoneCapture) return null;
    return { stillPath };
  }

  function getLiveWebOutFile(src, v, absVideoPath) {
    const hash = createHash("sha1").update(`${src}|${v}|web`).digest("hex");
    return path.resolve(
      liveWebDir,
      `${path.basename(absVideoPath, path.extname(absVideoPath))}_web_${hash.slice(0, 8)}.mp4`,
    );
  }

  async function ensureLiveWebVideo(src, v, absVideoPath) {
    const outFile = getLiveWebOutFile(src, v, absVideoPath);
    try {
      const st = await fs.stat(outFile);
      if (st.isFile() && st.size > 0) return outFile;
    } catch {}

    const key = `${src}|${v}`;
    if (!liveWebJobs.has(key)) {
      liveWebJobs.set(
        key,
        (async () => {
          await runCommand("ffmpeg", [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            absVideoPath,
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            outFile,
          ]);
          return outFile;
        })().finally(() => {
          liveWebJobs.delete(key);
        }),
      );
    }
    return liveWebJobs.get(key);
  }

  async function handleSnapshot(req, res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    if (!src) {
      res.writeHead(400);
      res.end("Missing src");
      return;
    }
    const resolved = resolveFilesystemMediaSrc(src);
    if (!resolved) {
      res.writeHead(404);
      res.end("Only filesystem media is supported for live snapshot");
      return;
    }
    try {
      const liveInfo = await detectLivePhotoFilesystem(resolved.abs);
      if (!liveInfo) {
        res.writeHead(404);
        res.end("Not a live photo");
        return;
      }
      const hash = createHash("sha1").update(`${src}|${v}|snapshot`).digest("hex");
      const outFile = path.resolve(liveSnapshotDir, `${hash}.jpg`);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": st.size,
          });
          createReadStream(outFile).pipe(res);
          return;
        }
      } catch {}

      const stillInput = liveInfo.stillPath;
      const stillExt = path.extname(stillInput).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp"].includes(stillExt)) {
        await serveFile(req, res, stillInput);
        return;
      }

      await runCommand("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        stillInput,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-q:v",
        "1",
        "-f",
        "mjpeg",
        outFile,
      ]);

      const st = await fs.stat(outFile);
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": st.size,
      });
      createReadStream(outFile).pipe(res);
    } catch (err) {
      log(`live snapshot failed src=${src} err=${err.message}`);
      res.writeHead(404);
      res.end("Live snapshot unavailable");
    }
  }

  async function handleWebVideo(req, res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    if (!src) {
      res.writeHead(400);
      res.end("Missing src");
      return;
    }
    const resolved = resolveFilesystemMediaSrc(src);
    if (!resolved) {
      res.writeHead(404);
      res.end("Only filesystem media is supported for live video");
      return;
    }
    try {
      const liveInfo = await detectLivePhotoFilesystem(resolved.abs);
      if (!liveInfo) {
        await serveFile(req, res, resolved.abs);
        return;
      }
      const outFile = getLiveWebOutFile(src, v, resolved.abs);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          res.writeHead(200, {
            "Content-Type": "video/mp4",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": st.size,
            "Accept-Ranges": "bytes",
          });
          createReadStream(outFile).pipe(res);
          return;
        }
      } catch {}
      await ensureLiveWebVideo(src, v, resolved.abs);

      const st = await fs.stat(outFile);
      res.writeHead(200, {
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Length": st.size,
        "Accept-Ranges": "bytes",
      });
      createReadStream(outFile).pipe(res);
    } catch (err) {
      log(`live web transcode failed src=${src} err=${err.message}`);
      await serveFile(req, res, resolved.abs);
    }
  }

  async function handlePrepare(res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    if (!src) return json(res, 400, { error: "Missing src" });
    const resolved = resolveFilesystemMediaSrc(src);
    if (!resolved) {
      return json(res, 404, { error: "Only filesystem media is supported for live video" });
    }
    try {
      const liveInfo = await detectLivePhotoFilesystem(resolved.abs);
      if (!liveInfo) return json(res, 200, { ok: true, live: false });
      const outFile = getLiveWebOutFile(src, v, resolved.abs);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          return json(res, 200, {
            ok: true,
            live: true,
            ready: true,
            url: `/live/web-video?src=${encodeURIComponent(src)}&v=${encodeURIComponent(v)}`,
          });
        }
      } catch {}
      ensureLiveWebVideo(src, v, resolved.abs).catch(() => {});
      return json(res, 202, { ok: true, live: true, ready: false });
    } catch (err) {
      return json(res, 400, { error: err.message || "No se pudo iniciar preparación live" });
    }
  }

  async function handleStatus(res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    if (!src) return json(res, 400, { error: "Missing src" });
    const resolved = resolveFilesystemMediaSrc(src);
    if (!resolved) {
      return json(res, 404, { error: "Only filesystem media is supported for live video" });
    }
    try {
      const liveInfo = await detectLivePhotoFilesystem(resolved.abs);
      if (!liveInfo) return json(res, 200, { ok: true, live: false, ready: false });
      const outFile = getLiveWebOutFile(src, v, resolved.abs);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          return json(res, 200, {
            ok: true,
            live: true,
            ready: true,
            url: `/live/web-video?src=${encodeURIComponent(src)}&v=${encodeURIComponent(v)}`,
          });
        }
      } catch {}
      return json(res, 200, {
        ok: true,
        live: true,
        ready: false,
        preparing: liveWebJobs.has(`${src}|${v}`),
      });
    } catch (err) {
      return json(res, 400, { error: err.message || "No se pudo consultar estado live" });
    }
  }

  return {
    detectLivePhotoFilesystem,
    handleSnapshot,
    handleWebVideo,
    handlePrepare,
    handleStatus,
  };
}

export { createLiveService };
