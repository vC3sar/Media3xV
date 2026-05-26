const { contextBridge, ipcRenderer } = require("electron");

const remoteBaseRaw = String(process.env.MEDIA3XV_REMOTE_URL || "")
  .trim()
  .replace(/\/+$/, "");
const localBase = `http://127.0.0.1:${process.env.MEDIA3XV_PORT || "3000"}`;
const withDefaultPort = (raw) => {
  try {
    const u = new URL(raw);
    if (!u.port && (u.protocol === "http:" || u.protocol === "https:")) {
      u.port = "3000";
    }
    return u.toString().replace(/\/+$/, "");
  } catch {
    return raw;
  }
};
const remoteBase = withDefaultPort(remoteBaseRaw);
const baseUrl = remoteBase || localBase;

contextBridge.exposeInMainWorld("media3xvRuntime", {
  platform: "electron",
  hasHttpServer: true,
  baseUrl,
  getClientConfig: () => ipcRenderer.invoke("client-config:get"),
  setClientConfig: (cfg) => ipcRenderer.invoke("client-config:set", cfg),
});
