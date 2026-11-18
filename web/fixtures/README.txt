Fixtures for the web app (shapes follow "Web app contract" in AGENTS/INTERFACES.md exactly; no extra fields).
Stub variants reuse the real signatures, hashes and timestamps from the 2026-11-17 stub run (demo/run).
Real variants (config.real, log.real, log.real.tampered, inbox.real) are ILLUSTRATIVE ONLY: details such as the ASan frames
are not from a recorded real run through this app and sigOk values are not computed. They must never be presented as evidence.
log.xss, inbox.xss, config.xss, sse.xss.txt carry <img onerror> payloads and a non-base58 signature to test text-only rendering.
Fixture-mode query params on web/public/index.html: fixtures=1 mode=stub|real log=ok|tampered|empty|xss|error inbox=ok|empty|xss xss=1 busy=1
scenario=success_returned|success_forfeited|refused|settlement_pending|error|xss|busy|budget_exhausted|rate_limited|too_large|dropped|dropped_norecord autorun=<demoInputIndex> tab=<name> delay=<ms>.
Files: config.{stub,real,busy,xss}.json, log.{stub,real,tampered,real.tampered,empty,xss}.json, inbox.{stub,real,empty,xss}.json, notes.ok.json,
submit.{202,409,413,422,429}.json, sse.{success_returned,success_forfeited,refused,settlement_pending,error,xss}.txt.

sse.dropped.txt / sse.dropped_norecord.txt: stream ends after the 'sign' event with no done (simulated connection drop, QE-F-001); the first has a matching log record, the second does not.
Fixture mode is honored only from file:// or when /fixtures/ is served next to the page; the live server ignores ?fixtures=1.

PRODUCT PASS 2 additions (illustrative unless stated):
- log.real.json / inbox.real.json / log.real.tampered.json details now use the exact strings verifier/verify.py writes. seq 0,1,2 (and the 47 B / 3 B clean ones) are copied from the recorded docs/evidence/real-run-2026-11-17 and backtest/RESULTS.md; the SEGV inconclusive (seq 5) is a recorded backtest string. The records themselves (hashes, labels, tx signature on seq 5, timestamps) are ILLUSTRATIVE, not a recorded run through this app.
- log.{real,stub}.returned_only.json (log=returned_only): two reproduced records, no forfeited one (Overview one-card state).
- sse.real_{returned,forfeited,inconclusive,refused}.txt (scenario=real_*; mode=real picks real_returned / real_forfeited automatically): decision wording is what web/lib/jobs.mjs mapDecision emits today. Verdict details are verify.py format; ILLUSTRATIVE transcripts, not recorded.
- sse.success_forfeited.txt detail is now "stub: default" (what the stub verifier writes).

D-019/D-020 additions (ILLUSTRATIVE, not recorded from a run; shapes follow the optional `facts` field in INTERFACES.md):
- sse.facts_{returned,forfeited,refused}.txt (scenario=facts_*): decision events with `facts` as web/lib/jobs.mjs now sends them. The verdict/settled tail of returned/forfeited is copied from sse.real_*.
- hostile.facts.txt (scenario=hostile_facts): facts that VIOLATE the contract (HTML, 500-char network, 88-char payTo, unknown key). fixtures.test.mjs asserts the contract checker rejects it; the UI must show only the valid parts (0.25 USDC, cap tick) and execute nothing.
