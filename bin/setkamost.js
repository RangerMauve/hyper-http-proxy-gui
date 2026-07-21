#!/usr/bin/env node
import { run } from "../src/cli.js";

run({ env: process.env, args: process.argv.slice(2) }).catch((err) => {
  console.error(err);
  process.exit(1);
});
