import { createServer } from "node:net";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { JsonRpc } from "./jsonrpc.js";

/**
 * @import {HyperHttpProxy} from "./proxy.js"
 */

/**
 * @typedef {Pick<HyperHttpProxy, "toJSON" | "loadJSON" | "list" | "exposeLocalPort" | "exposeRemoteAsLocal" | "exposeFolder">} ProxyMethods
 */

/**
 * Async existence check (fs/promises has no `exists`).
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unix domain socket server exposing proxy methods via JSON-RPC.
 */
export class Daemon {
  /** @type {ProxyMethods} */
  #proxy;
  /** @type {string} */
  #socketPath;
  /** @type {string} */
  #storagePath;
  /** @type {import("net").Server | null} */
  #server = null;

  /**
   * @param {object} options
   * @param {ProxyMethods} options.proxy - Proxy instance to expose
   * @param {string} options.socketPath - Path for the Unix domain socket
   * @param {string} options.storagePath - Directory used to persist state (state.json)
   */
  constructor({ proxy, socketPath, storagePath }) {
    this.#proxy = proxy;
    this.#socketPath = socketPath;
    this.#storagePath = storagePath;
  }

  /**
   * Start listening on the socket.
   * @returns {Promise<string>} Resolved socket path
   */
  async start() {
    // Restore persisted proxy state before accepting connections
    await this.#loadState();

    // Clean up stale socket file
    if (await fileExists(this.#socketPath)) {
      await unlink(this.#socketPath);
    }

    return new Promise((resolve, reject) => {
      this.#server = createServer((socket) => {
        this.#onConnection(socket);
      });

      this.#server.on("error", (err) => {
        this.#server = null;
        reject(err);
      });

      this.#server.listen(this.#socketPath, () => {
        // Write PID file, then signal ready once it's on disk
        const pidPath = this.#socketPath + ".pid";
        writeFile(pidPath, String(process.pid))
          .then(() => resolve(this.#socketPath))
          .catch(reject);
      });
    });
  }

  /**
   * Stop the server and clean up.
   */
  async stop() {
    // Persist final proxy state before shutting down
    await this.#saveState();

    /** @type {Promise<void>} */
    const closed = new Promise((resolve, reject) => {
      if (!this.#server) {
        resolve();
        return;
      }
      this.#server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    await closed;
    this.#server = null;
    await this.#cleanup();
  }

  /**
   * Handle a new client connection.
   * @param {import("net").Socket} socket
   */
  #onConnection(socket) {
    const rpc = new JsonRpc(socket);

    rpc.register("list", () => this.#proxy.list());
    /**
     * @param {unknown} port
     * @param {unknown} seedHex
     */
    const handleExposeLocalPort = async (port, seedHex) => {
      const result = await this.#proxy.exposeLocalPort(
        Number(port),
        /** @type {Buffer | undefined} */ (seedHex || undefined),
      );
      await this.#saveState();
      return result;
    };
    rpc.register("exposeLocalPort", handleExposeLocalPort);

    /**
     * @param {unknown} url
     * @param {unknown} port
     */
    const handleExposeRemoteAsLocal = async (url, port) => {
      const result = await this.#proxy.exposeRemoteAsLocal(
        String(url),
        port ? Number(port) : 0,
      );
      await this.#saveState();
      return result;
    };
    rpc.register("exposeRemoteAsLocal", handleExposeRemoteAsLocal);

    /**
     * @param {unknown} rootFolder
     * @param {unknown} seedHex
     */
    const handleExposeFolder = async (rootFolder, seedHex) => {
      const folder = String(rootFolder);
      if (!isAbsolute(folder)) {
        throw new Error(`Folder path must be absolute, got: ${folder}`);
      }
      const result = await this.#proxy.exposeFolder(
        folder,
        /** @type {Buffer | undefined} */ (seedHex || undefined),
      );
      await this.#saveState();
      return result;
    };
    rpc.register("exposeFolder", handleExposeFolder);

    socket.on("error", () => {
      // Connection errors are expected when clients disconnect
    });
  }

  /**
   * Absolute path to the persisted state file.
   * @returns {string}
   */
  #stateFile() {
    return join(this.#storagePath, "state.json");
  }

  /**
   * Restore persisted proxy state from storage, if a state file exists.
   * @returns {Promise<void>}
   */
  async #loadState() {
    try {
      const stateFile = this.#stateFile();
      if (!(await fileExists(stateFile))) return;
      const raw = await readFile(stateFile, "utf8");
      /** @type {Parameters<ProxyMethods["loadJSON"]>[0]} */
      const state = JSON.parse(raw);
      await this.#proxy.loadJSON(state);
    } catch {
      // A missing or corrupt state file must not prevent startup
    }
  }

  /**
   * Persist the current proxy state to storage.
   * @returns {Promise<void>}
   */
  async #saveState() {
    try {
      await mkdir(this.#storagePath, { recursive: true });
      await writeFile(
        this.#stateFile(),
        JSON.stringify(this.#proxy.toJSON(), null, 2),
      );
    } catch {
      // Best effort — persistence must not break the RPC or shutdown
    }
  }

  /**
   * Clean up socket and PID files.
   * @returns {Promise<void>}
   */
  async #cleanup() {
    try {
      const pidPath = this.#socketPath + ".pid";
      if (await fileExists(pidPath)) {
        await unlink(pidPath);
      }
      if (await fileExists(this.#socketPath)) {
        await unlink(this.#socketPath);
      }
    } catch {
      // Best effort cleanup
    }
  }
}
