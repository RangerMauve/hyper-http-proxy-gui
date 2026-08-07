const { contextBridge } = require("electron");

/**
 * @typedef {object} MockState
 * @property {Record<string, string>} localPorts
 * @property {Record<string, number>} remoteProxies
 * @property {Record<string, string>} folders
 */

/** @type {MockState} */
const MOCK_STATE = {
  localPorts: {},
  remoteProxies: {},
  folders: {},
};

/** @type {{ method: string; args: unknown[] }[]} */
const callLog = [];

contextBridge.exposeInMainWorld("proxyApi", {
  toJSON: () => ({ ...MOCK_STATE }),

  /**
   * @param {number} port
   * @param {string} seedHex
   */
  exposeLocalPort: async (port, seedHex) => {
    callLog.push({ method: "exposeLocalPort", args: [port, seedHex] });
    MOCK_STATE.localPorts[port] = seedHex || "mock-seed";
  },

  /**
   * @param {string} url
   * @param {number} defaultPort
   */
  exposeRemoteAsLocal: async (url, defaultPort) => {
    callLog.push({ method: "exposeRemoteAsLocal", args: [url, defaultPort] });
    MOCK_STATE.remoteProxies[url] = defaultPort || 0;
  },

  /**
   * @param {string} rootFolder
   * @param {string} seedHex
   */
  exposeFolder: async (rootFolder, seedHex) => {
    callLog.push({ method: "exposeFolder", args: [rootFolder, seedHex] });
    MOCK_STATE.folders[rootFolder] = seedHex || "mock-seed";
  },

  destroy: () => {},
  loadJSON: () => {},
  selectFolder: async () => "/mock/selected/folder",
  getCallLog: () => [...callLog],
  clearCallLog: () => {
    callLog.length = 0;
  },
});
