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
