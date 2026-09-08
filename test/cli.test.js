import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProgram } from "../src/cli.js";
import { Daemon } from "../src/daemon.js";
import { MockProxy } from "./fixtures/mock-proxy.js";

/**
 * Run a CLI command via commander, capturing console output.
 * @param {string[]} args
 * @returns {Promise<{ log: string; err: string }>}
 */
async function runCli(args) {
  /** @type {string[]} */
  const logChunks = [];
  /** @type {string[]} */
  const errChunks = [];

  const origLog = console.log;
  const origErr = console.error;

  console.log = (...a) => {
    logChunks.push(
      a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "),
    );
  };
  console.error = (...a) => {
    errChunks.push(
      a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "),
    );
  };

  try {
    const program = createProgram();
    await program.parseAsync(["node", "setkamost", ...args]);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  return { log: logChunks.join("\n"), err: errChunks.join("\n") };
}

/** @type {string} */
let socketPath;
/** @type {Daemon} */
let daemon;
/** @type {MockProxy} */
let proxy;

describe("CLI", () => {
  before(async () => {
    proxy = new MockProxy();
    socketPath = join(tmpdir(), `setkamost-cli-test-${Date.now()}.sock`);
    const storagePath = join(tmpdir(), `setkamost-cli-test-${Date.now()}-data`);
    daemon = new Daemon({ proxy, socketPath, storagePath });
    await daemon.start();
  });

  after(async () => {
    await daemon.stop();
  });

  describe("list", () => {
    it("returns empty proxy state", async () => {
      const { log } = await runCli(["list", "--socket", socketPath]);
      const state = JSON.parse(log);
      assert.ok(state.localPorts);
      assert.ok(state.remoteProxies);
      assert.ok(state.folders);
      assert.equal(Object.keys(state.localPorts).length, 0);
    });
  });

  describe("expose-local", () => {
    it("exposes a local port and returns a URL", async () => {
      const { log } = await runCli([
        "expose-local",
        "18932",
        "--socket",
        socketPath,
      ]);
      assert.equal(log.trim(), "hyper+http://mock18932/");
    });

    it("list reflects the new exposure", async () => {
      const { log } = await runCli(["list", "--socket", socketPath]);
      const state = JSON.parse(log);
      assert.ok(state.localPorts["18932"], "should have port 18932");
    });
  });

  describe("expose-remote", () => {
    it("exposes a remote URL and returns a local port", async () => {
      const { log } = await runCli([
        "expose-remote",
        "hyper+http://testremote/",
        "--port",
        "18933",
        "--socket",
        socketPath,
      ]);
      assert.equal(log.trim(), "18933");
    });

    it("list reflects the new remote proxy", async () => {
      const { log } = await runCli(["list", "--socket", socketPath]);
      const state = JSON.parse(log);
      assert.ok(
        state.remoteProxies["hyper+http://testremote/"],
        "should have remote proxy",
      );
    });
  });

  describe("expose-folder", () => {
    it("exposes a folder and returns a URL", async () => {
      const { log } = await runCli([
        "expose-folder",
        "/tmp/sharedocs",
        "--socket",
        socketPath,
      ]);
      assert.equal(log.trim(), "hyper+http://mocksharedocs/");
    });

    it("list reflects the new folder exposure", async () => {
      const { log } = await runCli(["list", "--socket", socketPath]);
      const state = JSON.parse(log);
      assert.ok(state.folders["/tmp/sharedocs"], "should have folder");
    });
  });
});
