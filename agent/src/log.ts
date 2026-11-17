// Append-only JSON-lines decision log. Callers pass plain data only; known secret-ish keys are dropped as a
// safety net, and nothing here ever reads env or key material.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// tx signatures (public) are fine; payment headers and anything key-like are dropped.
const FORBIDDEN = /key|secret|seed|private|authorization|^signature$|payment-?signature/i;

export type LogFn = (event: string, data?: Record<string, unknown>) => void;

export function makeLogger(file: string, echo = false): LogFn {
  mkdirSync(path.dirname(file), { recursive: true });
  return (event, data = {}) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) if (!FORBIDDEN.test(k)) clean[k] = typeof v === "bigint" ? v.toString() : v;
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...clean });
    appendFileSync(file, line + "\n");
    if (echo) console.error(line);
  };
}
