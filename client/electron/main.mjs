import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { app, BrowserWindow } from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
const SERVER_ENTRY = path.resolve(PROJECT_ROOT, "server", "server.mjs");
const HOST = "127.0.0.1";
const PORT = process.env.MEDIA3XV_PORT || "3000";
const APP_URL = `http://${HOST}:${PORT}`;
let serverProc = null;

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
      preload: path.resolve(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(async () => {
  startEmbeddedServer();
  await waitForServerReady();
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
