// QE_FUNCTIONAL round 3 helpers (single-board layout). Key-free: builds on lib.mjs (reads .env only for SVM_RPC_URL and derived public addresses).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Browser, Page, ROOT, ADDR, SCRATCH, sleep, sha256, saveJson } from "./lib.mjs";
export * from "./lib.mjs";

export const BANNED = /\b(null|undefined|NaN|atomic)\b|\[object Object\]/;
export const LOG = path.join(ROOT, "web/run/stub/verdicts.jsonl");
export const readLog = (f = LOG) => existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
export const lastLine = (f = LOG) => { const l = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean) : []; return l[l.length - 1] ?? null; };
export const verifyCli = (f = LOG) => { const r = spawnSync(process.execPath, [path.join(ROOT, "server/scripts/verify-log.ts"), f, "--pubkey", ADDR.signer], { encoding: "utf8" }); return { status: r.status, out: (r.stdout || "").split("\n")[0] }; };

/** Page with Network capture of requests (observation only, no hooks). */
export async function openPage(br, url, w = 1280, h = 900) {
  const p = await br.newPage(null, w, h);
  p.reqs = [];
  await p.c.send("Network.enable");
  p.c.on(m => { if (m.method === "Network.requestWillBeSent") p.reqs.push({ url: m.params.request.url, method: m.params.request.method, t: Date.now() }); });
  await p.goto(url);
  return p;
}
export const submits = p => p.reqs.filter(r => r.method === "POST" && r.url.endsWith("/api/submit"));
export const bodyText = p => p.eval(`document.body.innerText`);
/** text of the page plus every open dialog (dialogs are top-layer; body.innerText includes them but we also list them) */
export async function snapshot(p) {
  return p.eval(`(()=>{const o={body:document.body.innerText};for(const id of ['confirm','ledger','agent','trust']){const d=document.getElementById(id);o[id]=d&&d.open?d.innerText:null}
    o.stubBarInDialog={};for(const id of ['confirm','ledger','agent','trust']){const d=document.getElementById(id);if(d&&d.open)o.stubBarInDialog[id]=/STUB MODE/.test(d.querySelector('.dbars')?.innerText||'')}
    o.tagsNearVerdict=[...document.querySelectorAll('.pill')].filter(x=>/Reproduced|Not reproduced|Inconclusive/.test(x.innerText)).map(x=>{const row=x.closest('li,tr,.mnt-i,.ocard');return row?[...row.querySelectorAll('.tag')].map(t=>t.innerText):[]}).flat();
    return o})()`);
}
export function banned(texts) { const bad = []; for (const [k, t] of Object.entries(texts)) if (typeof t === "string") { const m = BANNED.exec(t); if (m) bad.push(`${k}: ${m[0]} ...${t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, " ")}`); } return bad; }
export class Checks {
  constructor(name) { this.name = name; this.rows = []; }
  ok(cond, msg, extra = "") { this.rows.push({ pass: !!cond, msg, extra: String(extra).slice(0, 300) }); console.log((cond ? "PASS " : "FAIL ") + msg + (cond ? "" : "  => " + String(extra).slice(0, 300))); return !!cond; }
  done() { const f = this.rows.filter(r => !r.pass).length; console.log(`${this.name}: ${this.rows.length - f}/${this.rows.length} pass`); saveJson(`checks_${this.name}.json`, this.rows); return f; }
}
export { Browser, Page, sleep, sha256, ADDR, ROOT, SCRATCH };
