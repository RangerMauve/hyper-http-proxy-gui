import { createServer } from "node:net";
import { existsSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { JsonRpc } from "./jsonrpc.js";

/**
 * @import {HyperHttpProxy} from "./proxy.js"
 */

/**
 * @typedef {Pick<HyperHttpProxy, "toJSON" | "exposeLocalPort" | "exposeRemoteAsLocal" | "exposeFolder">} ProxyMethods
 */

/**
 * Unix domain socket server exposing proxy methods via JSON-RPC.
 */
export class Daemon {
  /** @type {ProxyMethods} */
  #proxy;
  /** @type {string} */
  #socketPath;
  /** @type {import("net").Server | null} */
  #server = null;

  /**
   * @param {object} options
   * @param {ProxyMethods} options.proxy - Proxy instance to expose
   * @param {string} options.socketPath - Path for the Unix domain socket
   */
  constructor({ proxy, socketPath }) {
    this.#proxy = proxy;
    this.#socketPath = socketPath;
  }

  /**
   * Start listening on the socket.
   * @returns {Promise<string>} Resolved socket path
   */
  async start() {
    // Clean up stale socket file
    if (existsSync(this.#socketPath)) {
      unlinkSync(this.#socketPath);
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
        // Write PID file
        const pidPath = this.#socketPath + ".pid";
        writeFileSync(pidPath, String(process.pid));
        /** @type {(v: string) => void} */ resolve(this.#socketPath);
      });
    });
  }

  /**
   * Stop the server and clean up.
   */
  async stop() {
    /** @type {Promise<void>} */
    const promise = new Promise((resolve, reject) => {
      /** @type {(err?: Error) => void} */
      const done = (err) => {
        this.#server = null;
        this.#cleanup();
        if (err) reject(err);
        else resolve();
      };

      if (!this.#server) {
        this.#cleanup();
        done();
        return;
      }

      this.#server.close(done);
    });
    return promise;
  }

  /**
   * Handle a new client connection.
   * @param {import("net").Socket} socket
   */
  #onConnection(socket) {
    const rpc = new JsonRpc(socket);

    rpc.register("list", () => this.#proxy.toJSON());
    /**
     * @param {unknown} port
     * @param {unknown} seedHex
     */
    const handleExposeLocalPort = (port, seedHex) =>
      this.#proxy.exposeLocalPort(
        Number(port),
        /** @type {Buffer | undefined} */ (seedHex || undefined),
      );
    rpc.register("exposeLocalPort", handleExposeLocalPort);

    /**
     * @param {unknown} url
     * @param {unknown} port
     */
    const handleExposeRemoteAsLocal = (url, port) =>
      this.#proxy.exposeRemoteAsLocal(String(url), port ? Number(port) : 0);
    rpc.register("exposeRemoteAsLocal", handleExposeRemoteAsLocal);

    /**
     * @param {unknown} rootFolder
     * @param {unknown} seedHex
     */
    const handleExposeFolder = (rootFolder, seedHex) =>
      this.#proxy.exposeFolder(
        String(rootFolder),
        /** @type {Buffer | undefined} */ (seedHex || undefined),
      );
    rpc.register("exposeFolder", handleExposeFolder);

    socket.on("error", () => {
      // Connection errors are expected when clients disconnect
    });
  }

  /**
   * Clean up socket and PID files.
   */
  #cleanup() {
    try {
      const pidPath = this.#socketPath + ".pid";
      if (existsSync(pidPath)) {
        unlinkSync(pidPath);
      }
      if (existsSync(this.#socketPath)) {
        unlinkSync(this.#socketPath);
      }
    } catch {
      // Best effort cleanup
    }
  }
}
