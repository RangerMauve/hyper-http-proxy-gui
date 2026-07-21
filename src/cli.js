import { parseArgs } from "node:util";
import { connect } from "node:net";
import { JsonRpc } from "./jsonrpc.js";
import { Daemon } from "./daemon.js";
import Hyperdht from "hyperdht";
import { HyperHttpProxy } from "./proxy.js";
import { join } from "node:path";
import xdg from "xdg-portable";

/**
 * @import {ProxyMethods} from "./daemon.js"
 */

/** @type {import("xdg-portable").XDG} */
// @ts-ignore default export is callable at runtime but types differ
const xdgInstance = xdg;

function defaultSocketPath() {
  const runtime = xdgInstance.runtime();
  const baseDir = runtime || join(xdgInstance.state(), "setkamost");
  return join(baseDir, "sock");
}

const DEFAULT_SOCKET_PATH = defaultSocketPath();

/**
 * @param {object} opts
 * @param {Record<string, string | undefined>} opts.env
 * @param {string[]} opts.args
 * @returns {Promise<void>}
 */
export async function run({ env, args }) {
  const socketPath = env.SETKAMOST_SOCKET || DEFAULT_SOCKET_PATH;

  if (args.length === 0) {
    await commandHelp([]);
    return;
  }

  const [command, ...rest] = args;

  switch (command) {
    case "daemon":
      await commandDaemon(rest, socketPath);
      break;
    case "list":
      await commandList(rest, socketPath);
      break;
    case "expose-local":
      await commandExposeLocal(rest, socketPath);
      break;
    case "expose-remote":
      await commandExposeRemote(rest, socketPath);
      break;
    case "expose-folder":
      await commandExposeFolder(rest, socketPath);
      break;
    case "--help":
    case "help":
      await commandHelp(rest);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      await commandHelp([]);
      process.exit(1);
  }
}

/**
 * @param {string[]} args
 * @param {string} defaultSocket
 * @returns {Promise<void>}
 */
async function commandDaemon(args, defaultSocket) {
  const { values, positionals } = parseArgs({
    options: {
      socket: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
    args,
  });

  if (values.help) {
    console.log(`Usage: setkamost daemon <subcommand> [options]

Subcommands:
  start   Start the daemon
  stop    Stop the daemon

Options:
  --socket <path>  Socket path (default: ${defaultSocket})
  -h, --help       Show help`);
    return;
  }

  const socketPath = /** @type {string} */ (values.socket || defaultSocket);
  if (positionals.length === 0) {
    console.error("Error: missing subcommand (start|stop)");
    console.log(`Usage: setkamost daemon <subcommand> [options]

Subcommands:
  start   Start the daemon
  stop    Stop the daemon

Options:
  --socket <path>  Socket path (default: ${defaultSocket})
  -h, --help       Show help`);
    process.exit(1);
  }
  /** @type {string[]} */
  const pos = positionals;
  const subcommand = pos[0];

  if (subcommand === "start") {
    await daemonStart(socketPath);
  } else if (subcommand === "stop") {
    await daemonStop(socketPath);
  } else {
    console.error(`Unknown daemon subcommand: ${subcommand}`);
    process.exit(1);
  }
}

/**
 * @param {string} socketPath
 */
async function daemonStart(socketPath) {
  const dht = new Hyperdht();
  const proxy = new HyperHttpProxy({ dht });
  const daemon = new Daemon({ proxy, socketPath });

  await daemon.start();
  console.log(`Daemon started (socket: ${socketPath})`);
}

/**
 * @param {string} socketPath
 */
async function daemonStop(socketPath) {
  const { existsSync, readFileSync } = await import("node:fs");
  const pidPath = socketPath + ".pid";

  if (!existsSync(pidPath)) {
    console.error("No PID file found. Daemon may not be running.");
    process.exit(1);
  }

  const pid = Number(readFileSync(pidPath, "utf8"));
  try {
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to daemon (PID ${pid})`);
  } catch {
    console.error(`Failed to stop daemon (PID ${pid})`);
    process.exit(1);
  }
}

/**
 * @param {string[]} args
 * @param {string} defaultSocket
 * @returns {Promise<JsonRpc>}
 */
function connectRpc(args, defaultSocket) {
  const { values, positionals } = parseArgs({
    options: {
      socket: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
    args,
  });

  if (values.help) {
    throw new Error("help-requested");
  }

  const socketPath = /** @type {string} */ (values.socket || defaultSocket);

  return new Promise((resolve, reject) => {
    const socket = connect(socketPath, () => {
      resolve(new JsonRpc(socket));
    });
    socket.on("error", reject);
  });
}

/**
 * @param {string[]} args
 * @param {string} defaultSocket
 */
async function commandList(args, defaultSocket) {
  let client;
  try {
    client = await connectRpc(args, defaultSocket);
    const state = await client.call("list");
    console.log(JSON.stringify(state, null, 2));
  } catch (err) {
    if (err.message === "help-requested") {
      console.log(`Usage: setkamost list [options]

List all exposed services.

Options:
  --socket <path>  Socket path
  -h, --help       Show help`);
    } else {
      throw err;
    }
  } finally {
    if (client) client.destroy();
  }
}

/**
 * @param {string[]} args
 * @param {string} defaultSocket
 */
async function commandExposeLocal(args, defaultSocket) {
  let client;
  try {
    client = await connectRpc(args, defaultSocket);
    const { positionals } = parseArgs({
      options: {
        socket: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      args,
    });

    if (positionals.length === 0) {
      console.error("Error: missing <port> argument");
      console.log(`Usage: setkamost expose-local <port> [options]

Expose a local HTTP port over HyperDHT.

Options:
  --socket <path>  Socket path
  -h, --help       Show help`);
      process.exit(1);
    }

    /** @type {string[]} */
    const pos = positionals;
    const port = Number(pos[0]);
    const url = await client.call("exposeLocalPort", [port]);
    console.log(url);
  } catch (err) {
    if (err.message === "help-requested") {
      console.log(`Usage: setkamost expose-local <port> [options]

Expose a local HTTP port over HyperDHT.

Options:
  --socket <path>  Socket path
  -h, --help       Show help`);
    } else {
      throw err;
    }
  } finally {
    if (client) client.destroy();
  }
}

/**
 * @param {string[]} args
 * @param {string} defaultSocket
 */
async function commandExposeRemote(args, defaultSocket) {
  let client;
  try {
    client = await connectRpc(args, defaultSocket);
    const { values, positionals } = parseArgs({
      options: {
        socket: { type: "string" },
        port: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      args,
    });

    if (positionals.length === 0) {
      console.error("Error: missing <url> argument");
      console.log(`Usage: setkamost expose-remote <url> [options]

Expose a remote HyperDHT service as a local port.

Options:
  --port <number>  Local port (optional, auto-assigned)
  --socket <path>  Socket path
  -h, --help       Show help`);
      process.exit(1);
    }

    /** @type {string[]} */
    const pos = positionals;
    const url = pos[0];
    const localPort = values.port ? Number(values.port) : 0;
    const port = await client.call("exposeRemoteAsLocal", [url, localPort]);
    console.log(port);
  } catch (err) {
    if (err.message === "help-requested") {
      console.log(`Usage: setkamost expose-remote <url> [options]

Expose a remote HyperDHT service as a local port.

Options:
  --port <number>  Local port (optional, auto-assigned)
  --socket <path>  Socket path
  -h, --help       Show help`);
    } else {
      throw err;
    }
  } finally {
    if (client) client.destroy();
  }
}

/**
 * @param {string[]} args
 * @param {string} defaultSocket
 */
async function commandExposeFolder(args, defaultSocket) {
  let client;
  try {
    client = await connectRpc(args, defaultSocket);
    const { positionals } = parseArgs({
      options: {
        socket: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
      args,
    });

    if (positionals.length === 0) {
      console.error("Error: missing <path> argument");
      console.log(`Usage: setkamost expose-folder <path> [options]

Expose a folder as a HyperDHT file server.

Options:
  --socket <path>  Socket path
  -h, --help       Show help`);
      process.exit(1);
    }

    /** @type {string[]} */
    const pos = positionals;
    const folder = pos[0];
    const url = await client.call("exposeFolder", [folder]);
    console.log(url);
  } catch (err) {
    if (err.message === "help-requested") {
      console.log(`Usage: setkamost expose-folder <path> [options]

Expose a folder as a HyperDHT file server.

Options:
  --socket <path>  Socket path
  -h, --help       Show help`);
    } else {
      throw err;
    }
  } finally {
    if (client) client.destroy();
  }
}

/**
 * @param {string[]} args
 */
async function commandHelp(args) {
  const context = args[0];
  if (context) {
    // Re-route to the specific command with --help
    const cmdMap = {
      daemon: "commandDaemon",
      list: "commandList",
      "expose-local": "commandExposeLocal",
      "expose-remote": "commandExposeRemote",
      "expose-folder": "commandExposeFolder",
    };
    // Already handled by individual commands
    return;
  }

  console.log(`Usage: setkamost <command> [options]

Commands:
  daemon          Manage the daemon process
  list            List all exposed services
  expose-local    Expose a local HTTP port
  expose-remote   Expose a remote service as local
  expose-folder   Expose a folder as a file server
  help            Show this help message

Use 'setkamost <command> --help' for more information.`);
}
