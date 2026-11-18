// QE round 2 preload (test only): makes the REAL web/server.mjs main block spawn a long-running fake agent (FAKE_SCENARIO=hang)
// instead of agent/src/cli.ts, so signal handling is tested against a real child process. Use: node --import ./r2_preload_hang.mjs web/server.mjs
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const realSpawn = cp.spawn; // captured before the patch (the ESM named export is live-bound)
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fake_agent.mjs");
cp.spawn = (cmd, args, opts = {}) => realSpawn(process.execPath, [FAKE, args[args.length - 1]], { ...opts, cwd: undefined, env: { ...opts.env, FAKE_SCENARIO: "hang", FAKE_LOG_FILE: "/nonexistent/none" } });
syncBuiltinESMExports();
