#!/usr/bin/env node
import { createProcessIo } from '../infrastructure/cli/process-io.js';
import { runCli } from '../infrastructure/cli/run.js';
import { createDeps } from './container.js';
import { VERSION } from './version.js';

const io = createProcessIo(process);
process.exitCode = await runCli(process.argv.slice(2), {
  io,
  version: VERSION,
  makeDeps: ({ state }) => createDeps({ state, env: process.env, terminal: { input: process.stdin, output: process.stderr } }),
});
