// Signed, hash-chained, append-only verdict log (JSON lines). Schema + canonical form: AGENTS/INTERFACES.md.
// Uses only node:crypto (ed25519) and @scure/base (already a dependency). Logging must NEVER affect settlement:
// every function the server calls is wrapped by the caller in try/catch, and appendRecord never throws.
import { createHash, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { base58 } from "@scure/base";

export const GENESIS_PREV = "0".repeat(64);
export const sha256hex = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/** Canonical JSON: object keys sorted (recursively, by UTF-16 code unit), no whitespace, arrays in order. */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("non-finite number"); return JSON.stringify(v); }
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return "{" + Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonicalize(o[k])).join(",") + "}";
  }
  throw new Error("unsupported value in record");
}

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface LogSigner { publicKeyB58: string; priv: KeyObject }

/** keypair: base58 of a 64-byte ed25519 keypair (32-byte seed || 32-byte public key), like the other repo keys. */
export function signerFromKeypair(b58: string): LogSigner {
  const raw = Buffer.from(base58.decode(b58.trim()));
  if (raw.length !== 64) throw new Error("LOG_SIGNING_KEY must be a base58 64-byte ed25519 keypair");
  const priv = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, raw.subarray(0, 32)]), format: "der", type: "pkcs8" });
  const derived = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(SPKI_ED25519_PREFIX.length);
  if (!derived.equals(raw.subarray(32))) throw new Error("LOG_SIGNING_KEY: public half does not match the seed");
  return { publicKeyB58: base58.encode(derived), priv };
}

/** Ephemeral in-memory signer (tests). Returns the signer only; the key never leaves memory. */
export async function ephemeralSigner(): Promise<LogSigner> {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(SPKI_ED25519_PREFIX.length);
  return { publicKeyB58: base58.encode(pub), priv: privateKey };
}

export interface RecordFields {
  reportHash: string;
  caseId: string | null;
  targetCommit: string | null;
  fixCommit: string | null;
  vulImage: string | null;
  fixImage: string | null;
  casesSha256: string | null;
  verifierSha256: string | null;
  verdict: string;
  detail: string;
  settledAtomic: string;
  settlementStatus: "settled" | "failed" | "unknown";
  txSignature: string | null;
  timestamp: string;
}

export interface LogRecord extends RecordFields { v: 1; seq: number; prev: string; signer: string; signature: string }

/** What is signed: canonical JSON of the record without `signature`. */
export const signingBytes = (r: Omit<LogRecord, "signature"> | LogRecord): Buffer => {
  const { signature: _s, ...rest } = r as LogRecord;
  return Buffer.from(canonicalize(rest), "utf8");
};

export function signRecord(signer: LogSigner, fields: RecordFields, seq: number, prev: string): LogRecord {
  const body = { v: 1 as const, seq, prev, signer: signer.publicKeyB58, ...fields };
  const signature = base58.encode(edSign(null, signingBytes(body as LogRecord), signer.priv));
  return { ...body, signature };
}

export const lineOf = (r: LogRecord): string => canonicalize(r);

export class VerdictLog {
  private seq = 0;
  private prev = GENESIS_PREV;
  readonly path: string;
  private signer: LogSigner;
  constructor(path: string, signer: LogSigner) {
    this.path = path; this.signer = signer;
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").split("\n").filter(l => l !== "");
      if (lines.length) {
        this.seq = lines.length;
        this.prev = sha256hex(lines[lines.length - 1]);
      }
    }
  }
  get signerPublicKey(): string { return this.signer.publicKeyB58; }
  /** Synchronous (single-threaded => no interleaving). Never throws: a log failure must not touch settlement. */
  append(fields: RecordFields): LogRecord | null {
    try {
      const rec = signRecord(this.signer, fields, this.seq, this.prev);
      const line = lineOf(rec);
      appendFileSync(this.path, line + "\n", { encoding: "utf8", mode: 0o644 });
      this.seq += 1;
      this.prev = sha256hex(line);
      return rec;
    } catch (e) {
      console.error("[verdictlog] append failed (settlement unaffected):", e instanceof Error ? e.message : "error");
      return null;
    }
  }
}

export interface VerifyResult { ok: boolean; records: number; problems: string[]; signers: string[] }

/** Checks every signature, the canonical form of each line, seq continuity and the prev-hash chain. */
export function verifyLogText(text: string, pinnedPubkey?: string): VerifyResult {
  const problems: string[] = [];
  const signers = new Set<string>();
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let prev = GENESIS_PREV;
  lines.forEach((line, i) => {
    const n = i + 1;
    let r: LogRecord;
    try { r = JSON.parse(line); } catch { problems.push(`line ${n}: not valid JSON`); prev = sha256hex(line); return; }
    try {
      if (canonicalize(r) !== line) problems.push(`line ${n}: not in canonical form (re-serialized or edited)`);
      if (r.v !== 1) problems.push(`line ${n}: unknown version`);
      if (r.seq !== i) problems.push(`line ${n}: seq ${r.seq}, expected ${i} (record removed, inserted or reordered)`);
      if (r.prev !== prev) problems.push(`line ${n}: prev hash mismatch (chain broken: previous line changed, removed or reordered)`);
      signers.add(r.signer);
      if (pinnedPubkey && r.signer !== pinnedPubkey) problems.push(`line ${n}: signer ${r.signer} is not the pinned key`);
      const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(base58.decode(r.signer))]), format: "der", type: "spki" });
      if (!edVerify(null, signingBytes(r), pub, Buffer.from(base58.decode(r.signature)))) problems.push(`line ${n}: BAD SIGNATURE`);
    } catch (e) {
      problems.push(`line ${n}: cannot verify (${e instanceof Error ? e.message : "error"})`);
    }
    prev = sha256hex(line);
  });
  if (signers.size > 1) problems.push(`log has ${signers.size} different signers`);
  return { ok: problems.length === 0, records: lines.length, problems, signers: [...signers] };
}

// ---- server wiring helpers ----

export interface CaseInfo {
  caseId: string | null; targetCommit: string | null; fixCommit: string | null;
  vulImage: string | null; fixImage: string | null; casesSha256: string | null; verifierSha256: string | null;
}
const NO_CASE: CaseInfo = { caseId: null, targetCommit: null, fixCommit: null, vulImage: null, fixImage: null, casesSha256: null, verifierSha256: null };

/** Decision D-010 Option A: the case comes from server config (VERIFIER_CASE, else cases.json default_case for the REAL verifier),
 *  digests/commits are read from verifier/cases.json. With the stub (allowStub) and no VERIFIER_CASE the case is unknown => nulls. */
export function caseInfo(casesPath: string, verifierPath: string, caseEnv: string | undefined, allowStub: boolean): CaseInfo {
  try {
    const raw = readFileSync(casesPath);
    const cfg = JSON.parse(raw.toString("utf8"));
    const id = caseEnv ? caseEnv : allowStub ? null : String(cfg.default_case ?? "") || null;
    const c = id ? cfg.cases?.[id] : undefined;
    let verifierSha256: string | null = null;
    try { verifierSha256 = sha256hex(readFileSync(verifierPath)); } catch { /* leave null */ }
    return {
      caseId: id, // recorded even if unknown to cases.json (then the rest stays null)
      targetCommit: c?.vul?.libucl_commit ?? null, fixCommit: c?.fix?.libucl_commit ?? null,
      vulImage: c?.vul?.image ?? null, fixImage: c?.fix?.image ?? null,
      casesSha256: sha256hex(raw), verifierSha256,
    };
  } catch { return { ...NO_CASE, caseId: caseEnv || null }; }
}

/** Correlates the request's payment (header) with the settle hooks' paymentPayload without trusting anything unverified:
 *  both are the same decoded object, keyed by sha256 of the canonical inner payload. */
export function paymentKey(inner: unknown): string | null {
  try { return inner && typeof inner === "object" ? sha256hex(canonicalize(inner)) : null; } catch { return null; }
}
export function paymentKeyFromHeader(h: string | undefined): string | null {
  if (!h) return null;
  try { return paymentKey(JSON.parse(Buffer.from(h, "base64").toString("utf8"))?.payload); } catch { return null; }
}

export interface SettleNote { status: "settled" | "failed"; tx: string | null; amount: string | null }
/** Settle hooks drop notes here; the response 'close' handler takes them. Bounded so it cannot grow without limit. */
export class SettleNotes {
  private m = new Map<string, SettleNote>();
  put(key: string | null, n: SettleNote): void {
    if (!key) return;
    if (this.m.size > 1000) this.m.clear();
    const old = this.m.get(key);
    if (old?.status === "settled" && n.status === "failed") return; // never downgrade a confirmed settle
    this.m.set(key, n);
  }
  take(key: string | null): SettleNote | undefined {
    if (!key) return undefined;
    const n = this.m.get(key); this.m.delete(key); return n;
  }
}

export type PendingFields = Omit<RecordFields, "settledAtomic" | "settlementStatus" | "txSignature" | "timestamp"> & { attempted: string };

/** Writes exactly ONE record per paid request, whichever of these happens first (VERDICT_LOG investigation, D-013):
 *  (1) the settle hook reports the final after-handler outcome, (2) the response closes and a fallback timer expires
 *  (covers a settle that never reports). Writing on response 'close' alone lost records when the client had already
 *  disconnected before the handler registered, and recorded "unknown" when it disconnected mid-settle.
 *  Pre-handler failures (verify/deposit settle failed => handler never ran) go through preHandlerFailure.
 *  Never throws; a failure is printed loudly and does not touch settlement. */
export class OutcomeRecorder {
  private pending = new Map<string, { f: PendingFields; timer?: ReturnType<typeof setTimeout> }>();
  private n = 0;
  private log: { append(f: RecordFields): unknown } | null;
  private notes: SettleNotes;
  private fallbackMs: number;
  private warn: (m: string) => void;
  constructor(log: { append(f: RecordFields): unknown } | null, notes: SettleNotes, fallbackMs: number, warn: (m: string) => void = m => console.error(m)) {
    this.log = log; this.notes = notes; this.fallbackMs = fallbackMs; this.warn = warn;
  }
  /** Returns the key under which this request is registered (the payment key, or a unique one when unknown). */
  register(key: string | null, f: PendingFields): string {
    const k = key ?? `anon-${++this.n}`;
    try {
      if (!this.log) return k;
      const old = this.pending.get(k);
      if (old) { if (old.timer) clearTimeout(old.timer); this.write(old.f, undefined, "superseded by a second request with the same payment"); }
      this.pending.set(k, { f });
    } catch (e) { this.warn(`[verdictlog] register failed (settlement unaffected): ${e instanceof Error ? e.message : "error"}`); }
    return k;
  }
  /** Response closed. If the settle hook has not reported yet, wait fallbackMs for it, then write whatever is known. */
  closed(k: string): void {
    try {
      const p = this.pending.get(k);
      if (!p || p.timer) return;
      p.timer = setTimeout(() => this.flush(k), this.fallbackMs);
      p.timer.unref?.();
    } catch (e) { this.warn(`[verdictlog] close handling failed (settlement unaffected): ${e instanceof Error ? e.message : "error"}`); }
  }
  /** The final after-handler settle outcome is known (success, or failure after recovery). */
  flush(k: string, note?: SettleNote): void {
    try {
      const p = this.pending.get(k);
      if (!p) return;
      if (p.timer) clearTimeout(p.timer);
      this.pending.delete(k);
      this.write(p.f, note ?? this.notes.take(k.startsWith("anon-") ? null : k));
    } catch (e) { this.warn(`[verdictlog] flush failed (settlement unaffected): ${e instanceof Error ? e.message : "error"}`); }
  }
  /** Verify/deposit failed before the handler: a paid-flow request with no verdict. Record it (status failed, $0 settled). */
  preHandlerFailure(f: Omit<PendingFields, "attempted">, tx: string | null, why: string): void {
    try {
      this.write({ ...f, attempted: "0", detail: why }, { status: "failed", tx, amount: null });
    } catch (e) { this.warn(`[verdictlog] pre-handler record failed (settlement unaffected): ${e instanceof Error ? e.message : "error"}`); }
  }
  private write(f: PendingFields, n: SettleNote | undefined, extra?: string): void {
    const { attempted, ...rest } = f;
    const rec = this.log?.append({
      ...rest, detail: extra ? `${rest.detail} (${extra})` : rest.detail,
      settledAtomic: n?.status === "settled" ? (n.amount ?? attempted) : attempted,
      settlementStatus: n ? n.status : "unknown", txSignature: n?.tx ?? null, timestamp: new Date().toISOString(),
    });
    if (rec === null) this.warn("[verdictlog] ERROR: a paid request's record could NOT be written (see append failure above); settlement unaffected");
  }
  get pendingCount(): number { return this.pending.size; }
}
