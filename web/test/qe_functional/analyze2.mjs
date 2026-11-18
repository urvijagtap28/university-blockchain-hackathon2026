// Round 2 analysis: independent recount from verdicts.jsonl + demo/manifest.json vs what the UI showed (stage2.json, stage3.json); verify-log; head hash; links vs log and RPC; agent log vs UI facts vs the decoded 402; conservation.
import { readFileSync } from "node:fs"; import { spawnSync } from "node:child_process"; import path from "node:path";
import { ROOT, ADDR, loadJson, txInfo, sha256, saveJson, balances } from "./lib.mjs";
const LOG = path.join(ROOT, "web/run/stub/verdicts.jsonl");
const lines = readFileSync(LOG, "utf8").split("\n").filter(Boolean); const recs = lines.map(l => JSON.parse(l));
const s2 = loadJson("stage2.json"), s3 = loadJson("stage3.json"), c402 = loadJson("402.json");
const res = []; const chk = (id, ok, msg) => { res.push({ id, ok, msg }); console.log((ok ? "PASS " : "FAIL ") + id + " " + msg); };
const man = JSON.parse(readFileSync(path.join(ROOT, "demo/manifest.json"), "utf8"));
const cat = new Map(man.entries.map(e => [sha256(readFileSync(path.join(ROOT, e.input))), e.category]));
const cnt = { reproduced: recs.filter(r => r.verdict === "reproduced").length, forfeited: recs.filter(r => r.verdict === "not_reproduced").length, inconclusive: recs.filter(r => r.verdict === "inconclusive").length, errors: recs.filter(r => !["reproduced", "not_reproduced", "inconclusive"].includes(r.verdict)).length };
const tileNums = t => t.map(x => Number(x.split(" ").pop()));
chk("5.counts_overview", JSON.stringify(tileNums(s3.overview.tiles)) === JSON.stringify(Object.values(cnt)), `UI ${s3.overview.tiles.join("; ")} vs recount ${JSON.stringify(cnt)}`);
chk("5.counts_ledger", JSON.stringify(tileNums(s3.ledger.tiles)) === JSON.stringify(Object.values(cnt)), "Ledger tiles same");
chk("5.wrong_n/a", /n\/a/.test(s3.wrongPop), "stub mode: wrongly forfeited shows n/a: " + s3.wrongPop);
// cards
const good = recs.filter(r => r.settlementStatus === "settled");
const newestRet = [...good].reverse().find(r => ["reproduced", "inconclusive"].includes(r.verdict) && r.settledAtomic === "0"), newestForf = [...good].reverse().find(r => r.verdict === "not_reproduced" && r.settledAtomic !== "0");
const link = r => `https://explorer.solana.com/tx/${r.txSignature}?cluster=devnet`;
const cr = s3.overview.cards.find(c => c.kind === "returned"), cf = s3.overview.cards.find(c => c.kind === "forfeited");
chk("5.card_returned", cr.links[0] === link(newestRet) && cr.text.includes(newestRet.verdict === "reproduced" ? "Reproduced" : "Inconclusive") && /\$0\.25\s*\n\s*\n?\$0\.25 locked → returned/.test(cr.text) && (cat.has(newestRet.reportHash) ? !/Unlabeled/.test(cr.text) : /Unlabeled/.test(cr.text)), `newest returned seq ${newestRet.seq} ${newestRet.verdict}; card: ${JSON.stringify(cr.text.slice(0, 80))}`);
chk("5.card_forfeited", cf.links[0] === link(newestForf) && /Not reproduced/.test(cf.text) && /\$0\.25 locked → paid out/.test(cf.text) && /REAL/.test(cf.text) && cat.get(newestForf.reportHash) === "real_bug", `newest forfeited seq ${newestForf.seq}; label from manifest by sha256: ${cat.get(newestForf.reportHash)}`);
// labels
const rowsTxt = s3.ledger.rows.map(r => r.text);
const labelOk = recs.slice().reverse().every((r, i) => { const c = cat.get(r.reportHash); const t = rowsTxt[i]; return c === "real_bug" ? /\| REAL \|/.test(t) : c === "hand_made_fake" ? /HAND-MADE/.test(t) : /Unlabeled/.test(t) && !/REAL|HAND-MADE/.test(t); });
chk("5.labels", labelOk, "ledger labels == manifest-by-sha256; upload not in manifest 'Unlabeled': " + rowsTxt.map(t => t.slice(0, 40)).join(" // "));
// 6 verify-log
const v = spawnSync("node", ["scripts/verify-log.ts", LOG, "--pubkey", ADDR.signer], { cwd: path.join(ROOT, "server"), encoding: "utf8" });
const m = /OK: (\d+) records/.exec(v.stdout); const mm = /(\d+) of (\d+)/.exec(s3.ledger.trust);
chk("6.verify-log", v.status === 0 && m && mm && m[1] === mm[1] && mm[1] === mm[2] && s3.overview.trust === s3.ledger.trust, `verify-log: ${v.stdout.trim()} | UI badge "${s3.ledger.trust}" / overview "${s3.overview.trust}" | signer in drawer == pinned launcher key: ${s3.trust.includes(ADDR.signer)}`);
const head = sha256(lines[lines.length - 1]);
chk("6.head", s3.trust.includes(head) && s3.trust.includes("seq " + (recs.length - 1)), `sha256(last line)=${head} found in drawer`);
// ledger rows evidence & details
chk("6.rows", s3.expanded.length === recs.length && s3.expanded.every((e, i) => { const r = recs[recs.length - 1 - i]; return e.text.includes(r.reportHash) && e.text.includes(r.detail) && e.text.includes("seq " + r.seq) && e.evd === "stub"; }), "expanded rows show hash, detail, seq, stub evidence");
chk("6.row_amounts_links", s3.ledger.rows.every((row, i) => { const r = recs[recs.length - 1 - i]; return row.link === link(r) && row.text.includes("$" + (Number(r.settledAtomic) / 1e6).toFixed(2)); }), "ledger rows: amount and link == log");
// 2/3/4: run records vs UI vs agent log vs 402
const acc = c402.accepts[0];
for (const r of s2.runs) {
  const rec = r.newRecords[0]; const al = (r.agentLog || "").split("\n").filter(Boolean).map(l => JSON.parse(l)); const by = e => al.find(x => x.event === e);
  const subs = r.fin.steps.flatMap(s => s.subs.map(x => x.t));
  const resv = by("reserve"), sig = by("payment_signed");
  const want = [`✓ Read 402: ${(Number(resv.askAtomic) / 1e6).toFixed(2)} USDC, ${resv.scheme}, devnet, ${resv.maxTimeoutSeconds} s`, `✓ Within the $${(Number(resv.capAtomic) / 1e6).toFixed(2)} per-report cap`, `✓ Budget left: $${(Number(resv.remainingAtomic) / 1e6).toFixed(2)}`, "✓ Endpoint allowed (localhost:4021)", "✓ Approved in the web UI", "✓ upto authorization signed"];
  chk(`2.facts_${r.name}`, JSON.stringify(subs) === JSON.stringify(want), `UI sub-lines == agent log facts: ${JSON.stringify(subs)}`);
  chk(`2.402_${r.name}`, resv.askAtomic === acc.amount && resv.scheme === acc.scheme && resv.network === acc.network && resv.maxTimeoutSeconds === acc.maxTimeoutSeconds && sig.payTo === acc.payTo && sig.network === acc.network && acc.network === "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "agent-logged ask/scheme/network/timeout/payTo == decoded PAYMENT-REQUIRED from an unpaid probe (0.25 USDC=250000, upto, devnet, 300 s)");
  const settled = by("settle_result");
  chk(`2.record_${r.name}`, r.newRecords.length === 1 && rec.settledAtomic === settled.settledAtomic && rec.verdict === settled.verdict && rec.txSignature === settled.tx && r.fin.links.length === 1 && r.fin.links[0] === link(rec), `log record seq ${rec.seq} ${rec.verdict} settled ${rec.settledAtomic}; agent settle_result same; UI link == log txSignature`);
  const returned = rec.settledAtomic === "0";
  chk(`14.wording_${r.name}`, returned ? (r.fin.ocardTitle === "Bond returned" && r.fin.hero[0] === "$0.25" && r.fin.hero[1] === "back to your wallet" && !/failed/i.test(r.fin.text)) : (r.fin.ocardTitle === "Bond forfeited" && r.fin.hero[0] === "$0.25" && r.fin.hero[1] === "paid out" && !/returned/i.test(r.fin.ocardTitle + r.fin.hero.join(""))), `${r.fin.ocardTitle} | ${r.fin.hero.join(" ")} | no 'failed' in run panel: ${!/failed/i.test(r.fin.text)}`);
  chk(`2.stub_evd_${r.name}`, r.fin.evd.kind === "stub" && r.fin.evd.text === "Stub verdict (filename rule)" && /evd-stub/.test(r.fin.evd.cls) && !/evd-evidence/.test(r.fin.evd.cls), `evidence block kind ${r.fin.evd.kind} (${r.fin.evd.cls}), border ${r.fin.evd.border}`);
  chk(`7.delta_${r.name}`, r.bal.buyer.usdc === -Number(rec.settledAtomic) && r.bal.payTo.usdc === Number(rec.settledAtomic) && r.bal.buyer.lamports === 0, `buyer ${r.bal.buyer.usdc} payTo +${r.bal.payTo.usdc} buyer SOL ${r.bal.buyer.lamports} facilitator SOL ${r.bal.facilitator.lamports}`);
  r.onchain = await txInfo(rec.txSignature);
  chk(`12.rpc_${r.name}`, r.onchain && r.onchain.err === null && r.onchain.payToDelta === Number(rec.settledAtomic), `settle tx confirmed, payTo token delta ${r.onchain?.payToDelta}`);
  chk(`2.mid_${r.name}`, !r.mid || (!/no payment was made/i.test(r.mid.text)), "mid-run panel never says no payment was made");
}
// 12 all links on all screens
const sigs = new Set(recs.map(r => r.txSignature)); const seenLinks = new Set(Object.values(s3.links).flat().map(h => (/\/tx\/([^?]+)\?cluster=devnet$/.exec(h) || [])[1]));
chk("12.links_in_log", [...seenLinks].every(s => sigs.has(s)) && seenLinks.size === recs.length, `${seenLinks.size} distinct explorer links across all tabs, all in the log (log has ${recs.length}); per tab: ${Object.entries(s3.links).map(([t, l]) => t + ":" + l.length).join(" ")}`);
const oc = []; for (const r of recs) { const t = await txInfo(r.txSignature); oc.push(`${r.seq}:${r.settledAtomic}/${t?.payToDelta}/${t?.err}`); }
chk("12.all_confirmed", oc.every(x => { const [, a, b, e] = x.split(/[:/]/); return a === b && e === "null"; }), "every log signature confirmed (err null), payTo delta == logged: " + oc.join(" "));
// 7 conservation
const b0 = s2.runs[0].b0, bf = await balances(); const sum = recs.reduce((s, r) => s + Number(r.settledAtomic), 0);
chk("7.conservation", sum === b0.buyer.usdc - bf.buyer.usdc && sum === bf.payTo.usdc - b0.payTo.usdc, `log sum ${sum}; buyer ${b0.buyer.usdc}->${bf.buyer.usdc}; payTo ${b0.payTo.usdc}->${bf.payTo.usdc}; facilitator SOL ${b0.facilitator.lamports}->${bf.facilitator.lamports} (${(bf.facilitator.lamports - b0.facilitator.lamports)} lamports)`);
// 8 refusals
chk("8.429", s2.t429.logDelta === 0 && /429/.test(s2.t429.text) && /No payment was made/.test(s2.t429.text) && Object.values(s2.t429.bal).every(b => b.usdc === 0 && b.lamports === 0), "429: no new log record, no balance change; text " + JSON.stringify(s2.t429.text.split("\n").filter(x => /429/.test(x))));
chk("8.409", /409/.test(s2.t409.text) && /No payment was made/.test(s2.t409.text) && s2.runs[1].newRecords.length === 1, "409 from armed second tab; the first job produced exactly 1 record; text " + JSON.stringify(s2.t409.text.split("\n").filter(x => /409/.test(x))));
chk("sanity.badstrings", s3.dump.bad.length === 0 && s2.runs.every(r => !/\bnull\b|undefined|NaN|\[object Object\]|atomic/i.test(r.fin.text)), "no null/undefined/NaN/[object Object]/atomic in any tab dump or run panel");
// stages 4-6
const s4 = loadJson("stage4.json"), s5 = loadJson("stage5.json"), s6 = loadJson("stage6.json");
chk("10.notes_persist", s4.afterNote[0].on[0] === "Valid" && s4.afterReload[0].on[0] === "Valid" && s4.afterReload[0].text === s4.afterNote[0].text && s4.inst2cards[0].on[0] === "Valid" && s4.afterReload[1].on.length === 0, "note set via UI click, survives reload and a second web instance on the same file; other hash untouched");
chk("10.per_hash", s4.inst2after[1].on[0] === "Misuse" && s4.inst2after[0].on[0] === "Valid", "different decision on the other hash does not change the first");
chk("10.cap", s4.fill.last?.status === 413 && s4.capUi.length === 1 && /full \(500 notes/.test(s4.capUi[0]) && s4.noteLines === 500, "500-note cap: API 413 after " + s4.fill.ok + " fill notes (+2 earlier = 500 lines); UI: " + s4.capUi[0]);
chk("15.clipboard", s4.copyBtn === "Copied" && s4.clipEq, "proof hash button -> 'Copied', navigator.clipboard.readText() == full 64-hex hash");
chk("8.422", /Refused \(422, session budget\)/.test(s5.submitText) && /\$0\.10 of \$0\.10/.test(s5.submitText) && !/\d{5,}/.test(s5.submitText.split("Submit\n").pop()) && s5.logDelta === 0 && Object.values(s5.bal).every(b => b.usdc === 0 && b.lamports === 0), "422 on a $0.10-budget instance: dollars, no record, no balance change");
chk("9.kill_no_false_claim", s6.everSaidNoPayment === false && /UNKNOWN/.test(s6.t1) && /Lost the live connection/.test(s6.t1) && s6.finalCard.title === "Bond returned" && s6.finalCard.link.includes(s6.record.tx) && s6.finalCard.details.some(d => /read back from the signed verdict log/.test(d)), `UI after SIGTERM shows UNKNOWN, never 'no payment was made'; after restarting the web app alone it reads the outcome back from the log (${s6.recoveredAfterMs} ms): ${s6.finalCard.title}, seq ${s6.record.seq}, settled ${s6.record.settledAtomic}`);
chk("11.agent_tab", s6.agentTab.decisions.length === 4 && s6.agentTab.decisions[0].includes("sign") && s6.agentTab.decisions[3].includes("allowlist") && /\$0\.25 reserved/.test(s6.agentTab.budget) && /Allowed\nlocalhost:4021/.test(s6.agentTab.text), "decision stream (newest first: sign, approve, reserve, allowlist) and meter ($0.25 reserved mid-run) from the page that ran the job");
saveJson("analysis2.json", res);
console.log(`${res.filter(x => x.ok).length}/${res.length} pass`);
