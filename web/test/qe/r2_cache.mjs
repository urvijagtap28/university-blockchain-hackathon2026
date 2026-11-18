// QE round 2 surface (9): the mtime+size parse cache (web/lib/records.mjs parsedCached) vs tamper/replace of the verdict log between requests,
// and the dropped-connection / inbox / log views. In-process createApp on 127.0.0.1:<port>, fake agent, no keys.
// Usage: env -i node web/test/qe/r2_cache.mjs [port=4074]
import { generateKeyPairSync } from "node:crypto"; import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, utimesSync, statSync, renameSync, unlinkSync } from "node:fs";
import os from "node:os"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { base58 } from "../../../server/node_modules/@scure/base/lib/esm/index.js";
import { createApp } from "../../server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)); const port = Number(process.argv[2] || 4074); const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32), pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32), pubB = base58.encode(pub);
const dir = mkdtempSync(path.join(os.tmpdir(), "r2cache-")), logFile = path.join(dir, "verdicts.jsonl");
const extra = { FAKE_LOG_FILE: logFile, FAKE_LOG_KEY: base58.encode(Buffer.concat([seed, pub])), FAKE_VERDICT: "reproduced", FAKE_SETTLED: "0", FAKE_DETAIL: "case 1, 5 B input: vul 3/3 heap-buffer-overflow at f a.c:1; fixed build clean" };
const app = createApp({ mode: "real", runDir: dir, logFile, notesFile: path.join(dir, "n.jsonl"), env: {}, signerPub: pubB, spacingMs: 0, demoInputs: [], agentCmd: [process.execPath, path.join(HERE, "..", "fake_agent.mjs")], agentCwd: dir, timing: { waitDoneMs: 3000, waitSignedMs: 3000, pollMs: 50, agentTimeoutMs: 20000 }, extraChildEnv: extra });
await app.listen(port); const base = `http://127.0.0.1:${port}`, H = { host: `127.0.0.1:${port}` };
const get = async p => (await fetch(base + p, { headers: H })).json();
async function submit(body) { const r = await fetch(base + "/api/submit", { method: "POST", headers: { ...H, origin: base, "x-csrf-token": app.token }, body }); const j = await r.json(); await (await fetch(`${base}/api/jobs/${j.jobId}/events`, { headers: H })).text(); await sleep(50); }
await submit("cache proof one"); await submit("cache proof two");
let L = await get("/api/log"), I = await get("/api/inbox");
ok(L.verify.ok && L.verify.verified === 2 && I.items.length === 2, `baseline: log verify ok=${L.verify.ok} verified ${L.verify.verified}/2, inbox ${I.items.length} items`);
const orig = readFileSync(logFile, "utf8"), logFile0 = logFile, mt0 = statSync(logFile, { bigint: true }).mtimeNs;
// (a) tamper that changes size
writeFileSync(logFile, orig.replace("heap-buffer-overflow", "heap-buffer-overflowXX")); L = await get("/api/log"); I = await get("/api/inbox");
ok(!L.verify.ok && L.verify.verified < 2 && I.items.some(i => i.detail.includes("overflowXX")), `(a) size-changing tamper: log verify ok=${L.verify.ok} (${L.verify.verified}/2 verified), inbox reflects new text=${I.items.some(i => i.detail.includes("overflowXX"))}`);
// (b) same-size tamper, new mtime
writeFileSync(logFile, orig); await get("/api/inbox"); await sleep(20);
writeFileSync(logFile, orig.replace("heap-buffer-overflow", "heap-buffer-overfloX")); // same length
L = await get("/api/log"); I = await get("/api/inbox");
ok(!L.verify.ok && I.items.some(i => i.detail.includes("overfloX")), `(b) same-size tamper with fresh mtime: log verify ok=${L.verify.ok}, inbox shows tampered text: ${I.items.some(i => i.detail.includes("overfloX"))}`);
// (c) same size AND mtime restored (touch -r style): inbox cache keyed mtime+size cannot see it; /api/log is read fresh each time
writeFileSync(logFile, orig); await get("/api/inbox"); const mt0b = statSync(logFile, { bigint: true }).mtimeNs; const st1 = statSync(logFile);
const tampered = orig.replace(/seq":0/, 'seq":9'); writeFileSync(logFile, tampered);
execFileSync("/usr/bin/python3", ["-c", "import os,sys;os.utime(sys.argv[1],ns=(int(sys.argv[2]),int(sys.argv[3])))", logFile, String(statSync(logFile0, { bigint: true }).atimeNs), String(mt0b)]); // exact-ns mtime restore
const same = statSync(logFile); L = await get("/api/log"); I = await get("/api/inbox");
const mtimeEqual = same.mtimeMs === st1.mtimeMs && same.size === st1.size;
ok(!L.verify.ok, `(c) same size + restored mtime (equal=${mtimeEqual}): /api/log (read fresh, signature-verified) flags the tamper: verify.ok=${L.verify.ok}, problems ${JSON.stringify(L.verify.problems).slice(0, 120)}`);
console.log(`INFO (c): /api/inbox seqs ${JSON.stringify(I.items.map(i => i.seq))} (cache ${I.items.some(i => i.seq === 9) ? "reflects the tamper" : "still serves the pre-tamper parse: stale until mtime/size changes"}); inbox does not verify signatures at all`);
// (d) replace via rename (new inode), delete, empty
writeFileSync(logFile + ".new", ""); renameSync(logFile + ".new", logFile); L = await get("/api/log"); I = await get("/api/inbox");
ok(L.records.length === 0 && I.items.length === 0, `(d) log replaced by an empty file via rename: log records ${L.records.length}, inbox items ${I.items.length}`);
unlinkSync(logFile); L = await get("/api/log"); I = await get("/api/inbox"); ok(L.records.length === 0 && I.items.length === 0, `(d) log deleted: records ${L.records.length}, inbox ${I.items.length}, no 500`);
// (e) unsigned appended forged "reproduced" record
writeFileSync(logFile, orig); writeFileSync(logFile, orig + JSON.stringify({ seq: 2, reportHash: "ab".repeat(32), verdict: "reproduced", detail: "forged", settledAtomic: "0", settlementStatus: "settled", timestamp: new Date().toISOString() }) + "\n");
L = await get("/api/log"); I = await get("/api/inbox");
ok(!L.verify.ok, `(e) unsigned forged record appended: log verify.ok=${L.verify.ok}, verified ${L.verify.verified}/${L.records.length}`);
console.log(`INFO (e): inbox lists the forged record: ${I.items.some(i => i.detail === "forged")} (inbox has no per-item sigOk; the UI relies on the global banner)`);
await app.close(); console.log(fails ? `${fails} FAILED` : "all passed"); process.exit(fails ? 1 : 0);
