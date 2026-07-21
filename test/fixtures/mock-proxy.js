/**
 * @import {ProxyMethods} from "../../src/daemon.js"
 */

/**
 * Mock HyperHttpProxy that tracks calls and returns deterministic results.
 */
export class MockProxy {
  /** @type {{ method: string; args: unknown[] }[]} */
  calls = [];
  /** @type {Record<string, string>} */
  localPorts = {};
  /** @type {Record<string, number>} */
  remoteProxies = {};
  /** @type {Record<string, string>} */
  folders = {};

  /**
   * @param {number} port
   * @param {Buffer} [_seed]
   * @returns {Promise<string>}
   */
  async exposeLocalPort(port, _seed) {
    this.calls.push({ method: "exposeLocalPort", args: [port, _seed] });
    const url = `hyper+http://mock${port}/`;
    this.localPorts[port] = url;
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
    this.remoteProxies[url] = port;
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
    this.folders[rootFolder] = url;
    return url;
  }

  /**
   * @returns {ReturnType<ProxyMethods["toJSON"]>}
   */
  toJSON() {
    return {
      localPorts: { ...this.localPorts },
      remoteProxies: { ...this.remoteProxies },
      folders: { ...this.folders },
    };
  }

  clearCalls() {
    this.calls = [];
  }
}
