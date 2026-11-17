// Calls the verifier (<VERIFIER_PYTHON> verifier/verify.py <file> --case <VERIFIER_CASE>) and turns its output into a settle decision.
// Contract: see docs/INTERFACES.md. EVERY failure maps to verdict "error" with settle amount 0.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const CAP_ATOMIC = 250_000n; // $0.25 in USDC atomic units (6 decimals)
export const VERIFIER_HARD_CAP_SECONDS = 60;
const VALID = new Set(["reproduced", "not_reproduced", "inconclusive"]);
const SETTLE_MAP: Record<string, bigint> = {
  reproduced: 0n,
  inconclusive: 0n,
  not_reproduced: CAP_ATOMIC,
};

export interface Decision {
  verdict: string; // reproduced | not_reproduced | inconclusive | error
  detail: string;
  settleAtomic: bigint; // already clamped to [0, CAP]
}

export function clamp(amount: bigint): bigint {
  if (amount < 0n) return 0n;
  return amount > CAP_ATOMIC ? CAP_ATOMIC : amount;
}

/** The amount actually sent as the settle override: errors -> 0, everything else clamped to [0, CAP]. */
export function finalSettle(d: { verdict: string; settleAtomic: bigint }): bigint {
  return clamp(VALID.has(d.verdict) ? d.settleAtomic : 0n); // error, busy, rate_limited, anything unknown -> 0
}

const errorDecision =(detail: string): Decision => ({ verdict: "error", detail, settleAtomic: 0n });

/** Pure: stdout text -> decision. Never throws. */
export function decideFromOutput(stdout: string, allowStub: boolean): Decision {
  try {
    const lines = stdout.split("\n").filter(l => l.trim() !== "");
    if (lines.length !== 1) return errorDecision(`verifier printed ${lines.length} lines, expected 1`);
    const out = JSON.parse(lines[0]);
    if (out === null || typeof out !== "object" || Array.isArray(out)) return errorDecision("verifier JSON is not an object");
    if (out.stub === true && !allowStub) return errorDecision("verifier is a stub (stub:true) and ALLOW_STUB_VERIFIER is not set");
    if (typeof out.verdict !== "string" || !VALID.has(out.verdict)) return errorDecision("verifier verdict missing or invalid");
    const detail = typeof out.detail === "string" ? out.detail.slice(0, 500) : "";
    return { verdict: out.verdict, detail, settleAtomic: clamp(SETTLE_MAP[out.verdict]) };
  } catch (e) {
    return errorDecision(`bad verifier output: ${e instanceof Error ? e.message : "parse error"}`);
  }
}

const VERIFY_PY =
  process.env.VERIFIER_PATH ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../verifier/verify.py");

const CASE_RE = /^[0-9]{1,12}$/;
// Only these variables reach the verifier process, so server secrets (keys, RPC URL) never do.
const CHILD_ENV_ALLOW = [
  "PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP", "TMP", "VERIFY_TMPDIR",
  "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "LANG",
];

export interface Invocation { cmd: string; args: string[]; env: Record<string, string>; secs: number }

/** Pure: builds the verifier command line, or returns an error decision. Never throws. */
export function buildInvocation(
  inputFile: string, allowStub: boolean, env: NodeJS.ProcessEnv = process.env, arch: string = process.arch,
): Invocation | Decision {
  // The real verifier runs linux/amd64-only ASan images; under emulation (e.g. Apple Silicon) the harness is killed.
  if (!allowStub && arch !== "x64" && env.VERIFIER_ALLOW_NON_AMD64 !== "1") {
    return errorDecision(`real verifier needs an amd64 host (this host is ${arch}); images are linux/amd64 and ASan fails under emulation`);
  }
  const secs = Math.min(Number(env.VERIFIER_TIMEOUT_SECONDS) || VERIFIER_HARD_CAP_SECONDS, VERIFIER_HARD_CAP_SECONDS);
  const args = [VERIFY_PY, inputFile];
  const caseId = env.VERIFIER_CASE; // chosen by server config only, never by the sender
  if (caseId !== undefined && caseId !== "") {
    if (!CASE_RE.test(caseId)) return errorDecision("VERIFIER_CASE is not a 1-12 digit case id");
    args.push("--case", caseId);
  }
  const childEnv: Record<string, string> = {};
  for (const k of CHILD_ENV_ALLOW) if (env[k] !== undefined) childEnv[k] = env[k] as string;
  // verify.py kills its container on its own cap; keep that cap below ours so it can finish the kill first.
  childEnv.VERIFY_CAP_SECONDS = String(Math.max(1, secs - 5));
  return { cmd: env.VERIFIER_PYTHON || "python3", args, env: childEnv, secs };
}

/** Runs the verifier with a hard wall-clock cap. Never throws; errors/timeouts -> settle 0. */
export function runVerifier(inputFile: string, allowStub: boolean): Promise<Decision> {
  const inv = buildInvocation(inputFile, allowStub);
  if ("verdict" in inv) return Promise.resolve(inv);
  const { secs } = inv;
  return new Promise(resolve => {
    try {
      execFile(
        inv.cmd,
        inv.args,
        { timeout: secs * 1000, killSignal: "SIGKILL", maxBuffer: 64 * 1024, encoding: "utf8", env: inv.env },
        (err, stdout) => {
          if (err) {
            const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
            return resolve(errorDecision(killed ? `verifier timed out after ${secs}s` : `verifier failed: ${err.message.slice(0, 200)}`));
          }
          resolve(decideFromOutput(stdout, allowStub));
        },
      );
    } catch (e) {
      resolve(errorDecision(`could not start verifier: ${e instanceof Error ? e.message : "unknown"}`));
    }
  });
}
