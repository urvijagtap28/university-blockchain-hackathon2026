// Calls the verifier (python3 verifier/verify.py <file>) and turns its output into a settle decision.
// Contract: see AGENTS/INTERFACES.md. EVERY failure maps to verdict "error" with settle amount 0.
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

const errorDecision = (detail: string): Decision => ({ verdict: "error", detail, settleAtomic: 0n });

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

/** Runs the verifier with a hard wall-clock cap. Never throws; errors/timeouts -> settle 0. */
export function runVerifier(inputFile: string, allowStub: boolean): Promise<Decision> {
  const secs = Math.min(Number(process.env.VERIFIER_TIMEOUT_SECONDS) || VERIFIER_HARD_CAP_SECONDS, VERIFIER_HARD_CAP_SECONDS);
  return new Promise(resolve => {
    try {
      execFile(
        "python3",
        [VERIFY_PY, inputFile],
        { timeout: secs * 1000, killSignal: "SIGKILL", maxBuffer: 64 * 1024, encoding: "utf8" },
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
