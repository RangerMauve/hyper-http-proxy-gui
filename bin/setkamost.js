#!/usr/bin/env node
import { createProgram } from "../src/cli.js";

createProgram()
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
