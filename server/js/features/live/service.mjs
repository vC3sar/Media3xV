import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { withSafePath } from "../../shared/media-utils.mjs";

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
    execFfprobe,
    execFfmpegTranscode,
  } = ctx;

  const liveProbeCache = new Map();
  const liveWebJobs = new Map();
  const liveWebJobState = new Map();

  function resolveFilesystemMediaSrc(src) {
    if (!src.startsWith("/media/")) return null;
    const relAll = src.slice("/media/".length);
    const slash = relAll.indexOf("/");
    if (slash < 1) return null;
    const rootIdx = Number(relAll.slice(0, slash));
    const rel = decodeURIComponent(relAll.slice(slash + 1));
    const mediaRoot = mediaRoots[rootIdx];
    if (!mediaRoot) return null;
    const abs = path.resolve(mediaRoot, rel);
    if (!abs.startsWith(mediaRoot)) return null;
    return { rootIdx, rel, mediaRoot, abs };
  }

  async function runCommand(command, args, stdoutPipe = false) {
    if (command === "ffprobe" && typeof execFfprobe === "function") {
      return execFfprobe(args, `ffprobe:${createHash("sha1").update(args.join("|")).digest("hex").slice(0, 12)}`);
    }
    if (command === "ffmpeg" && typeof execFfmpegTranscode === "function") {
      return execFfmpegTranscode(
        args,
        `ffmpeg:${createHash("sha1").update(args.join("|")).digest("hex").slice(0, 12)}`,
      );
    }
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

  async function probeMediaStreams(absPath) {
    const out = await withSafePath(absPath, async (safePath) => {
      return await runCommand(
        "ffprobe",
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_streams",
          safePath,
        ],
        true,
      ).catch(() => "{}");
    });
    try {
      const parsed = JSON.parse(out || "{}");
      const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
      const videoStream = streams.find((s) => s?.codec_type === "video") || null;
      const audioStream = streams.find((s) => s?.codec_type === "audio") || null;
      const hasVideo = Boolean(videoStream);
      const hasAudio = Boolean(audioStream);
      return {
        hasVideo,
        hasAudio,
        videoCodec: String(videoStream?.codec_name || "").toLowerCase(),
        videoPixelFormat: String(videoStream?.pix_fmt || "").toLowerCase(),
        audioCodec: String(audioStream?.codec_name || "").toLowerCase(),
      };
    } catch {
      return {
        hasVideo: false,
        hasAudio: false,
        videoCodec: "",
        videoPixelFormat: "",
        audioCodec: "",
      };
    }
  }

  function isWebFriendlyMp4(streams) {
    const videoCodec = String(streams?.videoCodec || "");
    const pixFmt = String(streams?.videoPixelFormat || "");
    const audioCodec = String(streams?.audioCodec || "");
    const videoOk = videoCodec === "h264" && (!pixFmt || pixFmt === "yuv420p");
    const audioOk = !streams?.hasAudio || ["aac", "mp3", "mp4a"].includes(audioCodec);
    return videoOk && audioOk;
  }

  async function probeLivePhotoMetadata(absVideoPath) {
    if (liveProbeCache.has(absVideoPath)) return liveProbeCache.get(absVideoPath);
    const out = await withSafePath(absVideoPath, async (safePath) => {
      return await runCommand(
        "ffprobe",
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_entries",
          "format_tags=com.apple.quicktime.content.identifier:stream_tags=com.apple.quicktime.content.identifier",
          safePath,
        ],
        true,
      ).catch(() => "{}");
    });

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

    // Fallback for iPhone variants like IMG_E0019.MP4 vs IMG_0019.HEIC
    // or duplicated copies with suffixes.
    const dir = path.dirname(absVideoPath);
    const videoBaseName = path.basename(base).replace(/\(\d+\)$/i, "");
    const seqMatch = videoBaseName.match(/^IMG_[A-Z]?(\d{4,})$/i);
    const seq = seqMatch?.[1] || null;
    if (seq) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isFile()) continue;
          const candidateName = e.name;
          const candidateExt = path.extname(candidateName).toLowerCase();
          if (![".jpg", ".jpeg", ".heic", ".heif", ".png"].includes(candidateExt)) continue;
          const candidateBase = path.basename(candidateName, candidateExt).replace(/\(\d+\)$/i, "");
          const candidateSeqMatch = candidateBase.match(/^IMG_[A-Z]?(\d{4,})$/i);
          if (!candidateSeqMatch) continue;
          if (candidateSeqMatch[1] !== seq) continue;
          return path.resolve(dir, candidateName);
        }
      } catch {}
    }

    return null;
  }

  async function detectLivePhotoFilesystem(absVideoPath) {
    const stillPath = await findLiveStillPair(absVideoPath);
    if (!stillPath) return null;
    const hasLiveMetadata = await probeLivePhotoMetadata(absVideoPath);
    const baseName = path.basename(absVideoPath, path.extname(absVideoPath));
    const normalizedBaseName = baseName.replace(/\(\d+\)$/i, "");
    const looksLikeIphoneCapture = /^IMG_\d{4,}$/i.test(normalizedBaseName);
    if (!hasLiveMetadata && !looksLikeIphoneCapture) return null;
    return { stillPath };
  }

  async function getSourceVersionKey(absVideoPath, vHint) {
    if (String(vHint || "").trim()) return String(vHint).trim();
    try {
      const st = await fs.stat(absVideoPath);
      return `${Math.floor(st.mtimeMs)}_${st.size}`;
    } catch {
      return "0";
    }
  }

  function getLiveWebOutFile(src, versionKey, absVideoPath) {
    const hash = createHash("sha1")
      .update(`${src}|${versionKey}|web-v2`)
      .digest("hex");
    return path.resolve(
      liveWebDir,
      `${path.basename(absVideoPath, path.extname(absVideoPath))}_web_${hash.slice(0, 8)}.mp4`,
    );
  }

  async function ensureLiveWebVideo(src, v, absVideoPath) {
    const versionKey = await getSourceVersionKey(absVideoPath, v);
    const outFile = getLiveWebOutFile(src, versionKey, absVideoPath);
    try {
      const st = await fs.stat(outFile);
      if (st.isFile() && st.size > 0) {
        liveWebJobState.set(`${src}|${versionKey}`, {
          status: "ready",
          updatedAt: Date.now(),
          outFile,
          error: "",
        });
        return outFile;
      }
    } catch {}

    const key = `${src}|${versionKey}`;
    const prevState = liveWebJobState.get(key);
    if (prevState?.status === "error") {
      // Throttle repeated hard-fail retries for the same source/version.
      const elapsed = Date.now() - Number(prevState.updatedAt || 0);
      if (elapsed < 15000) {
        throw new Error(prevState.error || "Transcode failed recently");
      }
    }

    if (!liveWebJobs.has(key)) {
      liveWebJobState.set(key, {
        status: "running",
        updatedAt: Date.now(),
        outFile,
        error: "",
      });
      liveWebJobs.set(
        key,
        (async () => {
          const streams = await probeMediaStreams(absVideoPath);
          if (!streams.hasVideo) {
            throw new Error("Source has no video stream");
          }
          const mapArgs = streams.hasAudio ? ["-map", "0:v:0", "-map", "0:a:0"] : ["-map", "0:v:0"];
          await withSafePath(absVideoPath, async (safePath) => {
            await runCommand("ffmpeg", [
              "-loglevel",
              "error",
              "-i",
              safePath,
              ...mapArgs,
              "-c:v",
              "libx264",
              "-preset",
              "medium",
              "-crf",
              "18",
              "-pix_fmt",
              "yuv420p",
              ...(streams.hasAudio
                ? ["-c:a", "aac", "-b:a", "160k", "-ac", "2"]
                : ["-an"]),
              "-sn",
              "-map_metadata",
              "-1",
              "-movflags",
              "+faststart",
              "-y",
              outFile,
            ]);
          });
          const outSt = await fs.stat(outFile);
          if (!outSt.isFile() || outSt.size <= 0) {
            throw new Error("Empty transcoded file");
          }
          liveWebJobState.set(key, {
            status: "ready",
            updatedAt: Date.now(),
            outFile,
            error: "",
          });
          return outFile;
        })().catch((err) => {
          liveWebJobState.set(key, {
            status: "error",
            updatedAt: Date.now(),
            outFile,
            error: err?.message || "Transcode failed",
          });
          throw err;
        }).finally(() => {
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

      await withSafePath(stillInput, async (safeInput) => {
        await runCommand("ffmpeg", [
          "-loglevel",
          "error",
          "-i",
          safeInput,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-q:v",
          "1",
          "-f",
          "mjpeg",
          "-y",
          outFile,
        ]);
      });

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
    const forceTranscode =
      String(url.searchParams.get("force") || "0").trim() === "1";
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
      const ext = path.extname(resolved.abs).toLowerCase();
      const streams = await probeMediaStreams(resolved.abs);
      const mp4NeedsTranscode =
        ext === ".mp4" && streams.hasVideo && !isWebFriendlyMp4(streams);
      const needsWebTranscode =
        Boolean(liveInfo) ||
        [".mov", ".mkv", ".avi", ".3gp"].includes(ext) ||
        mp4NeedsTranscode ||
        forceTranscode;
      if (!needsWebTranscode) {
        await serveFile(req, res, resolved.abs);
        return;
      }
      const versionKey = await getSourceVersionKey(resolved.abs, v);
      const outFile = getLiveWebOutFile(src, versionKey, resolved.abs);
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
      await ensureLiveWebVideo(src, versionKey, resolved.abs);

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
    const forceTranscode =
      String(url.searchParams.get("force") || "0").trim() === "1";
    if (!src) return json(res, 400, { error: "Missing src" });
    const resolved = resolveFilesystemMediaSrc(src);
    if (!resolved) {
      return json(res, 404, { error: "Only filesystem media is supported for live video" });
    }
    try {
      const liveInfo = await detectLivePhotoFilesystem(resolved.abs);
      const ext = path.extname(resolved.abs).toLowerCase();
      const streams = await probeMediaStreams(resolved.abs);
      const mp4NeedsTranscode =
        ext === ".mp4" && streams.hasVideo && !isWebFriendlyMp4(streams);
      const needsWebTranscode =
        Boolean(liveInfo) ||
        [".mov", ".mkv", ".avi", ".3gp"].includes(ext) ||
        mp4NeedsTranscode ||
        forceTranscode;
      if (!needsWebTranscode) {
        return json(res, 200, { ok: true, live: false, transcode: false, ready: false });
      }
      const versionKey = await getSourceVersionKey(resolved.abs, v);
      const outFile = getLiveWebOutFile(src, versionKey, resolved.abs);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          return json(res, 200, {
            ok: true,
            live: Boolean(liveInfo),
            transcode: true,
            ready: true,
            url: `/live/web-video?src=${encodeURIComponent(src)}&v=${encodeURIComponent(v)}&force=${forceTranscode ? "1" : "0"}`,
          });
        }
      } catch {}
      ensureLiveWebVideo(src, versionKey, resolved.abs).catch(() => {});
      return json(res, 202, {
        ok: true,
        live: Boolean(liveInfo),
        transcode: true,
        ready: false,
        preparing: liveWebJobs.has(`${src}|${versionKey}`),
      });
    } catch (err) {
      return json(res, 400, { error: err.message || "No se pudo iniciar preparación live" });
    }
  }

  async function handleStatus(res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    const forceTranscode =
      String(url.searchParams.get("force") || "0").trim() === "1";
    if (!src) return json(res, 400, { error: "Missing src" });
    const resolved = resolveFilesystemMediaSrc(src);
    if (!resolved) {
      return json(res, 404, { error: "Only filesystem media is supported for live video" });
    }
    try {
      const liveInfo = await detectLivePhotoFilesystem(resolved.abs);
      const ext = path.extname(resolved.abs).toLowerCase();
      const streams = await probeMediaStreams(resolved.abs);
      const mp4NeedsTranscode =
        ext === ".mp4" && streams.hasVideo && !isWebFriendlyMp4(streams);
      const needsWebTranscode =
        Boolean(liveInfo) ||
        [".mov", ".mkv", ".avi", ".3gp"].includes(ext) ||
        mp4NeedsTranscode ||
        forceTranscode;
      if (!needsWebTranscode) {
        return json(res, 200, { ok: true, live: false, transcode: false, ready: false });
      }
      const versionKey = await getSourceVersionKey(resolved.abs, v);
      const outFile = getLiveWebOutFile(src, versionKey, resolved.abs);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          return json(res, 200, {
            ok: true,
            live: Boolean(liveInfo),
            transcode: true,
            ready: true,
            url: `/live/web-video?src=${encodeURIComponent(src)}&v=${encodeURIComponent(v)}&force=${forceTranscode ? "1" : "0"}`,
          });
        }
      } catch {}
      const state = liveWebJobState.get(`${src}|${versionKey}`) || null;
      return json(res, 200, {
        ok: true,
        live: Boolean(liveInfo),
        transcode: true,
        ready: false,
        preparing: liveWebJobs.has(`${src}|${versionKey}`),
        error: state?.status === "error" ? state.error : "",
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
