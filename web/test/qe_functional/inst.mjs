// Starts an EXTRA web app instance (web/server.mjs only; the stack from scripts/web.sh keeps running) on another port, with the same filtered env the launcher builds.
// Needed because scripts/web.sh stops the whole stack when its web child exits, so killing/restarting the web app alone cannot be done through the launcher.
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { ROOT, ADDR, SCRATCH } from "./lib.mjs";
export function startInstance(port, extra = {}, tag = "inst") {
  const pick = (names, prefixes = []) => Object.fromEntries(Object.entries(process.env).filter(([k]) => names.includes(k) || prefixes.some(p => k.startsWith(p))));
  const env = { ...pick(["PATH", "HOME", "TMPDIR", "LANG", "USER"], ["AGENT_"]), ...pick(["SVM_RPC_URL", "MAX_INPUT_BYTES"]),
    WEB_MODE: "stub", WEB_PORT: String(port), WEB_SERVER_PORT: "4021", WEB_RUN_DIR: path.join(ROOT, "web/run/stub"), WEB_SIGNER_PUB: ADDR.signer, WEB_BUYER_ADDR: ADDR.buyer, WEB_PAY_TO: ADDR.payTo, ...extra };
  const fd = openSync(path.join(SCRATCH, `${tag}_${port}.log`), "a");
  const c = spawn(process.execPath, [path.join(ROOT, "web/server.mjs")], { cwd: ROOT, env, stdio: ["ignore", fd, fd] });
  return c;
}
