const { contextBridge } = require("electron");

const MOCK_STATE = {
  localPorts: {
    3000: "deadbeef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  },
  remoteProxies: { "hyper://abc123": 8080 },
  folders: {
    "/tmp/share":
      "cafebabe0123456789abcdef0123456789abcdef0123456789abcdef01234567",
  },
};

contextBridge.exposeInMainWorld("proxyApi", {
  toJSON: () => MOCK_STATE,
  selectFolder: async () => "/tmp/share",
});
