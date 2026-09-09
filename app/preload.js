const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("proxyApi", {
  /** @type {string} The OS platform ("darwin" | "win32" | "linux" | …). */
  platform: process.platform,
  /** @type {(port: number, seedHex: string) => Promise<void>} */
  exposeLocalPort: (port, seedHex) =>
    ipcRenderer.invoke("proxy:exposeLocalPort", port, seedHex),
  /** @type {(url: string, defaultPort: number) => Promise<void>} */
  exposeRemoteAsLocal: (url, defaultPort) =>
    ipcRenderer.invoke("proxy:exposeRemoteAsLocal", url, defaultPort),
  /** @type {(rootFolder: string, seedHex: string) => Promise<void>} */
  exposeFolder: (rootFolder, seedHex) =>
    ipcRenderer.invoke("proxy:exposeFolder", rootFolder, seedHex),
  destroy: () => ipcRenderer.invoke("proxy:destroy"),
  /** @type {() => Promise<string | null>} */
  selectFolder: () => ipcRenderer.invoke("selectFolder"),
  toJSON: () => ipcRenderer.invoke("proxy:toJSON"),
  list: () => ipcRenderer.invoke("proxy:list"),
  /** @type {(json: object) => Promise<void>} */
  loadJSON: (json) => ipcRenderer.invoke("proxy:loadJSON", json),
});
