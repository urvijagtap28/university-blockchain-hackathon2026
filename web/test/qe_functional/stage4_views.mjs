// Round 3 (7)(8)(9)(13)(14): read-only views after the paid runs (stage2_paid, stage3_batch). Key-free, no payment.
// Replaces the stale stage3_views/stage4_notes/ui/analyze2 (Inbox UI, Overview cards, tabs, triage notes no longer exist on the board; checks for them were dropped, the intent of the rest is kept).
import { readFileSync } from "node:fs";
import path from "node:path";
import { Browser, openPage, snapshot, banned, Checks, readLog, lastLine, verifyCli, ROOT, ADDR, sleep, sha256, saveJson, rpc } from "./r3.mjs";
const C = new Checks("stage4");
const recs = readLog(); const N = recs.length;
const br = await Browser.launch(9344);
const esc = async p => { await p.c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await p.c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(400); };
try {
  const p = await openPage(br, "http://127.0.0.1:4030/");
  await sleep(1200);
  const s = await snapshot(p);
  const nRep = recs.filter(r => r.verdict === "reproduced").length, forf = recs.filter(r => r.verdict === "not_reproduced").reduce((a, r) => a + Number(r.settledAtomic), 0), inc = recs.filter(r => r.verdict === "inconclusive").length;
  const nNot = recs.filter(r => r.verdict === "not_reproduced").length;
  const cli = verifyCli(); console.log("CLI:", JSON.stringify(cli));
  const m = /(\d+) of (\d+) verified/.exec(s.body);
  C.ok(cli.status === 0 && m && Number(m[1]) === N && Number(m[2]) === N && new RegExp(`${N} records`).test(cli.out), `trust badge '${N} of ${N} verified' equals verify-log CLI`, `${m && m[0]} / ${cli.out}`);
  C.ok(new RegExp(`${N} reports`).test(s.body) && new RegExp(`${nRep} reproduced`).test(s.body) && new RegExp(`\\$${(forf / 1e6).toFixed(2)} forfeited`).test(s.body) && new RegExp(`${inc} inconclusive`).test(s.body), "summary counts equal own recount from verdicts.jsonl", `${N}/${nRep}/${forf}/${inc}`);
  // manifest recount by sha256 (demo runs submit the manifest bytes, so their hashes match)
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "demo/manifest.json"), "utf8"));
  const byHash = new Map(manifest.entries.map(e => [sha256(readFileSync(path.join(ROOT, e.input))), e]));
  const known = recs.filter(r => byHash.has(r.reportHash));
  C.ok(known.length === N - 1 && recs.filter(r => !byHash.has(r.reportHash)).length === 1, "records matched to manifest by sha256: all demo runs, only the upload is unlabeled", `${known.length}/${N}`);
  // trust drawer
  await p.click(".trustbtn"); await sleep(500);
  const sn = await snapshot(p); console.log("--- trust drawer ---\n" + sn.trust);
  const headHash = /sha256\(last line\) ([0-9a-f]{64})/.exec(sn.trust || "");
  C.ok(headHash && headHash[1] === sha256(lastLine()), "trust drawer head hash == sha256(last log line)", headHash && headHash[1]);
  C.ok(new RegExp(`seq ${recs[N - 1].seq},`).test(sn.trust), "trust drawer head seq == last record seq");
  C.ok((sn.trust || "").includes(ADDR.signer), "trust drawer signer == derived signer pubkey");
  C.ok(sn.stubBarInDialog.trust === true, "stub bar inside trust drawer");
  C.ok(banned({ trust: sn.trust }).length === 0, "trust drawer banned tokens", banned({ trust: sn.trust }).join("|"));
  await p.shot("s4_trust"); await esc(p);
  const f0 = await p.eval(`({open:document.getElementById('trust').open, focus:document.activeElement?.className})`);
  C.ok(!f0.open && /trustbtn/.test(f0.focus), "Esc closes trust drawer and focus returns to the badge", JSON.stringify(f0));
  // ledger drawer
  await p.tab("results");
  const L = await p.eval(`[...document.querySelectorAll('#panel-results tbody tr:not(.drow)')].map(tr=>({lab:tr.querySelector('.ln').innerText, status:tr.children[1].innerText, settled:tr.children[2].innerText, tags:[...tr.querySelectorAll('.tag')].map(t=>t.innerText), href:tr.querySelector('a')?.href||null}))`);
  console.log("ledger rows:", JSON.stringify(L));
  const sorted = recs.slice().sort((a, b) => b.seq - a.seq);
  C.ok(L.length === N, `ledger has ${N} rows`, L.length);
  C.ok(L.every((r, i) => (r.href || "").includes(sorted[i].txSignature)), "every ledger Explorer link equals the log txSignature of that row (newest first)");
  C.ok(L.every((r, i) => (sorted[i].verdict === "reproduced" ? /^Reproduced/.test(r.status) : sorted[i].verdict === "not_reproduced" ? /^Not reproduced/.test(r.status) : /^Inconclusive/.test(r.status)) && r.settled === "$" + (Number(sorted[i].settledAtomic) / 1e6).toFixed(2)), "ledger status and settled amount equal the log for each row");
  C.ok(L.every(r => r.tags.length === 0), "ledger: no REAL/HAND-MADE tag beside any stub verdict", JSON.stringify(L.map(r => r.tags)));
  C.ok(L.some(r => r.lab === "Unlabeled"), "uploaded (non-manifest) proof shows as Unlabeled");
  await p.eval(`document.querySelectorAll('#panel-results .exp').forEach(b=>b.click())`); await sleep(300);
  const sd = await snapshot(p); const ledgerText = sd.ledger; saveJson("ledger_text.json", sd);
  C.ok(banned({ ledger: ledgerText }).length === 0, "ledger (all rows expanded) banned tokens", banned({ ledger: ledgerText }).join("|"));
  C.ok(recs.every(r => ledgerText.includes(r.reportHash)), "expanded rows show every report hash from the log");
  const ev = await p.eval(`[...document.querySelectorAll('#panel-results .drow .evd')].map(e=>({k:e.getAttribute('data-evidence'),t:e.innerText}))`);
  console.log("ledger evidence blocks:", JSON.stringify(ev.slice(0, 2)), ev.length);
  C.ok(ev.length === N && ev.every(e => /Stub verdict \(filename rule\)/.test(e.t) && !/crash|clean/.test(e.k)), "expanded evidence in stub mode is 'Stub verdict (filename rule)' only", JSON.stringify(ev.map(e => e.k)));
  C.ok(sd.stubBarInDialog.ledger === true, "stub bar inside ledger drawer");
  await p.shot("s4_ledger");
  const tiles = await p.eval(`[...document.querySelectorAll('#panel-results .tile')].map(t=>t.innerText.replace(/\\n+/g,' '))`); console.log("tiles:", JSON.stringify(tiles));
  C.ok(tiles.some(t => new RegExp(`^Reproduced ${nRep}`).test(t)) && tiles.some(t => new RegExp(`^Not reproduced.*${nNot}`).test(t)) && tiles.some(t => new RegExp(`^Inconclusive ${inc}`).test(t)), "ledger tiles equal recount", JSON.stringify(tiles));
  await esc(p);
  const f1 = await p.eval(`({open:document.getElementById('ledger').open, focus:document.activeElement?.id})`);
  C.ok(!f1.open && f1.focus === "tab-results", "Esc closes ledger, focus returns to the Ledger button", JSON.stringify(f1));
  // agent drawer
  await p.tab("policy"); const sa = await snapshot(p); console.log("--- agent drawer ---\n" + sa.agent);
  const spent = recs.reduce((a, r) => a + Number(r.settledAtomic), 0);
  C.ok(new RegExp(`Spent\\s*\\$${(spent / 1e6).toFixed(2)}`).test(sa.agent) && new RegExp(`Left\\s*\\$${((2e6 - spent) / 1e6).toFixed(2)}`).test(sa.agent) && /Reserved\s*\$0\.00/.test(sa.agent), "agent drawer meter equals the log (spent, left, reserved 0)", sa.agent);
  C.ok(/No decisions yet/.test(sa.agent), "agent drawer decision stream empty after a page load (per-session, this browser only: documented limitation)");
  C.ok(sa.stubBarInDialog.agent === true && banned({ agent: sa.agent }).length === 0, "agent drawer stub bar and clean text");
  await p.shot("s4_agent");
  await p.eval(`document.getElementById('agent').close()`);
  const mp = await p.eval(`({items:[...document.querySelectorAll('#panel-overview .mnt-i')].map(i=>({n:i.querySelector('.rep-n').innerText,tags:[...i.querySelectorAll('.tag')].length,href:i.querySelector('a')?.href||null}))})`);
  const repro = recs.filter(r => r.verdict === "reproduced").sort((a, b) => b.seq - a.seq);
  C.ok(mp.items.length === repro.length && mp.items.every((it, i) => it.tags === 0 && (it.href || "").includes(repro[i].txSignature)), "maintainer pane: one item per reproduced record, no tags, link == log signature", JSON.stringify(mp));
  const sigs = [...new Set(recs.map(r => r.txSignature))]; const bad = [];
  for (const sg of sigs) { const r = await rpc("getTransaction", [sg, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]); if (!r || r.meta.err !== null) bad.push(sg); }
  C.ok(bad.length === 0 && sigs.length === N, `all ${N} Explorer signatures are distinct, confirmed on RPC, no error`, bad.join(","));
  const hrefs = await p.eval(`[...document.querySelectorAll('a')].map(a=>a.href)`);
  C.ok(hrefs.length > 0 && hrefs.every(h => /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]+\?cluster=devnet$/.test(h) && sigs.some(x => h.includes(x))), "every anchor on the board is a devnet Explorer link of a log signature", JSON.stringify(hrefs.filter(h => !sigs.some(x => h.includes(x)))));
  const full = await snapshot(p);
  C.ok(banned({ body: full.body }).length === 0, "wording audit: banned tokens on final board", banned({ body: full.body }).join("|"));
  C.ok(!/failed/i.test(full.body), "wording audit: no 'failed' anywhere on the board after returned/forfeited runs");
  C.ok(!/Sandbox replays the proof/.test(full.body.replace(/\s+/g, " ")), "stub-mode board makes no 'Sandbox replays the proof' claim (console hint)", "console idle hint says it");
  await p.shot("s4_board");
  await p.close();
} finally { br.close(); }
process.exit(C.done() ? 1 : 0);
