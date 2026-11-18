// TEST ONLY stand-in for agent/src/cli.ts: same argv (one proof file), same outputs (decision log lines, one JSON result line),
// and it appends a REAL signed record to the verdict log (test key). Behaviour comes from FAKE_* env (passed via extraChildEnv).
import { appendFileSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { signRecord, signerFromKeypair, lineOf, GENESIS_PREV } from "../../server/src/verdictlog.ts";

const E = process.env, file = process.argv[2];
const sha = b => createHash("sha256").update(b).digest("hex");
const log = (event, d = {}) => appendFileSync(E.AGENT_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), event, ...d }) + "\n");
if (E.FAKE_ENV_DUMP) writeFileSync(E.FAKE_ENV_DUMP, JSON.stringify({ env: E, argv: process.argv.slice(2) }));
const bytes = readFileSync(file);
const hash = sha(bytes);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const scenario = E.FAKE_SCENARIO || "paid";

log("session_start");
if (E.FAKE_LINES) appendFileSync(E.AGENT_LOG_PATH, E.FAKE_LINES + "\n"); // raw extra line(s), verbatim (QE-W2-001/005 tests)
if (scenario === "refuse") {
  log("refuse_budget", { reason: E.FAKE_REFUSE_REASON || "session budget exhausted" });
  console.log(JSON.stringify({ file, status: "refused", reason: E.FAKE_REFUSE_REASON || "session budget exhausted" }));
  process.exit(0);
}
const NET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", PAYTO = "8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib";
log("allow_url", { url: E.AGENT_ALLOWED_URL });
if (E.FAKE_REALISTIC) {
  // replays the field set of the real agent's decision log lines (agent/src/agent.ts, incl. the D-020 additive reserve fields); bigints are strings like makeLogger writes them
  const h = hash.slice(0, 16);
  log("reserve", { reportHash: h, askAtomic: "250000", remainingAtomic: "1750000", capAtomic: "250000", scheme: "upto", network: NET, maxTimeoutSeconds: 300 });
  log("approval_auto", { reportHash: h, askAtomic: "250000", thresholdAtomic: "100000", autoApproveAtomic: "250000" });
  log("payment_signed", { reportHash: h, askAtomic: "250000", payTo: PAYTO, network: NET });
} else if (E.FAKE_HOSTILE) {
  const x = "<img src=x onerror=alert(1)>";
  log("reserve", { askAtomic: "250000", capAtomic: "250000", remainingAtomic: x, scheme: x, network: "solana:" + "A".repeat(5000), maxTimeoutSeconds: "300", privateKey: "SECRETKEYTEXT", extra: x });
  log("approval_auto", { askAtomic: "250000", thresholdAtomic: "9".repeat(40) });
  log("payment_signed", { askAtomic: "250000", payTo: "5".repeat(88), secret: "SECRETKEYTEXT" });
} else {
  log("approval_auto", {});
  log("payment_signed", {});
}
await sleep(Number(E.FAKE_SLEEP_MS || 0));
if (scenario === "hang") await sleep(600000);
if (scenario === "paid") {
  const settled = E.FAKE_SETTLED ?? "0";
  const lines = existsSync(E.FAKE_LOG_FILE) ? readFileSync(E.FAKE_LOG_FILE, "utf8").split("\n").filter(Boolean) : [];
  const prev = lines.length ? sha(lines[lines.length - 1]) : GENESIS_PREV;
  const rec = signRecord(signerFromKeypair(E.FAKE_LOG_KEY), {
    reportHash: hash, caseId: null, targetCommit: null, fixCommit: null, vulImage: null, fixImage: null, casesSha256: null, verifierSha256: null,
    verdict: E.FAKE_VERDICT || "reproduced", detail: E.FAKE_DETAIL || "stub: test", settledAtomic: settled, settlementStatus: E.FAKE_SETTLEMENT_STATUS || "settled",
    txSignature: E.FAKE_TX ?? "49hbmUddNRyJ4RAfSrM66fEx1WYkHWeShiMH1kNpDYRVCG7jB9WvAvXywXBWTsV8SdScd6qWDLxtuTr75fZ8MJxT", timestamp: new Date().toISOString() }, lines.length, prev);
  appendFileSync(E.FAKE_LOG_FILE, lineOf(rec) + "\n");
  log("settle_result", { settledAtomic: settled });
}
// the agent's own console claims something different on purpose: the web layer must not trust it
console.log(JSON.stringify({ file, status: scenario === "unknown" ? "unknown" : "done", verdict: "reproduced", detail: "AGENT CONSOLE CLAIM", settledAtomic: "999999" }));
