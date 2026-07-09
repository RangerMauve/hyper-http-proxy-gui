import { app, BrowserWindow, Tray, Menu, ipcMain } from "electron";
import Hyperdht from "hyperdht";
import { HyperHttpProxy } from "./proxy.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let tray = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

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

app.whenReady().then(() => {
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

  tray.setToolTip("Hyper HTTP Proxy");
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
  console.log("Destroying proxy before quit...");
  await proxy.destroy();
  console.log("Proxy destroyed.");
});

app.on("window-all-closed", () => {
  // Keep the app alive — window is recreated via tray
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
});

// ponytail: DHT + proxy as module-level singletons; no factory needed
const dht = new Hyperdht();
const proxy = new HyperHttpProxy({ dht });

ipcMain.handle("proxy:exposeLocalPort", (_, port, seedHex) =>
  proxy.exposeLocalPort(
    port,
    seedHex ? Buffer.from(seedHex, "hex") : undefined,
  ),
);
ipcMain.handle("proxy:exposeRemoteAsLocal", (_, url, defaultPort) =>
  proxy.exposeRemoteAsLocal(url, defaultPort),
);
ipcMain.handle("proxy:exposeFolder", (_, rootFolder, seedHex) =>
  proxy.exposeFolder(
    rootFolder,
    seedHex ? Buffer.from(seedHex, "hex") : undefined,
  ),
);
ipcMain.handle("proxy:destroy", () => proxy.destroy());
ipcMain.handle("proxy:toJSON", () => proxy.toJSON());
ipcMain.handle("proxy:loadJSON", (_, json) => proxy.loadJSON(json));
