// QE_FUNCTIONAL analysis: independent recomputation from the signed log file and RPC vs what the UI showed (flow3_<tag>.json, evidence1.json).
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ROOT, ADDR, loadJson, txInfo, sha256, saveJson } from "./lib.mjs";
const tag = process.argv[2] || "f3";
const LOG = path.join(ROOT, "web/run/stub/verdicts.jsonl");
const f3 = loadJson(`flow3_${tag}.json`);
const text = readFileSync(LOG, "utf8"); const lines = text.split("\n").filter(Boolean); const recs = lines.map(l => JSON.parse(l));
const res = []; const chk = (id, ok, msg) => { res.push({ id, ok, msg }); console.log((ok ? "PASS " : "FAIL ") + id + " " + msg); };
// (5) counts
const man = JSON.parse(readFileSync(path.join(ROOT, "demo/manifest.json"), "utf8"));
const cat = new Map(man.entries.map(e => [sha256(readFileSync(path.join(ROOT, e.input))), e.category]));
const mine = { reproduced: recs.filter(r => r.verdict === "reproduced").length, forfeited: recs.filter(r => r.verdict === "not_reproduced").length, inconclusive: recs.filter(r => r.verdict === "inconclusive").length,
  errors: recs.filter(r => !["reproduced", "not_reproduced", "inconclusive"].includes(r.verdict)).length, wrong: recs.filter(r => r.verdict === "not_reproduced" && cat.get(r.reportHash) === "real_bug").length };
const ui = f3.counts.map(c => parseInt(c.n)); 
chk("5.counts", JSON.stringify(ui) === JSON.stringify([mine.reproduced, mine.forfeited, mine.inconclusive, mine.errors, mine.wrong]), `UI ${JSON.stringify(ui)} vs computed ${JSON.stringify(Object.values(mine))}`);
const unlabeledOk = f3.api.log.records.every(r => (cat.has(r.reportHash) ? r.category === cat.get(r.reportHash) : r.category === null && r.label === null));
chk("5.labels", unlabeledOk, "API label/category equal manifest-by-sha256; non-manifest uploads have null label/category");
const cardUnl = f3.cards.filter(c => /UNLABELED/.test(c.tag ?? "")).length; chk("5.cards", cardUnl === recs.filter(r => !cat.has(r.reportHash)).length, `UI UNLABELED cards ${cardUnl} vs computed ${recs.filter(r => !cat.has(r.reportHash)).length}`);
// (6)
const signer = f3.api.log.signer; const v = spawnSync("node", ["scripts/verify-log.ts", LOG, "--pubkey", signer], { cwd: path.join(ROOT, "server"), encoding: "utf8" });
const m = /OK: (\d+) records/.exec(v.stdout); const mm = /(\d+) of (\d+) log entries verified/.exec(f3.verifiedLine);
chk("6.verify", v.status === 0 && m && mm && m[1] === mm[1] && mm[1] === mm[2], `verify-log: ${v.stdout.trim()} | UI: "${f3.verifiedLine}" | signer is the pinned launcher key: ${signer === ADDR.signer}`);
// (7)
const head = sha256(lines[lines.length - 1]); chk("7.head", f3.trust.includes(head) && f3.api.log.head.hash === head && f3.trust.includes("seq " + (recs.length - 1)), `sha256(last line)=${head.slice(0, 16)}.. on page: ${f3.trust.includes(head)}`);
// (12) every explorer link equals a log signature, and confirmed
const sigs = new Set(recs.map(r => r.txSignature)); const allLinks = new Set(); let nLinks = 0;
for (const [t, ls] of Object.entries(f3.allLinks)) ls.forEach(h => { nLinks++; const s = (/\/tx\/([^?]+)\?cluster=devnet$/.exec(h) || [])[1]; allLinks.add(s); });
const ev = existsSync(path.join(process.env.QE_SCRATCH || "", "x")) ? null : loadJson("evidence1.json");
(ev?.steps ?? []).forEach(s => (s.links ?? []).forEach(h => { const x = (/\/tx\/([^?]+)\?cluster=devnet$/.exec(h) || [])[1]; allLinks.add(x); }));
const notInLog = [...allLinks].filter(s => !sigs.has(s)); chk("12.links_in_log", notInLog.length === 0 && f3.resultsLinks.length === recs.length, `${allLinks.size} distinct links seen (results page ${f3.resultsLinks.length} links for ${recs.length} records); not in log: ${notInLog.length}`);
const onchain = []; for (const r of recs) { const t = await txInfo(r.txSignature); onchain.push({ seq: r.seq, verdict: r.verdict, logged: Number(r.settledAtomic), payToDelta: t?.payToDelta, err: t?.err }); }
chk("12.confirmed", onchain.every(o => o.err === null && o.payToDelta === o.logged), "each settle tx confirmed (err null) and payTo USDC delta == logged settledAtomic: " + JSON.stringify(onchain.map(o => `${o.seq}:${o.logged}/${o.payToDelta}`)));
chk("12.cardlinks", f3.cards.every(c => c.links.length === 1) , "every card exactly one Explorer link");
// (13)
const tabs = Object.entries(f3.tabs); chk("13.stub_banner", tabs.every(([t, x]) => x.stubBanner.length === 1 && x.stubBanner[0].visible && !x.stubBanner[0].closeBtn), "STUB banner present, visible, no close button on all 5 tabs: " + tabs.map(([t, x]) => t + ":" + x.stubBanner.length).join(" "));
const realHits = [...new Set(tabs.flatMap(([t, x]) => x.fullBodyReal))]; chk("13.no_REAL_label", realHits.every(h => /REAL BUG/.test(h)), "uppercase REAL occurrences in whole page (all tabs share body text): " + JSON.stringify(realHits));
// inbox
const inboxApi = f3.api.inbox.items; const want = recs.filter(r => r.verdict === "reproduced" || r.verdict === "inconclusive").map(r => r.reportHash).reverse();
chk("11.inbox_set_order", JSON.stringify(inboxApi.map(i => i.reportHash)) === JSON.stringify(want) && inboxApi.every(i => ["reproduced", "inconclusive"].includes(i.verdict)), `API items ${inboxApi.length} == reproduced+inconclusive newest first (${want.length})`);
chk("11.inbox_ui", f3.inbox.map(i => i.hash).filter(Boolean).join() === want.join(), "UI inbox cards in same order");
// session budget
const spent = recs.reduce((s, r) => s + Number(r.settledAtomic), 0); chk("budget", f3.api.config.session.spentAtomic === String(spent) && f3.api.config.session.reservedAtomic === "0", `session spent ${f3.api.config.session.spentAtomic} reserved ${f3.api.config.session.reservedAtomic}; log sum ${spent}`);
saveJson(`analysis_${tag}.json`, { res, mine, onchain });
