import path from "node:path";

const defaults = {
  host: "127.0.0.1",
  port: 3000,
  sourceMode: "filesystem",
  mediaRoot: "./takeout-20260520T011015Z-3-001",
  mediaRoots: [],
  autoindexRootUrl: "http://127.0.0.1:8080/takeout-20260520T011015Z-3-001/",
  autoindexRootUrls: [],
  mediaIndexFile: "./media-index.json",
  watchDebounceMs: 1200,
  filesystemRefreshMs: 15000,
  autoindexRefreshMs: 20000,
  fastIndexMode: false,
  debug: false,
};

async function readConfig(fs, configFile) {
  try {
    const raw = await fs.readFile(configFile, "utf8");
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

async function writeConfig(fs, configFile, cfg) {
  await fs.writeFile(configFile, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
}

function normalizeSourceLists(cfg) {
  const toUnique = (values) => {
    const out = [];
    const seen = new Set();
    for (const val of values) {
      const k = String(val);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  };

  const mediaRoots = toUnique(
    [...(Array.isArray(cfg.mediaRoots) ? cfg.mediaRoots : []), cfg.mediaRoot]
      .filter(Boolean)
      .map((p) => path.resolve(String(p))),
  );
  const autoindexRootUrls = toUnique(
    [
      ...(Array.isArray(cfg.autoindexRootUrls) ? cfg.autoindexRootUrls : []),
      cfg.autoindexRootUrl,
    ]
      .filter(Boolean)
      .map((u) => String(u)),
  );

  return { mediaRoots, autoindexRootUrls };
}

export { defaults, readConfig, writeConfig, normalizeSourceLists };
