import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { existsSync } from "node:fs";
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
    daemon = new Daemon({ proxy, socketPath });
  });

  after(async () => {
    await daemon.stop();
  });

  /**
   * @returns {Promise<JsonRpc>}
   */
  async function connectClient() {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath, () => {
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
});
