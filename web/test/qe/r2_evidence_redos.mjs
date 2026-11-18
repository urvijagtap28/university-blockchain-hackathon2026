// QE round 2 surface (2): time web/public/evidence.js (real file, evaluated in a vm) and the server-string regexes in app.js against adversarial 64 KB inputs.
// Usage: env -i node web/test/qe/r2_evidence_redos.mjs   (no network, no files written)
import vm from "node:vm"; import { readFileSync } from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ctx = { globalThis: null }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(path.join(HERE, "../../public/evidence.js"), "utf8"), ctx);
// round 3: the app.js helpers below are the REAL current code, cut out of web/public/app.js (round 2 tested stale regex copies)
const appSrc = readFileSync(path.join(HERE, "../../public/app.js"), "utf8");
const cut = (a0, e0) => { const a = appSrc.indexOf(a0), b = appSrc.indexOf(e0, a); if (a < 0 || b < 0) throw new Error("cannot find " + a0); return appSrc.slice(a, b + e0.length); };
const actx = {}; vm.createContext(actx); vm.runInContext(cut("const rowName = r => {", "\n  };") + "\n" + cut("function overCap(m)", "}\n") + "\n" + cut("function refusalTitle(m)", "}\n") + "\nthis.f = { rowName, refusalTitle };", actx);
const { rowName, refusalTitle } = actx.f;
const E = ctx.Evidence; const N = 65536;
const T = "case 42482847, 5 B input: ";
const inputs = {
  "A*64K": "A".repeat(N), "space*64K": " ".repeat(N), "'above '*64K": "above ".repeat(N / 6), "'; vul run1: '*": "vul run1: x; ".repeat(N / 12),
  "case..+'A'*": T + "vul 3/3 " + "A".repeat(N), "crash with long loc": T + "vul 3/3 heap-buffer-overflow at f " + "a".repeat(N) + "; fixed build clean", "loc ':1:1:1'*": T + "vul 3/3 e at f " + "a:1".repeat(N / 3),
  "'a-'*": T + "vul 3/3 " + "a-".repeat(N / 2) + " at f x; fixed build clean", "runlist 2000": (T + "vul run1: " + "x".repeat(2000)).slice(0, 2000), "runlist many": T + Array.from({ length: 300 }, (_, i) => `vul run${i + 1}: clean`).join("; "),
  "ctl not clean ((((": T + "vul 3/3 heap-buffer-overflow at f a.c:1; fixed-build control not clean (" + "(".repeat(290) + ")", "both-builds": T + "crashes on both builds (vul 3/3 " + "a-b at ".repeat(280) + ")", "http+long": "allowlist: http://" + "a".repeat(N), "atomic*": "x402 upto authorization signed for " + "1".repeat(N) + " atomic to ", "approve auto": "auto-approved: ask " + "1".repeat(N) + " atomic", "b58*": "x402 upto authorization signed for 1 atomic to " + "1".repeat(N),
};
let worst = 0, fails = 0;
const time = (name, f) => { const t = process.hrtime.bigint(); let r; try { r = f(); } catch (e) { r = "THROW " + e.message; } const ms = Number(process.hrtime.bigint() - t) / 1e6; worst = Math.max(worst, ms); return { ms, r }; };
for (const [name, s] of Object.entries(inputs)) {
  const res = [];
  for (const v of ["reproduced", "not_reproduced", "inconclusive"]) res.push(time(name, () => E.parseEvidence(v, s)).ms);
  for (const a of ["allow", "refuse", "approve", "reject", "sign"]) res.push(time(name, () => E.parseDecision(a, s)).ms, time(name, () => E.factLines(a, s, { askAtomic: s, capAtomic: s, remainingAtomic: s, network: s, scheme: s, maxTimeoutSeconds: s })).ms);
  res.push(time(name, () => refusalTitle(s)).ms); // real app.js refusalTitle (server clips to 300 chars, but tested at 64 KB)
  res.push(time(name, () => s.replace(/\b(\d{1,12}) atomic\b/g, "$")).ms); // app.js money()
  res.push(time(name, () => rowName({ label: s })).ms); // real app.js rowName
  const mx = Math.max(...res); const bad = mx > 250; if (bad) fails++;
  console.log(`${bad ? "FAIL" : "PASS"} ${name}: len ${s.length}, max single call ${mx.toFixed(1)} ms over ${res.length} calls`);
}
// bounded growth check for the one quadratic candidate (above .*cap): double the size, compare
const q = n => time("q", () => refusalTitle("above ".repeat(n))).ms; const a = q(5000), b = q(10000), c = q(20000);
console.log(`scaling of /above .*cap/ on 'above '*n: n=5000 ${a.toFixed(1)} ms, 10000 ${b.toFixed(1)} ms, 20000 ${c.toFixed(1)} ms (quadratic if it ~x4 per doubling)`);
console.log(`worst single call ${worst.toFixed(1)} ms; ${fails ? fails + " FAILED (>250 ms)" : "all bounded"}`); process.exit(fails ? 1 : 0);
