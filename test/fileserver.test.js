import test from "node:test";
import assert from "node:assert";
import makeHyperHTTPFetch from "hyper-http-fetch";
import createTestnet from "hyperdht/testnet.js";
import { makeFileServer, resolveFile } from "../src/fileserver.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_FOLDER = resolve(__dirname, "../app/");

/**
 * @param {import('node:test').TestContext} t
 * @returns {Promise<{server: Awaited<ReturnType<typeof makeFileServer>>, fetch: Awaited<ReturnType<typeof makeHyperHTTPFetch>>}>}
 */
async function setup(t) {
  const testnet = await createTestnet(3);
  t.after(() => testnet.destroy());

  const server = await makeFileServer({
    dht: { bootstrap: testnet.bootstrap },
    rootFolder: ROOT_FOLDER,
    seed: randomBytes(32),
  });
  t.after(() => server.destroy());

  const fetch = await makeHyperHTTPFetch({ bootstrap: testnet.bootstrap });
  t.after(fetch.close);

  return { server, fetch };
}

test("fileserver lists directory contents", async (t) => {
  const { server, fetch: hyperFetch } = await setup(t);

  const res = await hyperFetch(server.url);
  assert.ok(res.ok, "Response is OK");
  assert.equal(
    res.headers.get("content-type"),
    "application/json",
    "Content-Type is application/json",
  );

  const listings = await res.json();
  assert.ok(Array.isArray(listings), "Response body is an array");
  assert.ok(
    listings.some((entry) => entry === "index.html"),
    "Listings contain index.html",
  );
  assert.ok(
    listings.some((entry) => entry.endsWith(".js")),
    "Listings contain .js files",
  );
});

test("fileserver serves index.html content", async (t) => {
  const { server, fetch: hyperFetch } = await setup(t);

  const res = await hyperFetch(server.url + "index.html");
  assert.ok(res.ok, "Response is OK");
  assert(
    res.headers.get("content-type")?.startsWith("text/html"),
    "Content-Type starts with text/html",
  );

  const body = await res.text();
  assert.ok(body.includes("Setkamost"), "Body contains expected HTML content");
});

test("resolveFile rejects path traversal (../README.md) in the path", async (t) => {
  assert.throws(
    () => resolveFile(ROOT_FOLDER, "./../README.md"),
    { message: "Invalid path" },
    "resolveFile throws on path traversal",
  );
});
