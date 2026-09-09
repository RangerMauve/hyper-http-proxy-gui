import createHyperServer from "hyper-http-fetch/server";
import { resolve, posix } from "node:path";
import fs from "node:fs/promises";
import mime from "mime";
import parseRange from "range-parser";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
/** @import HyperDHT, {HyperDHTOptions} from "hyperdht" */

/** @typedef {import("hyperdht").KeyPair} KeyPair */

const INDEX_FILES = [
  "index.html",
  "index.md",
  "index.gmi",
  "index.gemini",
  "index.org",
  "README.md",
  "README.org",
];

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
      const parsedUrl = new URL(url);
      const pathname = decodedPathname(parsedUrl.pathname);
      const noResolve = parsedUrl.searchParams.has("noResolve");
      const accept = req.headers.get("Accept") || "";
      const isRanged = req.headers.get("Range") || "";

      if (method === "HEAD") {
        return headFile(rootFolder, pathname, { noResolve, accept, isRanged });
      } else if (method === "GET") {
        return getFile(rootFolder, pathname, { noResolve, accept, isRanged });
      } else {
        return new Response("Invalid method", {
          status: 405,
          headers: { "content-type": "text/plain" },
        });
      }
    } catch (e) {
      if (e.code === "ENOENT") {
        return new Response("Not Found", {
          status: 404,
          headers: { "content-type": "text/plain" },
        });
      }
      return new Response(e.message, {
        status: 500,
        headers: { "content-type": "text/plain" },
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

/**
 * @param {string} pathname
 * @returns {string}
 */
function decodedPathname(pathname) {
  return decodeURI(pathname);
}

/**
 * @param {string} rootFolder
 * @param {string} pathname
 * @param {object} opts
 * @param {boolean} opts.noResolve
 * @param {string} opts.accept
 * @param {string} opts.isRanged
 * @returns {Promise<Response>}
 */
async function headFile(rootFolder, pathname, { noResolve, accept, isRanged }) {
  const isDirectory = pathname.endsWith("/");

  if (isDirectory) {
    const final = resolveFile(rootFolder, pathname);
    const stat = await fs.stat(final);
    if (!stat.isDirectory()) {
      return new Response(null, {
        headers: { "content-type": "text/plain" },
        status: 404,
      });
    }

    const files = await listDir(final);

    if (!noResolve) {
      const indexFile = files.find((f) => INDEX_FILES.includes(f));
      if (indexFile) {
        const indexPath = posix.join(pathname, indexFile);
        await fs.stat(resolveFile(rootFolder, indexPath));
        const mimeType = getMimeType(indexPath);
        return new Response(null, {
          status: 204,
          headers: { "content-type": mimeType },
        });
      }
    }

    const contentType = accept.includes("text/html")
      ? "text/html; charset=utf-8"
      : "application/json";

    return new Response(null, {
      status: 204,
      headers: { "content-type": contentType },
    });
  }

  const { filePath, path } = await resolvePath(rootFolder, pathname, noResolve);
  if (!filePath || !path) {
    return new Response(null, { status: 404 });
  }

  const stat = await fs.stat(filePath);
  const mimeType = getMimeType(path);
  const size = stat.size;

  /** @type {{[key: string]: string}} */
  const resHeaders = {
    "content-type": mimeType,
    "content-length": size.toString(),
    "last-modified": stat.mtime.toUTCString(),
    "accept-ranges": "bytes",
  };

  if (isRanged) {
    const ranges = parseRange(size, isRanged);
    const isRangeValid = ranges !== -1 && ranges !== -2 && ranges;

    if (isRangeValid && ranges.length && ranges.type === "bytes") {
      const [{ start, end }] = ranges;
      const length = end - start + 1;
      resHeaders["content-length"] = length.toString();
      resHeaders["content-range"] = `bytes ${start}-${end}/${size}`;
    }
  }

  return new Response(null, {
    status: 204,
    headers: resHeaders,
  });
}

/**
 * @param {string} rootFolder
 * @param {string} pathname
 * @param {object} opts
 * @param {boolean} opts.noResolve
 * @param {string} opts.accept
 * @param {string} opts.isRanged
 * @returns {Promise<Response>}
 */
async function getFile(rootFolder, pathname, { noResolve, accept, isRanged }) {
  const isDirectory = pathname.endsWith("/");

  if (isDirectory) {
    return serveDirectory(rootFolder, pathname, {
      noResolve,
      accept,
      isRanged,
    });
  }

  const { filePath, path } = await resolvePath(rootFolder, pathname, noResolve);
  if (!filePath || !path) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  const stat = await fs.stat(filePath);
  const mimeType = getMimeType(path);
  const size = stat.size;

  /** @type {{[key: string]: string}} */
  const resHeaders = {
    "content-type": mimeType,
    "content-length": size.toString(),
    "last-modified": stat.mtime.toUTCString(),
    "accept-ranges": "bytes",
  };

  if (isRanged) {
    const ranges = parseRange(size, isRanged);
    const isRangeValid = ranges !== -1 && ranges !== -2 && ranges;

    if (isRangeValid && ranges.length && ranges.type === "bytes") {
      const [{ start, end }] = ranges;
      const length = end - start + 1;
      resHeaders["content-length"] = length.toString();
      resHeaders["content-range"] = `bytes ${start}-${end}/${size}`;

      const stream = Readable.toWeb(createReadStream(filePath, { start, end }));
      // @ts-ignore TypeScript doesnt do web streams well
      return new Response(stream, { status: 206, headers: resHeaders });
    }
  }

  const stream = Readable.toWeb(createReadStream(filePath));
  // @ts-ignore TypeScript doesnt do web streams well
  return new Response(stream, { headers: resHeaders });
}

/**
 * Serve a directory with index file resolution and listing
 * @param {string} rootFolder
 * @param {string} pathname
 * @param {object} opts
 * @param {boolean} opts.noResolve
 * @param {string} opts.accept
 * @param {string} opts.isRanged
 * @returns {Promise<Response>}
 */
async function serveDirectory(
  rootFolder,
  pathname,
  { noResolve, accept, isRanged },
) {
  const final = resolveFile(rootFolder, pathname);
  const stat = await fs.stat(final);
  if (!stat.isDirectory()) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  const files = await listDir(final);

  if (!files.length && pathname !== "/") {
    return new Response("[]", {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  // Check for index files
  if (!noResolve) {
    for (const indexFile of INDEX_FILES) {
      if (files.includes(indexFile)) {
        const indexPath = posix.join(pathname, indexFile);
        return serveFile(rootFolder, indexPath, isRanged);
      }
    }
  }

  // Directory listing
  if (accept.includes("text/html")) {
    const body = renderIndex(pathname, files);
    return new Response(body, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify(files, null, "\t"), {
    headers: { "content-type": "application/json" },
  });
}

/**
 * Serve a single file with streaming and optional range
 * @param {string} rootFolder
 * @param {string} pathname
 * @param {string} [isRanged]
 * @returns {Promise<Response>}
 */
async function serveFile(rootFolder, pathname, isRanged) {
  const filePath = resolveFile(rootFolder, pathname);
  const stat = await fs.stat(filePath);
  const mimeType = getMimeType(pathname);
  const size = stat.size;

  /** @type {{[key: string]: string}} */
  const resHeaders = {
    "content-type": mimeType,
    "content-length": size.toString(),
    "last-modified": stat.mtime.toUTCString(),
    "accept-ranges": "bytes",
  };

  if (isRanged) {
    const ranges = parseRange(size, isRanged);
    const isRangeValid = ranges !== -1 && ranges !== -2 && ranges;

    if (isRangeValid && ranges.length && ranges.type === "bytes") {
      const [{ start, end }] = ranges;
      const length = end - start + 1;
      resHeaders["content-length"] = length.toString();
      resHeaders["content-range"] = `bytes ${start}-${end}/${size}`;

      const stream = Readable.toWeb(createReadStream(filePath, { start, end }));
      // @ts-ignore TypeScript doesnt do web streams well
      return new Response(stream, { status: 206, headers: resHeaders });
    }
  }

  const stream = Readable.toWeb(createReadStream(filePath));
  // @ts-ignore TypeScript doesnt do web streams well
  return new Response(stream, { headers: resHeaders });
}

/**
 * Resolve a path trying the exact path first, then common extensions
 * @param {string} rootFolder
 * @param {string} pathname
 * @param {boolean} noResolve
 * @returns {Promise<{filePath: string|null, path: string|null}>}
 */
async function resolvePath(rootFolder, pathname, noResolve) {
  const toTry = noResolve
    ? [pathname]
    : [pathname, pathname + ".html", pathname + ".md"];

  for (const path of toTry) {
    try {
      const filePath = resolveFile(rootFolder, path);
      await fs.access(filePath);
      return { filePath, path };
    } catch {
      continue;
    }
  }

  return { filePath: null, path: null };
}

/**
 * List directory entries, appending / to directories
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
async function listDir(dirPath) {
  const entries = [];
  const files = await fs.readdir(dirPath, { withFileTypes: true });
  for (const ent of files) {
    entries.push(ent.isDirectory() ? ent.name + "/" : ent.name);
  }
  return entries;
}

/**
 * Render an HTML directory listing
 * @param {string} pathname
 * @param {string[]} files
 * @returns {string}
 */
function renderIndex(pathname, files) {
  return `
<!DOCTYPE html>
<title>Index of ${pathname}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<h1>Index of ${pathname}</h1>
<ul>
  <li><a href="../">../</a></li>
  ${files.map((file) => `<li><a href="${file}">./${file}</a></li>`).join("\n")}
</ul>`;
}

/**
 * @param {string} path
 * @returns {string}
 */
function getMimeType(path) {
  let mimeType = mime.getType(path) || "application/octet-stream";
  if (mimeType.startsWith("text/")) mimeType = `${mimeType}; charset=utf-8`;
  return mimeType;
}
