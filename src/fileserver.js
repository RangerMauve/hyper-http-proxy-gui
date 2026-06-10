import createHyperServer from "hyper-http-fetch/server";
import { resolve } from "node:path";
import fs from "node:fs/promises";
import mime from "mime";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
/** @import HyperDHT, {HyperDHTOptions} from "hyperdht" */

/** @typedef {import("hyperdht").KeyPair} KeyPair */

/**
 * Create an Hyper HTTP server that serves files from a local folder
 * @param {object} options
 * @param {HyperDHT|HyperDHTOptions} options.dht
 * @param {string} options.rootFolder
 * @param {Buffer} options.seed
 * @returns {Promise<{keyPair: KeyPair, url: string, destroy: import("./proxy.js").OnDestroy}>}
 */
export async function makeFileServer({ dht, rootFolder, seed }) {
  /**
   *
   * @param {Request} req
   * @returns {Promise<Response>}
   */
  async function onRequest(req) {
    try {
      const { method, url } = req;
      const { pathname } = new URL(url);
      if (method === "HEAD") {
        const final = resolveFile(rootFolder, pathname);
        const stat = await fs.stat(final);
        if (stat.isDirectory()) {
          return new Response(null, {
            headers: {
              "content-type": "application/json",
            },
          });
        }

        const mimeType = mime.getType(final) || "application/octet-stream";

        return new Response(null, {
          headers: {
            "content-type": mimeType,
            "content-length": stat.size.toString(),
            "last-modified": stat.mtime.toUTCString(),
          },
        });
      } else if (method === "GET") {
        const final = resolveFile(rootFolder, pathname);
        const stat = await fs.stat(final);
        if (stat.isDirectory()) {
          const files = await fs.readdir(final, { withFileTypes: true });

          const toShow = files.map((ent) =>
            ent.isDirectory() ? `${ent.name}/` : ent.name,
          );

          // TODO: Render HTML if they Accept it
          return new Response(JSON.stringify(toShow), {
            headers: {
              "content-type": "application/json",
            },
          });
        }

        const mimeType = mime.getType(final) || "application/octet-stream";
        const stream = Readable.toWeb(createReadStream(final));

        // @ts-ignore TypeScript doesnt do web streams well
        return new Response(stream, {
          headers: {
            "content-type": mimeType,
            "content-length": stat.size,
            "last-modified": stat.mtime.toUTCString(),
          },
        });
      } else {
        return new Response("Invalid method", {
          status: 405,
          headers: {
            "content-type": "text/plain",
          },
        });
      }
    } catch (e) {
      if (e.code === "ENOENT") {
        return new Response("Not Found", {
          status: 404,
          headers: {
            "content-type": "text/plain",
          },
        });
      }
      return new Response(e.message, {
        status: 500,
        headers: {
          "content-type": "text/plain",
        },
      });
    }
  }
  const server = await createHyperServer(onRequest, {
    dht: dht,
    seed,
  });

  return server;
}

/**
 * Resolve a file relative to a root directory
 * @param {string} rootFolder
 * @param {string} filePath
 * @returns {string}
 */
export function resolveFile(rootFolder, filePath) {
  const relativePath = filePath.startsWith("/") ? "." + filePath : filePath;
  const final = resolve(rootFolder, relativePath);
  if (!final.startsWith(rootFolder)) throw new Error("Invalid path");
  return final;
}
