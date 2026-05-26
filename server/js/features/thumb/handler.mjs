import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

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

function createThumbHandler(ctx) {
  const {
    fs,
    path,
    createReadStream,
    mediaRoots,
    thumbCacheDir,
    log,
    execFfmpegThumb,
  } = ctx;
  const THUMB_SIZE = 256;
  const runFfmpeg = (args, dedupeKey = "") =>
    typeof execFfmpegThumb === "function"
      ? execFfmpegThumb(args, dedupeKey)
      : runCommand("ffmpeg", args);

  function resolveSrc(src) {
    if (src.startsWith("/media/")) {
      const relAll = src.slice("/media/".length);
      const slash = relAll.indexOf("/");
      if (slash < 1) return { errorCode: 400, errorMessage: "Bad media src" };
      const rootIdx = Number(relAll.slice(0, slash));
      const rel = decodeURIComponent(relAll.slice(slash + 1));
      const mediaRoot = mediaRoots[rootIdx];
      if (!mediaRoot) return { errorCode: 404, errorMessage: "Media root not found" };
      const abs = path.resolve(mediaRoot, rel);
      if (!abs.startsWith(mediaRoot)) return { errorCode: 403, errorMessage: "Forbidden" };
      return { input: abs };
    }
    if (!/^https?:\/\//i.test(src)) {
      return { errorCode: 400, errorMessage: "Unsupported src" };
    }
    return { input: src };
  }

  async function serveCachedThumb(res, outFile, contentType) {
    const st = await fs.stat(outFile);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": st.size,
    });
    createReadStream(outFile).pipe(res);
  }

  async function handleVideo(req, res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    if (!src) {
      res.writeHead(400);
      res.end("Missing src");
      return true;
    }

    try {
      const hash = createHash("sha1").update(`${src}|${v}`).digest("hex");
      const outFile = path.resolve(thumbCacheDir, `${hash}.jpg`);

      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          await serveCachedThumb(res, outFile, "image/jpeg");
          return true;
        }
      } catch {}

      const resolved = resolveSrc(src);
      if (resolved.errorCode) {
        res.writeHead(resolved.errorCode);
        res.end(resolved.errorMessage);
        return true;
      }

      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        "0.15",
        "-i",
        resolved.input,
        "-frames:v",
        "1",
        "-vf",
        "scale=240:-2:flags=fast_bilinear",
        "-q:v",
        "12",
        "-f",
        "mjpeg",
        outFile,
      ], `thumb:video:${hash}`);

      await serveCachedThumb(res, outFile, "image/jpeg");
    } catch (err) {
      log(`thumb generation failed src=${src} err=${err.message}`);
      res.writeHead(404);
      res.end("Thumbnail unavailable");
    }
    return true;
  }

  async function handleImage(req, res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    const sizeRaw = Number(url.searchParams.get("size") || THUMB_SIZE);
    const size = [128, 256, 512].includes(sizeRaw) ? sizeRaw : THUMB_SIZE;
    if (!src) {
      res.writeHead(400);
      res.end("Missing src");
      return true;
    }
    try {
      const hash = createHash("sha1").update(`img|${src}|${v}|${size}`).digest("hex");
      const outFile = path.resolve(thumbCacheDir, `${hash}.webp`);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          await serveCachedThumb(res, outFile, "image/webp");
          return true;
        }
      } catch {}

      const resolved = resolveSrc(src);
      if (resolved.errorCode) {
        res.writeHead(resolved.errorCode);
        res.end(resolved.errorMessage);
        return true;
      }

      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        resolved.input,
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
      ], `thumb:image:${hash}`);
      await serveCachedThumb(res, outFile, "image/webp");
    } catch (err) {
      log(`image thumb generation failed src=${src} err=${err.message}`);
      res.writeHead(404);
      res.end("Thumbnail unavailable");
    }
    return true;
  }

  async function handleWebImage(req, res, url) {
    const src = String(url.searchParams.get("src") || "").trim();
    const v = String(url.searchParams.get("v") || "0").trim();
    if (!src) {
      res.writeHead(400);
      res.end("Missing src");
      return true;
    }
    try {
      const hash = createHash("sha1").update(`web|${src}|${v}`).digest("hex");
      const outFile = path.resolve(thumbCacheDir, `web_${hash}.jpg`);
      try {
        const st = await fs.stat(outFile);
        if (st.isFile() && st.size > 0) {
          await serveCachedThumb(res, outFile, "image/jpeg");
          return true;
        }
      } catch {}

      const resolved = resolveSrc(src);
      if (resolved.errorCode) {
        res.writeHead(resolved.errorCode);
        res.end(resolved.errorMessage);
        return true;
      }

      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        resolved.input,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-f",
        "mjpeg",
        outFile,
      ], `thumb:web:${hash}`);
      await serveCachedThumb(res, outFile, "image/jpeg");
    } catch (err) {
      log(`web image generation failed src=${src} err=${err.message}`);
      res.writeHead(404);
      res.end("Web Image unavailable");
    }
    return true;
  }

  return { handleVideo, handleImage, handleWebImage };
}

export { createThumbHandler };
