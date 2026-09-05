import { app, BrowserWindow, Tray, Menu, ipcMain, dialog } from "electron";
import { connect } from "node:net";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { JsonRpc } from "./jsonrpc.js";
import { Daemon } from "./daemon.js";
import Hyperdht from "hyperdht";
import { HyperHttpProxy } from "./proxy.js";
import xdg from "xdg-portable";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import("xdg-portable").XDG} */
// @ts-ignore default export is callable at runtime but types differ
const xdgInstance = xdg;

function defaultSocketPath() {
  const runtime = xdgInstance.runtime();
  const baseDir = runtime || join(xdgInstance.state(), "setkamost");
  return join(baseDir, "sock");
}

const SOCKET_PATH = defaultSocketPath();

let tray = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {JsonRpc | null} */
let rpcClient = null;
/** @type {Daemon | null} */
let daemon = null;
/** @type {boolean} */
let ownsDaemon = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(join(__dirname, "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Connect to an existing daemon or start a new one.
 * Returns the initial proxy state so the window can load with data ready.
 */
async function ensureDaemon() {
  // Try connecting to an existing daemon
  if (existsSync(SOCKET_PATH)) {
    try {
      rpcClient = await connectToDaemon(SOCKET_PATH);
      ownsDaemon = false;
      const result = await rpcClient.call("list");
      return result;
    } catch {
      // Existing socket but daemon not responding — will start a new one
    }
  }

  // No running daemon — start one in-process
  const dht = new Hyperdht();
  const proxy = new HyperHttpProxy({ dht });
  const storagePath = app.getPath("userData");
  daemon = new Daemon({ proxy, socketPath: SOCKET_PATH, storagePath });
  await daemon.start();

  // Connect our own client to it
  rpcClient = await connectToDaemon(SOCKET_PATH);
  ownsDaemon = true;
  const result = await rpcClient.call("list");
  return result;
}

/**
 * @param {string} socketPath
 * @returns {Promise<JsonRpc>}
 */
function connectToDaemon(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => {
      resolve(new JsonRpc(socket));
    });
    socket.on("error", reject);
  });
}

app.whenReady().then(async () => {
  const initialState = await ensureDaemon();
  console.log("Daemon ready", initialState);

  createWindow();

  tray = new Tray(join(__dirname, "../assets/tray-icon.png"));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else {
          mainWindow.show();
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);

  tray.setToolTip("Setkamost");
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on("before-quit", async () => {
  if (rpcClient) {
    rpcClient.destroy();
    rpcClient = null;
  }
  if (ownsDaemon && daemon) {
    await daemon.stop();
  }
});

app.on("window-all-closed", () => {
  // Keep the app alive — window is recreated via tray
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
});

// IPC handlers — all go through the daemon's JSON-RPC
ipcMain.handle("proxy:exposeLocalPort", async (_, port, seedHex) => {
  return getRpc().call("exposeLocalPort", [
    port,
    seedHex ? seedHex : undefined,
  ]);
});

ipcMain.handle("proxy:exposeRemoteAsLocal", async (_, url, defaultPort) => {
  return getRpc().call("exposeRemoteAsLocal", [url, defaultPort || 0]);
});

ipcMain.handle("proxy:exposeFolder", async (_, rootFolder, seedHex) => {
  return getRpc().call("exposeFolder", [
    rootFolder,
    seedHex ? seedHex : undefined,
  ]);
});

ipcMain.handle("proxy:destroy", async () => {
  if (ownsDaemon && daemon) {
    await daemon.stop();
  }
  if (rpcClient) {
    rpcClient.destroy();
    rpcClient = null;
  }
});

ipcMain.handle("proxy:toJSON", async () => {
  return getRpc().call("list");
});

ipcMain.handle("proxy:list", async () => {
  return getRpc().call("list");
});

// loadJSON is not a daemon RPC method — proxy doesn't expose it
// For now, pass through (no-op) since state management is handled by the daemon
ipcMain.handle("proxy:loadJSON", () => Promise.resolve());

ipcMain.handle("selectFolder", async () => {
  // @ts-expect-error The rpc can't get called without a window
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.filePaths[0] || null;
});

/**
 * Assert the RPC client is connected and return it.
 * @returns {JsonRpc}
 * @throws {Error} when rpc client is not available
 */
function getRpc() {
  if (!rpcClient) throw new Error("Daemon not connected");
  return rpcClient;
}
