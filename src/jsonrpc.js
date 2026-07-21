import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";

/**
 * @typedef {object} JsonRequest
 * @property {"2.0"} jsonrpc
 * @property {number} [id]
 * @property {string} method
 * @property {unknown[]} [params]
 */

/**
 * @typedef {object} JsonSuccess
 * @property {"2.0"} jsonrpc
 * @property {number} id
 * @property {unknown} result
 */

/**
 * @typedef {object} JsonError
 * @property {"2.0"} jsonrpc
 * @property {number} id
 * @property {{code: number, message: string}} error
 */

/**
 * @typedef {JsonSuccess | JsonError} JsonResponse
 */

/**
 * JSON-RPC 2.0 over a Node.js Duplex stream.
 *
 * Each message is a single JSON object terminated by `\n`.
 * Supports requests, responses, notifications, and errors.
 */
export class JsonRpc extends EventEmitter {
  /** @type {Duplex} */
  #stream;
  /** @type {Map<string, {resolve: Function, reject: Function}>} */
  #pending = new Map();
  /** @type {Map<string, Function>} */
  #handlers = new Map();
  /** @type {number} */
  #nextId = 1;
  /** @type {Buffer} */
  #buffer;
  /** @type {number} */
  #used = 0;

  /**
   * @param {Duplex} stream - Duplex stream to communicate over
   */
  constructor(stream) {
    super();
    this.#stream = stream;
    this.#buffer = Buffer.alloc(8192); // 8KB initial
    this.#onData();
    this.#onClose();
  }

  /**
   * Register a method that can be called by the remote peer.
   * @param {string} name
   * @param {(...args: unknown[]) => unknown} handler
   */
  register(name, handler) {
    this.#handlers.set(name, handler);
  }

  /**
   * Call a method on the remote peer.
   * @param {string} method
   * @param {unknown[]} [params]
   * @returns {Promise<unknown>}
   */
  async call(method, params = []) {
    const id = this.#nextId++;
    const request = { jsonrpc: "2.0", id, method, params };
    const envelope = JSON.stringify(request) + "\n";

    return new Promise((resolve, reject) => {
      this.#pending.set(String(id), { resolve, reject });
      this.#stream.write(envelope, (err) => {
        if (err) {
          this.#pending.delete(String(id));
          reject(err);
        }
      });
    });
  }

  /**
   * Send a notification (no response expected).
   * @param {string} method
   * @param {unknown[]} [params]
   */
  notify(method, params = []) {
    const request = { jsonrpc: "2.0", method, params };
    this.#stream.write(JSON.stringify(request) + "\n");
  }

  /**
   * Feed incoming data from the stream.
   */
  #onData() {
    this.#stream.on("data", (chunk) => {
      // Grow buffer if needed
      if (this.#used + chunk.length > this.#buffer.length) {
        const newSize = Math.max(
          this.#buffer.length * 2,
          this.#used + chunk.length,
        );
        const newBuf = Buffer.alloc(newSize);
        this.#buffer.copy(newBuf, 0, 0, this.#used);
        this.#buffer = newBuf;
      }
      chunk.copy(this.#buffer, this.#used);
      this.#used += chunk.length;

      // Extract complete lines and compact
      let start = 0;
      let newlineIdx;
      while ((newlineIdx = this.#buffer.indexOf(10, start)) !== -1) {
        // 10 = '\n'
        const line = this.#buffer.toString("utf8", start, newlineIdx);
        start = newlineIdx + 1;
        this.#handleMessage(line);
      }
      // Compact: move remaining bytes to front
      const remaining = this.#used - start;
      if (remaining > 0) {
        this.#buffer.copy(this.#buffer, 0, start, this.#used);
      }
      this.#used = remaining;
    });
  }

  /**
   * Handle stream close/errors.
   */
  #onClose() {
    this.#stream.on("close", () => {
      this.#rejectPending(new Error("Stream closed"));
      this.emit("close");
    });
    this.#stream.on("error", (err) => {
      this.#rejectPending(err);
      this.emit("error", err);
    });
  }

  /**
   * Parse and dispatch a single JSON line.
   * @param {string} line
   */
  #handleMessage(line) {
    /** @type {any} */
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.#sendError(null, -32700, "Parse error");
      return;
    }

    // Response to a pending request
    if (
      (msg.id !== undefined && msg.result !== undefined) ||
      msg.error !== undefined
    ) {
      this.#handleResponse(msg);
      return;
    }

    // Incoming request or notification
    if (typeof msg.method === "string") {
      this.#handleRequest(msg);
    }
  }

  /**
   * Handle an incoming request.
   * @param {any} msg
   */
  async #handleRequest(msg) {
    const handler = this.#handlers.get(msg.method);
    if (!handler) {
      this.#sendError(msg.id, -32601, `Method not found: ${msg.method}`);
      return;
    }

    if (msg.id === undefined) {
      // Notification — fire and forget
      try {
        await handler(...(msg.params || []));
      } catch {
        // Notifications don't get error responses
      }
      return;
    }

    try {
      const result = await handler(...(msg.params || []));
      this.#sendResult(msg.id, result);
    } catch (err) {
      this.#sendError(
        msg.id,
        -32603,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Handle an incoming response.
   * @param {any} msg
   */
  #handleResponse(msg) {
    const key = String(msg.id);
    const pending = this.#pending.get(key);
    if (!pending) return;
    this.#pending.delete(key);

    if (msg.error) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  /**
   * Send a successful response.
   * @param {number} id
   * @param {unknown} result
   */
  #sendResult(id, result) {
    const resp = { jsonrpc: "2.0", id, result };
    this.#stream.write(JSON.stringify(resp) + "\n");
  }

  /**
   * Send an error response.
   * @param {number | null} id
   * @param {number} code
   * @param {string} message
   */
  #sendError(id, code, message) {
    if (id === null) return; // parse errors with no ID can't be responded to
    const resp = { jsonrpc: "2.0", id, error: { code, message } };
    this.#stream.write(JSON.stringify(resp) + "\n");
  }

  /**
   * Reject all pending requests with an error.
   * @param {Error} err
   */
  #rejectPending(err) {
    for (const [, { reject }] of this.#pending) {
      reject(err);
    }
    this.#pending.clear();
  }

  /**
   * Destroy the underlying stream and clean up.
   */
  destroy() {
    this.#stream.destroy();
    this.#rejectPending(new Error("Destroyed"));
  }
}
