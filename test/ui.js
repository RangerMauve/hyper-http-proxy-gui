import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { assertEventually } from "./utils/assert-eventually.js";
const { app, BrowserWindow } = electron;

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("UI", () => {
  /** @type {import('electron').BrowserWindow | undefined} */
  let win;

  before(() => {
    return app.whenReady();
  });

  after(() => {
    app.quit();
  });

  test("title is set on document load", async () => {
    win = new BrowserWindow({ show: false, width: 800, height: 600 });
    win.loadFile(join(__dirname, "..", "src", "index.html"));
    await once(win.webContents, "dom-ready");
    const title = await win.webContents.executeJavaScript("document.title");
    assert.equal(title, "Hyper HTTP Proxy");
    win.close();
  });

  test("DOM is populated from proxy state", async () => {
    win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        preload: join(__dirname, "fixtures", "proxy-api-preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // @ts-expect-error preload-error event is not in WebContents event types
    win.webContents.on("preload-error", (_, { preload, error }) => {
      console.error(`Preload error in ${preload}:`, error.message);
    });

    win.loadFile(join(__dirname, "..", "src", "index.html"));
    await once(win.webContents, "dom-ready");

    await assertEventually(async () => {
      assert.ok(win);
      const localText = await win.webContents.executeJavaScript(
        `document.getElementById('localPorts').children[1].textContent`,
      );
      const remoteText = await win.webContents.executeJavaScript(
        `document.getElementById('remotePorts').children[1].textContent`,
      );
      const folderText = await win.webContents.executeJavaScript(
        `document.getElementById('folderPorts').children[1].textContent`,
      );

      assert.ok(localText.includes("Port 3000"));
      assert.ok(remoteText.includes("8080"));
      assert.ok(folderText.includes("/tmp/share"));
    });

    win.close();
  });
});
