/**
 * @import {ProxyMethods} from "../../src/daemon.js"
 */

/**
 * Mock HyperHttpProxy that tracks calls and returns deterministic results.
 */
export class MockProxy {
  /** @type {{ method: string; args: unknown[] }[]} */
  calls = [];
  /** @type {Record<string, {seed: string, url: string}>} */
  localPorts = {};
  /** @type {Record<string, {port: number}>} */
  remoteProxies = {};
  /** @type {Record<string, {seed: string, url: string}>} */
  folders = {};

  /**
   * @param {number} port
   * @param {Buffer} [_seed]
   * @returns {Promise<string>}
   */
  async exposeLocalPort(port, _seed) {
    this.calls.push({ method: "exposeLocalPort", args: [port, _seed] });
    const url = `hyper+http://mock${port}/`;
    this.localPorts[port] = { seed: seedToHex(_seed, `port:${port}`), url };
    return url;
  }

  /**
   * @param {string} url
   * @param {number} [defaultPort]
   * @returns {Promise<number>}
   */
  async exposeRemoteAsLocal(url, defaultPort = 0) {
    this.calls.push({
      method: "exposeRemoteAsLocal",
      args: [url, defaultPort],
    });
    const port = defaultPort || 0;
    this.remoteProxies[url] = { port };
    return port;
  }

  /**
   * @param {string} rootFolder
   * @param {Buffer} [_seed]
   * @returns {Promise<string>}
   */
  async exposeFolder(rootFolder, _seed) {
    this.calls.push({ method: "exposeFolder", args: [rootFolder, _seed] });
    const url = `hyper+http://mock${rootFolder.split("/").pop()}/`;
    this.folders[rootFolder] = {
      seed: seedToHex(_seed, `folder:${rootFolder}`),
      url,
    };
    return url;
  }

  /**
   * @returns {ReturnType<ProxyMethods["toJSON"]>}
   */
  toJSON() {
    /** @type {ReturnType<ProxyMethods["toJSON"]>} */
    const result = { localPorts: {}, remoteProxies: {}, folders: {} };
    for (const [port, { seed }] of Object.entries(this.localPorts)) {
      result.localPorts[Number(port)] = seed;
    }
    for (const [folder, { seed }] of Object.entries(this.folders)) {
      result.folders[folder] = seed;
    }
    for (const [url, { port }] of Object.entries(this.remoteProxies)) {
      result.remoteProxies[url] = port;
    }
    return result;
  }

  /**
   * @returns {ReturnType<ProxyMethods["list"]>}
   */
  list() {
    /** @type {ReturnType<ProxyMethods["list"]>} */
    const result = { localPorts: {}, folders: {}, remoteProxies: {} };
    for (const [port, { seed, url }] of Object.entries(this.localPorts)) {
      result.localPorts[Number(port)] = { seed, url };
    }
    for (const [folder, { seed, url }] of Object.entries(this.folders)) {
      result.folders[folder] = { seed, url };
    }
    for (const [url, { port }] of Object.entries(this.remoteProxies)) {
      result.remoteProxies[url] = { port };
    }
    return result;
  }

  /**
   * @param {{ localPorts?: Record<string, string>, folders?: Record<string, string>, remoteProxies?: Record<string, number> }} state
   */
  async loadJSON(state) {
    this.localPorts = {};
    for (const [port, seed] of Object.entries(state.localPorts ?? {})) {
      this.localPorts[port] = { seed, url: `hyper+http://mock${port}/` };
    }
    this.folders = {};
    for (const [folder, seed] of Object.entries(state.folders ?? {})) {
      this.folders[folder] = {
        seed,
        url: `hyper+http://mock${folder.split("/").pop()}/`,
      };
    }
    this.remoteProxies = {};
    for (const [url, port] of Object.entries(state.remoteProxies ?? {})) {
      this.remoteProxies[url] = { port };
    }
  }

  clearCalls() {
    this.calls = [];
  }
}

/**
 * Deterministic 64-char hex seed derived from a key.
 * @param {string} key
 * @returns {string}
 */
function mockSeedHex(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  }
  const chunk = h.toString(16).padStart(8, "0");
  return chunk.repeat(8).slice(0, 64);
}

/**
 * Normalize a seed (Buffer or hex string) to a hex string, or derive one.
 * @param {Buffer | string | undefined} seed
 * @param {string} fallbackKey
 * @returns {string}
 */
function seedToHex(seed, fallbackKey) {
  if (!seed) return mockSeedHex(fallbackKey);
  if (Buffer.isBuffer(seed)) return seed.toString("hex");
  return String(seed);
}
