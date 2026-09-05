const { contextBridge } = require("electron");

const MOCK_STATE = {
  localPorts: {
    3000: {
      seed: "deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
      url: "hyper+http://mock3000/",
    },
  },
  remoteProxies: { "hyper://abc123": { port: 8080 } },
  folders: {
    "/tmp/share": {
      seed: "cafebabe0123456789abcdef0123456789abcdef0123456789abcdef01234567",
      url: "hyper+http://mockshare/",
    },
  },
};

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
  selectFolder: async () => "/tmp/share",
});
