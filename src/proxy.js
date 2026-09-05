// @ts-ignore
import Hyperdht from "hyperdht";
import net from "node:net";
import { makeURL, parseURL } from "./urls.js";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";
import { makeFileServer } from "./fileserver.js";

/** @typedef {import("hyperdht").KeyPair} KeyPair */

/**
 * @typedef {() => Promise<void>} OnDestroy
 */

/**
 * @param {Error} e
 */
export function DEFAULT_ON_ERROR(e) {
  console.error(e);
}

/**
 * Map of local ports and the seed keys for them
 * @typedef {Record<number, string>} ProxyJSONLocalPorts
 */

/**
 * Map of URLs to ports to proxy them under
 * @typedef {Record<string, number>} ProxyJSONRemoteProxies
 */

/**
 * Map of local file paths to seed keys for them
 * @typedef {Record<string, string>} ProxyJSONFolders
 */

/**
 * @typedef {object} ProxyJSON
 * @property {ProxyJSONFolders} folders
 * @property {ProxyJSONLocalPorts} localPorts
 * @property {ProxyJSONRemoteProxies} remoteProxies
 */

/**
 * @typedef {Record<number, {seed: string, url: string}>} ProxyListLocalPorts
 */

/**
 * @typedef {Record<string, {seed: string, url: string}>} ProxyListFolders
 */

/**
 * @typedef {Record<string, {port: number}>} ProxyListRemoteProxies
 */

/**
 * @typedef {object} ProxyList
 * @property {ProxyListFolders} folders
 * @property {ProxyListLocalPorts} localPorts
 * @property {ProxyListRemoteProxies} remoteProxies
 */

export class HyperHttpProxy {
  #dht;
  /** @type {Map<number, {seed: Buffer, url: string, destroy: OnDestroy}>} */
  #localPorts = new Map();
  /** @type {Map<string, {seed: Buffer, url: string, destroy: OnDestroy}>} */
  #folders = new Map();
  /** @type {Map<string, {port: number, destroy: OnDestroy}>} */
  #remoteProxies = new Map();

  #onError;

  /**
   * @param {object} options
   * @param {Hyperdht} options.dht
   * @param {(err:Error) => void} [options.onError]
   */
  constructor({ dht, onError = DEFAULT_ON_ERROR }) {
    this.#dht = dht;
    this.#onError = onError;
  }
  /**
   * Take a local port and expose it over Hyperdht
   * @param {number} port Local HTTP port to expose
   * @param {Buffer} [seed] Seed to use for the server's keypair
   * @returns {Promise<string>} URL of service
   */
  async exposeLocalPort(port, seed = randomBytes(32)) {
    if (this.#localPorts.has(port)) {
      throw new Error(`Port ${port} is already exposed`);
    }

    const keyPair = Hyperdht.keyPair(seed);
    // TODO: Try to fetch from the port to check if it exists
    const server = this.#dht.createServer(
      { reusableSocket: true },
      (connection) => {
        const stream = net.connect({ port });
        // @ts-ignore It's fiiine
        pipeline([stream, connection, stream]).catch(this.#onError);
      },
    );

    await server.listen(keyPair);

    const destroy = async () => {
      this.#localPorts.delete(port);
      await server.close();
    };

    const url = makeURL(keyPair.publicKey);

    this.#localPorts.set(port, { seed, url, destroy });

    return url;
  }

  /**
   * Take the URL of someone's service and expose it locally
   * @param {string} url URL of a service to expose locally
   * @param {number} [defaultPort] Default port to use, or one will be assigned
   * @returns {Promise<number>}
   */
  async exposeRemoteAsLocal(url, defaultPort = 0) {
    if (this.#remoteProxies.has(url)) {
      throw new Error(`URL ${url} is already exposed`);
    }

    const publicKey = parseURL(url);

    const server = net.createServer({ allowHalfOpen: true }, (stream) => {
      const connection = this.#dht.connect(publicKey, {
        reusableSocket: true,
      });

      connection.once("open", () => {
        // @ts-ignore It's fiiine
        pipeline([stream, connection, stream]).catch(this.#onError);
      });
    });

    const destroy = async () => {
      this.#remoteProxies.delete(url);
      await new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve(null);
        });
      });
    };

    await new Promise((resolve) => {
      server.listen(defaultPort, () => resolve(null));
    });

    // @ts-ignore It's fine, it'll be a port
    const { port } = server.address();

    this.#remoteProxies.set(url, { port, destroy });

    return port;
  }

  /**
   * Expose a folder as a service
   * @param {string} rootFolder Path to serve
   * @param {Buffer} [seed] Seed to use for the server's keypair
   * @returns {Promise<string>} URL of service
   */
  async exposeFolder(rootFolder, seed = randomBytes(32)) {
    if (this.#folders.has(rootFolder)) {
      throw new Error(`Folder ${rootFolder} is already exposed`);
    }

    const server = await makeFileServer({
      dht: this.#dht,
      seed,
      rootFolder,
    });

    const destroy = async () => {
      this.#folders.delete(rootFolder);
      await server.destroy();
    };

    const url = makeURL(server.keyPair.publicKey);

    this.#folders.set(rootFolder, {
      seed,
      url,
      destroy,
    });

    return url;
  }

  async destroy() {
    const toDestroy = [
      ...[...this.#localPorts.values()].map(getDestroy),
      ...[...this.#folders.values()].map(getDestroy),
      ...[...this.#remoteProxies.values()].map(getDestroy),
    ];

    await Promise.all(toDestroy.map((destroy) => destroy()));
  }
  /**
   * @returns {ProxyJSONLocalPorts}
   */
  get #localPortsJSON() {
    /**
     * @type {ProxyJSONLocalPorts}
     */
    const result = {};
    for (const [port, { seed }] of this.#localPorts.entries()) {
      result[port] = seed.toString("hex");
    }

    return result;
  }

  /**
   * @returns {ProxyJSONFolders}
   */
  get #foldersJSON() {
    /**
     * @type {ProxyJSONFolders}
     */
    const result = {};
    for (const [folder, { seed }] of this.#folders.entries()) {
      result[folder] = seed.toString("hex");
    }

    return result;
  }

  /**
   * @returns {ProxyJSONRemoteProxies}
   */
  get #remoteProxiesJSON() {
    /**
     * @type {ProxyJSONRemoteProxies}
     */
    const result = {};
    for (const [url, { port }] of this.#remoteProxies.entries()) {
      result[url] = port;
    }

    return result;
  }

  /**
   * @returns {ProxyJSON}
   */
  toJSON() {
    return {
      localPorts: this.#localPortsJSON,
      folders: this.#foldersJSON,
      remoteProxies: this.#remoteProxiesJSON,
    };
  }

  /**
   * @returns {ProxyListLocalPorts}
   */
  get #localPortsList() {
    /**
     * @type {ProxyListLocalPorts}
     */
    const result = {};
    for (const [port, { seed, url }] of this.#localPorts.entries()) {
      result[port] = { seed: seed.toString("hex"), url };
    }

    return result;
  }

  /**
   * @returns {ProxyListFolders}
   */
  get #foldersList() {
    /**
     * @type {ProxyListFolders}
     */
    const result = {};
    for (const [folder, { seed, url }] of this.#folders.entries()) {
      result[folder] = { seed: seed.toString("hex"), url };
    }

    return result;
  }

  /**
   * @returns {ProxyListRemoteProxies}
   */
  get #remoteProxiesList() {
    /**
     * @type {ProxyListRemoteProxies}
     */
    const result = {};
    for (const [url, { port }] of this.#remoteProxies.entries()) {
      result[url] = { port };
    }

    return result;
  }

  /**
   * @returns {ProxyList}
   */
  list() {
    return {
      localPorts: this.#localPortsList,
      folders: this.#foldersList,
      remoteProxies: this.#remoteProxiesList,
    };
  }

  /**
   *
   * @param {ProxyJSONLocalPorts} localPorts
   */
  async #loadLocalPortsJSON(localPorts) {
    await Promise.all(
      [...Object.entries(localPorts)].map(async ([portString, seedHex]) => {
        try {
          const port = parseInt(portString, 10);
          const seed = Buffer.from(seedHex, "hex");
          await this.exposeLocalPort(port, seed);
        } catch (e) {
          this.#onError(e);
        }
      }),
    );
  }

  /**
   *
   * @param {ProxyJSONFolders} folders
   */
  async #loadFoldersJSON(folders) {
    await Promise.all(
      [...Object.entries(folders)].map(async ([folderPath, seedHex]) => {
        try {
          const seed = Buffer.from(seedHex, "hex");
          await this.exposeFolder(folderPath, seed);
        } catch (e) {
          this.#onError(e);
        }
      }),
    );
  }

  /**
   *
   * @param {ProxyJSONRemoteProxies} remoteProxies
   */
  async #loadRemoteProxiesJSON(remoteProxies) {
    await Promise.all(
      [...Object.entries(remoteProxies)].map(async ([url, port]) => {
        try {
          await this.exposeRemoteAsLocal(url, port);
        } catch (e) {
          this.#onError(e);
        }
      }),
    );
  }

  /**
   *
   * @param {ProxyJSON} json
   */
  async loadJSON({ localPorts, folders, remoteProxies }) {
    await Promise.all([
      this.#loadLocalPortsJSON(localPorts),
      this.#loadFoldersJSON(folders),
      this.#loadRemoteProxiesJSON(remoteProxies),
    ]);
  }
}

/**
 * @param {{destroy: OnDestroy}} toDestroy
 * @returns {OnDestroy}
 */
function getDestroy({ destroy }) {
  return destroy;
}
