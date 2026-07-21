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
        `document.getElementById('localPorts').children[0].textContent`,
      );
      const remoteText = await win.webContents.executeJavaScript(
        `document.getElementById('remotePorts').children[0].textContent`,
      );
      const folderText = await win.webContents.executeJavaScript(
        `document.getElementById('folderPorts').children[0].textContent`,
      );

      assert.ok(localText.includes("Port 3000"));
      assert.ok(remoteText.includes("8080"));
      assert.ok(folderText.includes("/tmp/share"));
    });

    win.close();
  });

  describe("forms trigger API calls", () => {
    /** @type {import('electron').BrowserWindow | undefined} */
    let formWin;

    async function createFormWindow() {
      formWin = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          preload: join(__dirname, "fixtures", "proxy-api-mock-preload.js"),
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      // @ts-expect-error preload-error event is not in WebContents event types
      formWin.webContents.on("preload-error", (_, { preload, error }) => {
        console.error(`Preload error in ${preload}:`, error.message);
      });

      formWin.loadFile(join(__dirname, "..", "src", "index.html"));
      await once(formWin.webContents, "dom-ready");
      // Wait for loadState to finish
      await new Promise((r) => setTimeout(r, 200));
    }

    after(() => {
      if (formWin && !formWin.isDestroyed()) {
        formWin.close();
      }
    });

    test("submitting Expose Local form calls exposeLocalPort", async () => {
      await createFormWindow();
      assert.ok(formWin);

      await formWin.webContents.executeJavaScript(`
        const form = document.getElementById('addLocalPort');
        form.querySelector('[name="port"]').value = '4000';
        form.requestSubmit();
      `);

      await new Promise((r) => setTimeout(r, 200));

      const log = await formWin.webContents.executeJavaScript(
        "window.proxyApi.getCallLog()"
      );
      assert.equal(log.length, 1);
      assert.equal(log[0].method, "exposeLocalPort");
      assert.equal(log[0].args[0], 4000);

      formWin.close();
    });

    test("submitting Expose Remote form calls exposeRemoteAsLocal", async () => {
      await createFormWindow();
      assert.ok(formWin);

      await formWin.webContents.executeJavaScript(`
        const form = document.getElementById('addRemotePort');
        form.querySelector('[name="url"]').value = 'hyper://test123';
        form.querySelector('[name="defaultPort"]').value = '9090';
        form.requestSubmit();
      `);

      await new Promise((r) => setTimeout(r, 200));

      const log = await formWin.webContents.executeJavaScript(
        "window.proxyApi.getCallLog()"
      );
      assert.equal(log.length, 1);
      assert.equal(log[0].method, "exposeRemoteAsLocal");
      assert.equal(log[0].args[0], "hyper://test123");
      assert.equal(log[0].args[1], 9090);

      formWin.close();
    });

    test("submitting Expose Remote form without port passes 0", async () => {
      await createFormWindow();
      assert.ok(formWin);

      await formWin.webContents.executeJavaScript(`
        const form = document.getElementById('addRemotePort');
        form.querySelector('[name="url"]').value = 'hyper://test456';
        form.requestSubmit();
      `);

      await new Promise((r) => setTimeout(r, 200));

      const log = await formWin.webContents.executeJavaScript(
        "window.proxyApi.getCallLog()"
      );
      assert.equal(log.length, 1);
      assert.equal(log[0].method, "exposeRemoteAsLocal");
      assert.equal(log[0].args[1], 0);

      formWin.close();
    });

    test("submitting Share Folders form calls exposeFolder", async () => {
      await createFormWindow();
      assert.ok(formWin);

      await formWin.webContents.executeJavaScript(`
        const form = document.getElementById('addFolder');
        form.querySelector('[name="rootFolder"]').value = '/home/user/docs';
        form.requestSubmit();
      `);

      await new Promise((r) => setTimeout(r, 200));

      const log = await formWin.webContents.executeJavaScript(
        "window.proxyApi.getCallLog()"
      );
      assert.equal(log.length, 1);
      assert.equal(log[0].method, "exposeFolder");
      assert.equal(log[0].args[0], "/home/user/docs");

      formWin.close();
    });
  });
});
