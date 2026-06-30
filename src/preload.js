import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("proxyApi", {
  exposeLocalPort: (port, seedHex) => ipcRenderer.invoke("proxy:exposeLocalPort", port, seedHex),
  exposeRemoteAsLocal: (url, defaultPort) => ipcRenderer.invoke("proxy:exposeRemoteAsLocal", url, defaultPort),
  exposeFolder: (rootFolder, seedHex) => ipcRenderer.invoke("proxy:exposeFolder", rootFolder, seedHex),
  destroy: () => ipcRenderer.invoke("proxy:destroy"),
  toJSON: () => ipcRenderer.invoke("proxy:toJSON"),
  loadJSON: (json) => ipcRenderer.invoke("proxy:loadJSON", json),
});
