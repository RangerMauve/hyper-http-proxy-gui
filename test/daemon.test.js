import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../src/daemon.js";
import { JsonRpc } from "../src/jsonrpc.js";
import { MockProxy } from "../test/fixtures/mock-proxy.js";

/** @typedef {import("../src/daemon.js").ProxyMethods} ProxyMethods */

/** @type {string} */
let socketPath;
/** @type {Daemon} */
let daemon;
/** @type {MockProxy} */
let proxy;

describe("Daemon", () => {
  before(async () => {
    proxy = new MockProxy();
    socketPath = join(tmpdir(), `setkamost-test-${Date.now()}.sock`);
    const storagePath = join(tmpdir(), `setkamost-test-${Date.now()}-data`);
    daemon = new Daemon({ proxy, socketPath, storagePath });
  });

  after(async () => {
    await daemon.stop();
  });

  /**
   * @param {string} [path]
   * @returns {Promise<JsonRpc>}
   */
  async function connectClient(path = socketPath) {
    return new Promise((resolve, reject) => {
      const socket = connect(path, () => {
        resolve(new JsonRpc(socket));
      });
      socket.on("error", reject);
    });
  }

  describe("lifecycle", () => {
    it("starts and creates socket file", async () => {
      const path = await daemon.start();
      assert.equal(path, socketPath);
      assert.ok(existsSync(socketPath), "socket file should exist");
    });

    it("writes PID file on start", async () => {
      assert.ok(existsSync(socketPath + ".pid"), "PID file should exist");
    });

    it("cleans up files on stop", async () => {
      await daemon.stop();
      assert.ok(!existsSync(socketPath), "socket file should be removed");
      assert.ok(!existsSync(socketPath + ".pid"), "PID file should be removed");
    });
  });

  describe("RPC methods", () => {
    before(async () => {
      await daemon.start();
    });

    it("list returns proxy state", async () => {
      const client = await connectClient();
      const state = /** @type {ReturnType<ProxyMethods["toJSON"]>} */ (
        await client.call("list")
      );
      assert.ok(state.localPorts);
      assert.ok(state.remoteProxies);
      assert.ok(state.folders);
      client.destroy();
    });

    it("list returns proxy state with seeds and urls", async () => {
      const client = await connectClient();
      const port = 18940;
      await client.call("exposeLocalPort", [port]);
      const list = /** @type {ReturnType<ProxyMethods["list"]>} */ (
        await client.call("list")
      );
      assert.ok(list.localPorts, "has localPorts");
      assert.ok(list.remoteProxies, "has remoteProxies");
      assert.ok(list.folders, "has folders");
      const entry = list.localPorts[port];
      assert.ok(entry, "localPorts contains the exposed port");
      assert.equal(entry.url, `hyper+http://mock${port}/`);
      assert.equal(typeof entry.seed, "string");
      assert.ok(entry.seed.length > 0, "seed is non-empty");
      client.destroy();
    });

    it("exposeLocalPort returns a hyper+http URL", async () => {
      const client = await connectClient();
      const url = await client.call("exposeLocalPort", [18932]);
      assert.equal(url, "hyper+http://mock18932/");
      client.destroy();
    });

    it("exposeRemoteAsLocal returns a local port", async () => {
      const client = await connectClient();
      const port = await client.call("exposeRemoteAsLocal", [
        "hyper+http://dummy123/",
        18933,
      ]);
      assert.equal(port, 18933);
      client.destroy();
    });

    it("exposeFolder returns a hyper+http URL", async () => {
      const client = await connectClient();
      const url = await client.call("exposeFolder", ["/tmp/share"]);
      assert.equal(url, "hyper+http://mockshare/");
      client.destroy();
    });

    it("multiple clients can connect simultaneously", async () => {
      const client1 = await connectClient();
      const client2 = await connectClient();
      const [state1, state2] =
        /** @type {ReturnType<ProxyMethods["toJSON"]>[]} */ (
          await Promise.all([client1.call("list"), client2.call("list")])
        );
      assert.ok(state1.localPorts);
      assert.ok(state2.localPorts);
      client1.destroy();
      client2.destroy();
    });
  });

  describe("persistence", () => {
    /** @type {string} */
    let persistSocket;
    /** @type {string} */
    let persistStorage;

    before(() => {
      persistSocket = join(tmpdir(), `setkamost-persist-${Date.now()}.sock`);
      persistStorage = join(tmpdir(), `setkamost-persist-${Date.now()}-data`);
    });

    it("saves state between api calls and reloads it on restart", async () => {
      const stateFile = join(persistStorage, "state.json");
      const port = 18950;

      // Phase 1: exposing a port writes state right after the call
      const proxyA = new MockProxy();
      const daemonA = new Daemon({
        proxy: proxyA,
        socketPath: persistSocket,
        storagePath: persistStorage,
      });
      await daemonA.start();
      const clientA = await connectClient(persistSocket);
      await clientA.call("exposeLocalPort", [port]);
      clientA.destroy();

      assert.ok(
        existsSync(stateFile),
        "state file is written between api calls, not only on stop",
      );
      const saved = JSON.parse(await readFile(stateFile, "utf8"));
      assert.ok(
        saved.localPorts[port],
        "exposed port is on disk between calls",
      );

      // Stop daemon A (removes the socket, keeps the state file)
      await daemonA.stop();

      // Phase 2: a fresh proxy + daemon on the same storage reloads the state
      const proxyB = new MockProxy();
      const daemonB = new Daemon({
        proxy: proxyB,
        socketPath: persistSocket,
        storagePath: persistStorage,
      });
      await daemonB.start();
      const clientB = await connectClient(persistSocket);
      const list = /** @type {ReturnType<ProxyMethods["list"]>} */ (
        await clientB.call("list")
      );
      const reloaded = list.localPorts[port];
      assert.ok(reloaded, "port is reloaded from persisted state on start");
      assert.equal(
        reloaded.url,
        `hyper+http://mock${port}/`,
        "reloaded port keeps its url",
      );
      clientB.destroy();
      await daemonB.stop();
    });
  });
});
