import test from "node:test";
import assert from "node:assert";
import makeHyperHTTPFetch from "hyper-http-fetch";
import createTestnet from "hyperdht/testnet.js";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { HyperHttpProxy, DEFAULT_ON_ERROR } from "../src/proxy.js";
import { makeURL, parseURL } from "../src/urls.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_FOLDER = resolve(__dirname, "../src/");

/**
 * @param {import('node:test').TestContext} t
 * @param {{onError?: (err: Error) => void}} [opts]
 * @returns {Promise<{proxy: HyperHttpProxy, testnet: Awaited<ReturnType<typeof createTestnet>>, fetch: Awaited<ReturnType<typeof makeHyperHTTPFetch>>}>}
 */
async function setup(t, opts = { onError: () => {} }) {
  const testnet = await createTestnet(3);
  t.after(() => testnet.destroy());

  await testnet.nodes[0].fullyBootstrapped();

  const proxy = new HyperHttpProxy({
    dht: testnet.nodes[0],
    onError: opts.onError,
  });
  t.after(() => proxy.destroy());

  const fetch = await makeHyperHTTPFetch({ bootstrap: testnet.bootstrap });
  t.after(fetch.close);

  return { proxy, testnet, fetch };
}

/**
 * @param {import("node:test").TestContext} t
 */
async function testServer(t) {
  // Start a simple HTTP server on a random local port
  const server = await new Promise((resolve) => {
    const s = net.createServer((socket) => {
      // Ignore network errors
      socket.on("error", () => {});
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");
    });
    s.listen(0, () => resolve(s));
  });
  t.after(() => server.close());

  const { port } = server.address();
  return port;
}

test("exposeLocalPort returns a valid hyper+http URL", async (t) => {
  const { proxy, fetch: hyperFetch } = await setup(t);

  const port = await testServer(t);

  const url = await proxy.exposeLocalPort(port);
  assert.ok(url.startsWith("hyper+http://"), "URL starts with scheme");

  // Verify we can reach the exposed service via HyperDHT
  const res = await hyperFetch(url);
  assert.ok(res.ok, "Response is OK");

  const body = await res.text();
  assert.equal(body, "OK", "Body matches local server response");
});

test("exposeLocalPort with custom seed produces deterministic URL", async (t) => {
  const { proxy } = await setup(t);

  const port = await testServer(t);

  const seed = randomBytes(32);

  const url1 = await proxy.exposeLocalPort(port, seed);

  // Cleanup and re-expose with same seed
  await proxy.destroy();

  const testnet = await createTestnet(3);
  t.after(() => testnet.destroy());

  const proxy2 = new HyperHttpProxy({ dht: testnet.nodes[1] });

  const url2 = await proxy2.exposeLocalPort(port, seed);

  assert.equal(url1, url2, "Same seed produces same URL");
});

test("exposeRemoteAsLocal returns a local port", async (t) => {
  const { proxy, fetch: hyperFetch } = await setup(t);

  const remotePort = await testServer(t);

  const exposedUrl = await proxy.exposeLocalPort(remotePort);

  // Now connect to it as a remote
  const localPort = await proxy.exposeRemoteAsLocal(exposedUrl);

  assert.ok(
    typeof localPort === "number" && localPort > 0,
    "Returns a valid port number",
  );

  // Verify we can reach the remote service through the local port
  const res = await fetch(`http://127.0.0.1:${localPort}/`);
  const body = await res.text();
  assert.equal(body, "OK", "Body matches remote server response");
});

test("exposeFolder returns a valid hyper+http URL", async (t) => {
  const { proxy, fetch: hyperFetch } = await setup(t);

  const url = await proxy.exposeFolder(ROOT_FOLDER);

  assert.ok(url.startsWith("hyper+http://"), "URL starts with scheme");

  // Fetch directohry listing
  const res = await hyperFetch(url);
  assert.ok(res.ok, "Response is OK");
  assert.equal(
    res.headers.get("content-type"),
    "application/json",
    "Content-Type is application/json",
  );

  const listings = await res.json();
  assert.ok(Array.isArray(listings), "Response body is an array");
  assert.ok(
    listings.some((entry) => entry === "fileserver.js"),
    "Listings contain fileserver.js",
  );
  assert.ok(
    listings.some((entry) => entry === "proxy.js"),
    "Listings contain proxy.js",
  );
});

test("exposeFolder with custom seed produces deterministic URL", async (t) => {
  const testnet = await createTestnet(3);
  t.after(() => testnet.destroy());

  const seed = randomBytes(32);

  const proxy1 = new HyperHttpProxy({ dht: testnet.nodes[0] });
  const url1 = await proxy1.exposeFolder(ROOT_FOLDER, seed);
  await proxy1.destroy();

  const proxy2 = new HyperHttpProxy({ dht: testnet.nodes[1] });
  const url2 = await proxy2.exposeFolder(ROOT_FOLDER, seed);
  await proxy2.destroy();

  assert.equal(url1, url2, "Same seed produces same URL");
});

test("toJSON serializes proxy state correctly", async (t) => {
  const { proxy } = await setup(t);

  // Start a local server to expose
  const port = await testServer(t);

  // Expose some things
  const exposedUrl = await proxy.exposeLocalPort(port);
  await proxy.exposeFolder(ROOT_FOLDER);

  const json = proxy.toJSON();

  assert.ok(
    json.localPorts && typeof json.localPorts === "object",
    "Has localPorts",
  );
  assert.ok(json.folders && typeof json.folders === "object", "Has folders");
  assert.ok(
    json.remoteProxies && typeof json.remoteProxies === "object",
    "Has remoteProxies",
  );

  assert.ok(json.localPorts[port], "localPorts contains the exposed port");
  assert.ok(json.folders[ROOT_FOLDER], "folders contains the exposed folder");
});

test("loadJSON restores proxy state", async (t) => {
  const { proxy, fetch: hyperFetch } = await setup(t);

  // Start a local server to expose
  const port = await testServer(t);

  // Expose some things
  const exposedUrl = await proxy.exposeLocalPort(port);
  await proxy.exposeFolder(ROOT_FOLDER);

  const json = proxy.toJSON();

  // Destroy and recreate the proxy
  await proxy.destroy();

  const testnet = await createTestnet(3);
  t.after(() => testnet.destroy());

  const newProxy = new HyperHttpProxy({ dht: testnet.nodes[0] });
  t.after(() => newProxy.destroy());

  await newProxy.loadJSON(json);

  const restoredJson = newProxy.toJSON();
  assert.ok(
    restoredJson.localPorts[port],
    "Restored localPorts contains the exposed port",
  );
  assert.ok(
    restoredJson.folders[ROOT_FOLDER],
    "Restored folders contains the exposed folder",
  );
});

test("loadJSON handles missing entries gracefully via onError", async (t) => {
  const testnet = await createTestnet(3);
  t.after(() => testnet.destroy());

  const errors = [];
  const newProxy = new HyperHttpProxy({
    dht: testnet.nodes[1],
    onError: (err) => errors.push(err),
  });
  t.after(() => newProxy.destroy());

  // Load JSON with a port that doesn't have a server
  const seedHex = randomBytes(32).toString("hex");
  const json = {
    localPorts: { 99999: seedHex },
    folders: { "/nonexistent/path/that/does/not/exist/12345": seedHex },
    remoteProxies: {},
  };

  await newProxy.loadJSON(json);

  // Should not throw and should record errors for failed entries
  assert.ok(errors.length >= 1, "Errors were collected for failed entries");
});

test("destroy cleans up all proxies", async (t) => {
  const { proxy, fetch: hyperFetch } = await setup(t);

  // Start a local server to expose
  const port = await testServer(t);

  await proxy.exposeLocalPort(port);
  await proxy.exposeFolder(ROOT_FOLDER);

  const json = proxy.toJSON();

  // Destroy the main proxy (t.after hook will fire, but let's destroy early)
  await proxy.destroy();

  // State should be empty after destroy
  const afterJson = proxy.toJSON();
  assert.ok(
    Object.keys(afterJson.localPorts).length === 0,
    "localPorts is empty after destroy",
  );
  assert.ok(
    Object.keys(afterJson.folders).length === 0,
    "folders is empty after destroy",
  );
});

test("constructor accepts custom onError handler", async (t) => {
  /** @type Error[] */
  const errors = [];
  const { proxy } = await setup(t, { onError: (err) => errors.push(err) });

  // Trigger an error by loading a bad port
  const seedHex = randomBytes(30).toString("hex");
  const json = {
    localPorts: { 99999: seedHex },
    folders: {},
    remoteProxies: {},
  };

  await proxy.loadJSON(json);

  assert.ok(errors.length > 0, "Custom onError handler was called");
});

test("exposeFolder serves individual files", async (t) => {
  const { proxy, fetch: hyperFetch } = await setup(t);

  const url = await proxy.exposeFolder(ROOT_FOLDER);

  const res = await hyperFetch(url + "proxy.js");
  assert.ok(res.ok, "Response is OK");
  assert(
    res.headers.get("content-type")?.includes("script"),
    "Content-Type indicates JavaScript",
  );

  const body = await res.text();
  assert.ok(
    body.includes("HyperHttpProxy"),
    "Body contains expected class definition",
  );
});

test("exposeLocalPort throws on duplicate port", async (t) => {
  const { proxy } = await setup(t);

  const port = await testServer(t);

  await proxy.exposeLocalPort(port);

  await assert.rejects(
    proxy.exposeLocalPort(port),
    /already exposed/,
    "Should throw on duplicate port",
  );
});

test("exposeFolder throws on duplicate folder", async (t) => {
  const { proxy } = await setup(t);

  await proxy.exposeFolder(ROOT_FOLDER);

  await assert.rejects(
    proxy.exposeFolder(ROOT_FOLDER),
    /already exposed/,
    "Should throw on duplicate folder",
  );
});

test("exposeRemoteAsLocal throws on duplicate URL", async (t) => {
  const { proxy } = await setup(t);

  const remotePort = await testServer(t);

  const exposedUrl = await proxy.exposeLocalPort(remotePort);

  await proxy.exposeRemoteAsLocal(exposedUrl);

  await assert.rejects(
    proxy.exposeRemoteAsLocal(exposedUrl),
    /already exposed/,
    "Should throw on duplicate URL",
  );
});
