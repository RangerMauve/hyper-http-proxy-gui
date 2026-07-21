const { contextBridge } = require("electron");

const MOCK_STATE = {
  localPorts: {},
  remoteProxies: {},
  folders: {},
};

/** @type {{ method: string; args: unknown[] }[]} */
const callLog = [];

contextBridge.exposeInMainWorld("proxyApi", {
  toJSON: () => ({ ...MOCK_STATE }),

  exposeLocalPort: async (port, seedHex) => {
    callLog.push({ method: "exposeLocalPort", args: [port, seedHex] });
    MOCK_STATE.localPorts[port] = seedHex || "mock-seed";
  },

  exposeRemoteAsLocal: async (url, defaultPort) => {
    callLog.push({ method: "exposeRemoteAsLocal", args: [url, defaultPort] });
    MOCK_STATE.remoteProxies[url] = defaultPort || 0;
  },

  exposeFolder: async (rootFolder, seedHex) => {
    callLog.push({ method: "exposeFolder", args: [rootFolder, seedHex] });
    MOCK_STATE.folders[rootFolder] = seedHex || "mock-seed";
  },

  destroy: () => {},
  loadJSON: () => {},
  getCallLog: () => [...callLog],
  clearCallLog: () => {
    callLog.length = 0;
  },
});
