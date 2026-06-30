import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
const { app, BrowserWindow } = electron;

const __dirname = fileURLToPath(new URL(".", import.meta.url));

describe("UI", () => {
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
});
