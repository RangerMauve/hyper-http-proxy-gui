import { app, BrowserWindow, Tray, Menu } from "electron";
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

app.on("window-all-closed", () => {
  // Keep the app alive — window is recreated via tray
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
});
