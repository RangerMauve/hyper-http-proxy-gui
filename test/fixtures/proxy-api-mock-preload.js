const { contextBridge } = require("electron");

/**
 * @typedef {object} MockState
 * @property {Record<string, {seed: string, url: string}>} localPorts
 * @property {Record<string, {port: number}>} remoteProxies
 * @property {Record<string, {seed: string, url: string}>} folders
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
  toJSON: () => {
    /** @type {{ localPorts: Record<string, string>, remoteProxies: Record<string, number>, folders: Record<string, string> }} */
    const result = { localPorts: {}, remoteProxies: {}, folders: {} };
    for (const [port, { seed }] of Object.entries(MOCK_STATE.localPorts)) {
      result.localPorts[port] = seed;
    }
    for (const [url, { port }] of Object.entries(MOCK_STATE.remoteProxies)) {
      result.remoteProxies[url] = port;
    }
    for (const [folder, { seed }] of Object.entries(MOCK_STATE.folders)) {
      result.folders[folder] = seed;
    }
    return result;
  },

  list: () => ({
    localPorts: { ...MOCK_STATE.localPorts },
    remoteProxies: { ...MOCK_STATE.remoteProxies },
    folders: { ...MOCK_STATE.folders },
  }),

  /**
   * @param {number} port
   * @param {string} seedHex
   */
  exposeLocalPort: async (port, seedHex) => {
    callLog.push({ method: "exposeLocalPort", args: [port, seedHex] });
    MOCK_STATE.localPorts[port] = {
      seed: seedHex || "mock-seed",
      url: `hyper+http://mock${port}/`,
    };
  },

  /**
   * @param {string} url
   * @param {number} defaultPort
   */
  exposeRemoteAsLocal: async (url, defaultPort) => {
    callLog.push({ method: "exposeRemoteAsLocal", args: [url, defaultPort] });
    MOCK_STATE.remoteProxies[url] = { port: defaultPort || 0 };
  },

  /**
   * @param {string} rootFolder
   * @param {string} seedHex
   */
  exposeFolder: async (rootFolder, seedHex) => {
    callLog.push({ method: "exposeFolder", args: [rootFolder, seedHex] });
    MOCK_STATE.folders[rootFolder] = {
      seed: seedHex || "mock-seed",
      url: `hyper+http://mock${rootFolder.split("/").pop()}/`,
    };
  },

  destroy: () => {},
  loadJSON: () => {},
  selectFolder: async () => "/mock/selected/folder",
  getCallLog: () => [...callLog],
  clearCallLog: () => {
    callLog.length = 0;
  },
});
