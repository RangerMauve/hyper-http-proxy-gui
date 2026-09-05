import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli.js";
import { Daemon } from "../src/daemon.js";
import { MockProxy } from "../test/fixtures/mock-proxy.js";

/**
 * Run a CLI command, capturing console output and stubbing process.exit.
 * @param {() => Promise<void>} fn
 * @returns {Promise<{ log: string; err: string; exitCode: number | null }>}
 */
async function runCli(fn) {
  /** @type {string[]} */
  const logChunks = [];
  /** @type {string[]} */
  const errChunks = [];
  let exitCode = null;

  const origLog = console.log;
  const origErr = console.error;
  const origExit = process.exit;

  console.log = (...args) => {
    logChunks.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  console.error = (...args) => {
    errChunks.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  };

  try {
    await fn();
  } catch (err) {
    // ignore the synthetic process.exit error
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
  }

  return { log: logChunks.join("\n"), err: errChunks.join("\n"), exitCode };
}

/** @type {string} */
let socketPath;
/** @type {Daemon} */
let daemon;
/** @type {MockProxy} */
let proxy;

/** @type {{ SETKAMOST_SOCKET: string }} */
let env = { SETKAMOST_SOCKET: "" };

describe("CLI", () => {
  before(async () => {
    proxy = new MockProxy();
    socketPath = join(tmpdir(), `setkamost-cli-test-${Date.now()}.sock`);
    const storagePath = join(tmpdir(), `setkamost-cli-test-${Date.now()}-data`);
    env.SETKAMOST_SOCKET = socketPath;
    daemon = new Daemon({ proxy, socketPath, storagePath });
    await daemon.start();
  });

  after(async () => {
    await daemon.stop();
  });

  describe("list", () => {
    it("returns empty proxy state", async () => {
      const { log } = await runCli(() => run({ env, args: ["list"] }));
      const state = JSON.parse(log);
      assert.ok(state.localPorts);
      assert.ok(state.remoteProxies);
      assert.ok(state.folders);
      assert.equal(Object.keys(state.localPorts).length, 0);
    });
  });

  describe("expose-local", () => {
    it("exposes a local port and returns a URL", async () => {
      const { log } = await runCli(() =>
        run({ env, args: ["expose-local", "18932"] }),
      );
      assert.equal(log.trim(), "hyper+http://mock18932/");
    });

    it("list reflects the new exposure", async () => {
      const { log } = await runCli(() => run({ env, args: ["list"] }));
      const state = JSON.parse(log);
      assert.ok(state.localPorts["18932"], "should have port 18932");
    });
  });

  describe("expose-remote", () => {
    it("exposes a remote URL and returns a local port", async () => {
      const { log } = await runCli(() =>
        run({
          env,
          args: [
            "expose-remote",
            "hyper+http://testremote/",
            "--port",
            "18933",
          ],
        }),
      );
      assert.equal(log.trim(), "18933");
    });

    it("list reflects the new remote proxy", async () => {
      const { log } = await runCli(() => run({ env, args: ["list"] }));
      const state = JSON.parse(log);
      assert.ok(
        state.remoteProxies["hyper+http://testremote/"],
        "should have remote proxy",
      );
    });
  });

  describe("expose-folder", () => {
    it("exposes a folder and returns a URL", async () => {
      const { log } = await runCli(() =>
        run({ env, args: ["expose-folder", "/tmp/sharedocs"] }),
      );
      assert.equal(log.trim(), "hyper+http://mocksharedocs/");
    });

    it("list reflects the new folder exposure", async () => {
      const { log } = await runCli(() => run({ env, args: ["list"] }));
      const state = JSON.parse(log);
      assert.ok(state.folders["/tmp/sharedocs"], "should have folder");
    });
  });

  describe("help", () => {
    it("prints top-level help", async () => {
      const { log } = await runCli(() => run({ env, args: ["help"] }));
      assert.ok(log.includes("Usage: setkamost"));
      assert.ok(log.includes("daemon"));
      assert.ok(log.includes("list"));
      assert.ok(log.includes("expose-local"));
    });

    it("prints list help", async () => {
      const { log } = await runCli(() =>
        run({ env, args: ["list", "--help"] }),
      );
      assert.ok(log.includes("List all exposed services"));
    });

    it("prints expose-local help", async () => {
      const { log } = await runCli(() =>
        run({ env, args: ["expose-local", "--help"] }),
      );
      assert.ok(log.includes("Expose a local HTTP port"));
    });
  });

  describe("error cases", () => {
    it("unknown command prints error and exits 1", async () => {
      const { err, exitCode } = await runCli(() =>
        run({ env, args: ["bogus"] }),
      );
      assert.equal(exitCode, 1);
      assert.ok(err.includes("Unknown command: bogus"));
    });

    it("missing daemon subcommand prints error and exits 1", async () => {
      const { err, exitCode } = await runCli(() =>
        run({ env, args: ["daemon"] }),
      );
      assert.equal(exitCode, 1);
      assert.ok(err.includes("missing subcommand"));
    });

    it("unknown daemon subcommand prints error and exits 1", async () => {
      const { err, exitCode } = await runCli(() =>
        run({ env, args: ["daemon", "restart"] }),
      );
      assert.equal(exitCode, 1);
      assert.ok(err.includes("Unknown daemon subcommand: restart"));
    });

    it("expose-local with missing port prints error and exits 1", async () => {
      const { err, exitCode } = await runCli(() =>
        run({ env, args: ["expose-local"] }),
      );
      assert.equal(exitCode, 1);
      assert.ok(err.includes("missing <port> argument"));
    });

    it("expose-remote with missing url prints error and exits 1", async () => {
      const { err, exitCode } = await runCli(() =>
        run({ env, args: ["expose-remote"] }),
      );
      assert.equal(exitCode, 1);
      assert.ok(err.includes("missing <url> argument"));
    });

    it("expose-folder with missing path prints error and exits 1", async () => {
      const { err, exitCode } = await runCli(() =>
        run({ env, args: ["expose-folder"] }),
      );
      assert.equal(exitCode, 1);
      assert.ok(err.includes("missing <path> argument"));
    });
  });
});
