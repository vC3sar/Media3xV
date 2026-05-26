import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("media3xvRuntime", {
  platform: "electron",
  hasHttpServer: true,
  baseUrl: `http://127.0.0.1:${process.env.MEDIA3XV_PORT || "3000"}`,
});
