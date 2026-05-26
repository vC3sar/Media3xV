import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { app, BrowserWindow, ipcMain } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SERVER_ENTRY = path.resolve(PROJECT_ROOT, "server", "server.mjs");
const CLIENT_INDEX = path.resolve(PROJECT_ROOT, "client", "index.html");
const CLIENT_CONFIG = path.resolve(PROJECT_ROOT, "client", "config.json");
const HOST = "127.0.0.1";
const PORT = process.env.MEDIA3XV_PORT || "3000";
const APP_URL = `http://${HOST}:${PORT}`;

function readClientConfig() {
  try {
    const raw = fs.readFileSync(CLIENT_CONFIG, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeClientConfig(nextCfg) {
  const safeCfg = nextCfg && typeof nextCfg === "object" ? nextCfg : {};
  fs.writeFileSync(CLIENT_CONFIG, `${JSON.stringify(safeCfg, null, 2)}\n`, "utf8");
}

const clientConfig = readClientConfig();
const REMOTE_URL = String(process.env.MEDIA3XV_REMOTE_URL || clientConfig.remoteUrl || "")
  .trim()
  .replace(/\/+$/, "");
if (!process.env.MEDIA3XV_REMOTE_URL && REMOTE_URL) {
  process.env.MEDIA3XV_REMOTE_URL = REMOTE_URL;
}
function withDefaultPort(raw) {
  try {
    const u = new URL(raw);
    if (!u.port && (u.protocol === "http:" || u.protocol === "https:")) {
      u.port = "3000";
    }
    return u.toString().replace(/\/+$/, "");
  } catch {
    return raw;
  }
}
const REMOTE_URL_FIXED = withDefaultPort(REMOTE_URL);
const USE_REMOTE = Boolean(REMOTE_URL);
let serverProc = null;

ipcMain.handle("client-config:get", () => {
  const cfg = readClientConfig();
  return { remoteUrl: String(cfg.remoteUrl || "") };
});

ipcMain.handle("client-config:set", (_evt, payload) => {
  const current = readClientConfig();
  const remoteUrl = String(payload?.remoteUrl || "").trim();
  const nextCfg = { ...current, remoteUrl };
  writeClientConfig(nextCfg);
  process.env.MEDIA3XV_REMOTE_URL = remoteUrl;
  return { ok: true, remoteUrl };
});

async function waitForServerReady(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${APP_URL}/api/index-status`, { cache: "no-store" });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

function startEmbeddedServer() {
  if (USE_REMOTE && String(process.env.MEDIA3XV_FORCE_LOCAL || "").toLowerCase() !== "true") return;
  serverProc = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      HOST,
      PORT,
    },
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    webPreferences: {
      preload: path.resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: false,
    },
  });

  win.loadFile(CLIENT_INDEX);
}

app.whenReady().then(async () => {
  startEmbeddedServer();
  if (!USE_REMOTE) {
    await waitForServerReady();
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill("SIGTERM");
    serverProc = null;
  }
  if (process.platform !== "darwin") app.quit();
});
