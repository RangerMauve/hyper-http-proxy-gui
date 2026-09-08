#!/usr/bin/env node
import { createProgram } from "../src/cli.js";

createProgram().parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
