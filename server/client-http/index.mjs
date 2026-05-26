function createClientHttpModule({
  fs,
  path,
  clientHttpDir,
  enabled = true,
  serveFile,
}) {
  function jsonRuntimeScript() {
    const payload = {
      platform: "http",
      hasHttpServer: true,
      baseUrl: "",
    };
    return `<script>window.media3xvRuntime=${JSON.stringify(payload)};</script>`;
  }

  async function serveIndexWithRuntime(res) {
    const indexPath = path.resolve(clientHttpDir, "index.html");
    try {
      const raw = await fs.readFile(indexPath, "utf8");
      const runtimeTag = jsonRuntimeScript();
      const html = raw.includes("</head>")
        ? raw.replace("</head>", `${runtimeTag}\n</head>`)
        : `${runtimeTag}\n${raw}`;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return true;
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return true;
    }
  }

  function resolveClientPath(pathname) {
    const abs = path.resolve(clientHttpDir, `.${pathname}`);
    if (!abs.startsWith(clientHttpDir)) return null;
    return abs;
  }

  async function handle(req, res, pathname) {
    if (!enabled) return false;
    if (pathname === "/" || pathname === "/index.html") {
      return serveIndexWithRuntime(res);
    }
    if (pathname.startsWith("/js/")) {
      const abs = resolveClientPath(pathname);
      if (!abs) {
        res.writeHead(403);
        res.end("Forbidden");
        return true;
      }
      await serveFile(req, res, abs);
      return true;
    }
    return false;
  }

  return { handle };
}

export { createClientHttpModule };
