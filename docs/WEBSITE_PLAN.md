# WEBSITE PLAN: local-only working web app for the Prove-It Bond demo
For: the ORCHESTRATOR (dispatches subagents). Written 2026-11-17. Decision owner: the user (Person A). Record this as D-016 in AGENTS/DECISIONS.md before dispatching.

## 0. Decision and scope change (user, 2026-11-17)
The user lifted the CLAUDE.md scope limits for the website only: a sender screen, a live status view, a results/trust screen and a maintainer screen are IN. Local-only: the app binds to 127.0.0.1 and is never hosted publicly. Everything else in CLAUDE.md still holds: the money-path rules, "settle $0 on every error path", devnet only, no real keys, honesty rules, no claim the sandbox is escape-proof. No custom escrow program, no auth system, no real database (JSON files on disk are fine), no reputation tiers.

Priority: B's real-verifier run (scripts/demo.sh --real on Person B's WSL laptop) outranks this. If it needs help, pause this work. First on the cut list after the verdicts and backtest.

## 1. What already exists (reuse, do not rebuild)
- server/ : POST /report (raw body <= 64 KB), x402 upto, settle clamp, $0 on every error path, concurrency cap 2, per-wallet rate limit 1/10 s, signed hash-chained verdict log (server/src/verdictlog.ts, verifyLogText), verify-log script.
- agent/ : the sender CLI with cap $0.25, session budget, allowlist, approval prompt, 429/busy backoff, JSON-lines decision log (agent/decisions.log). One process per report; its session budget is PER PROCESS.
- demo/run.mjs + scripts/demo.sh : starts facilitator (once) and server, runs the agent per report, analyze() verifies the log and checks txs on chain; writes RESULTS.md and results.json. demo/web/build.mjs + template.html : self-contained dark results page (banner, counts, cards, trust panel), negative tests in demo/web/test/.
- The log stores ONE tx signature per record (the settle). The deposit/escrow-open signature is NOT recorded. The UI must never imply two links.
- Proof = an input file, not a script. /report takes no title or description.

## 2. Architecture
```
Browser (static pages, no framework, no CDN, no external requests)
   |  http://127.0.0.1:PORT   (loopback only)
web/server.mjs  (Node, no keys of its own: holds only AGENT_* env for the child it spawns)
   |-- spawns agent CLI per submission (same code path as demo/run.mjs runAgent)
   |-- reads agent decision log + run result -> SSE events to the browser
   |-- reads/verifies verdicts.jsonl (verifyLogText) -> /api/log, /api/inbox
   |-- appends triage notes to web/data/notes.jsonl (notes only, no money)
   v
existing server (:4021) + facilitator (:4022) + verifier (stub on Mac, real on B's laptop)
```
The web process must NOT receive SVM_PRIVATE_KEY or SVM_RECEIVER_AUTHORIZER_PRIVATE_KEY or LOG_SIGNING_KEY. Child agent gets only AGENT_* and SVM_RPC_URL. Start order and PIDs: reuse the demo runner's process handling (start once, stop by PID, never restart the facilitator mid-session, never pkill by pattern).

## 3. Screens
1. **Submit** : choose a proof file (<= 64 KB) or one of the demo inputs (from demo/manifest.json, labeled HAND-MADE where applicable). Shows the quote (bond $0.25, returned if reproduced or inconclusive, forfeited if not reproduced), pinned libucl commit and fix-image caveat, sandbox limits (no network, 60 s cap, CPU/mem limits, read-only FS). A confirm dialog ("The demo agent will pay up to $0.25 from the demo wallet") is the user's approval; only then does the backend start the agent with AGENT_AUTO_APPROVE_USD=0.25. Persistent banner: "Demo wallet pays on your behalf. This is not a third-party sender."
2. **Run (live status)** : steps as events arrive: policy check (allowed/refused with reason), approved, payment signed, verdict, settled (amount, settle-tx Explorer link), plain statement of whether the bond came back. Pending settle shows "checking the chain", not "failed". Errors show settled amount ($0 expected) and the exact refusal or error text (as text).
3. **Results and trust** : reuse demo/web/template.html components against the live log: mode banner, counts (labels hand-assigned footnote), cards with settle-tx links, "N of N entries verified", signer key, head hash, tail-truncation caveat.
4. **Maintainer inbox** : reproduced and inconclusive reports from the signed log, newest first: error type and top frame parsed from the verdict detail (only what the log holds; no invented traces), proof hash, case, commit. Triage buttons (valid / not a bug / misuse) write local notes only and are labeled "triage notes, not payouts". Single-use authorization means nothing here moves money.
5. **Agent policy** : cap, session budget (spent/remaining), allowlist, approval threshold, retry budget, and the decision log stream.

Vocabulary everywhere: reproduced, not reproduced, inconclusive, error. Plain words first ("Bond returned", "Bond forfeited"), technical detail one click away. Stub mode: loud, un-dismissable banner on every screen; stub results can never be exported or presented as evidence. Dark, minimal, monospace for hashes. Everything from reports or logs is rendered with textContent, never innerHTML. Explorer URLs only from signatures matching a base58 pattern.

## 4. Backend API (contract; write into AGENTS/INTERFACES.md first)
- `GET /api/config` : mode (stub|real), policy values, pinned commit/images, limits, demo wallet public address, demo inputs list, session budget used/remaining.
- `POST /api/submit` : body = raw proof bytes (<= 65536) with `x-filename`; requires `x-csrf-token`; returns `{jobId}`. One job at a time (verifier cap and per-wallet limit); a second submit while busy returns 409 with a clear message. The backend keeps a CUMULATIVE session budget across jobs (reserve $0.25 before spawn, release to the settled amount after) because each agent process only knows its own budget; refuse above AGENT_SESSION_BUDGET_USD.
- `GET /api/jobs/:id/events` : Server-Sent Events: `decision` (parsed agent decision lines), `verdict`, `settled`, `error`, `done`. Source of truth for amounts and signatures is the verdict log record matched by proof hash, not the agent's console output.
- `GET /api/log` : records plus verification result (count verified, named broken entries) with the pinned signer key from meta/config.
- `GET /api/inbox`, `POST /api/notes` : read-only view of reproduced/inconclusive; notes appended to web/data/notes.jsonl (gitignored).
- Static files served from an allowlist only (no directory listing, no path traversal, never keys/ or .env).

## 5. Security requirements (QE must test each)
- Bind 127.0.0.1 only; refuse to start if configured to a non-loopback address.
- Check the Host header (DNS rebinding) and the Origin header on every POST; CSRF token on state-changing routes; no CORS headers.
- 64 KB request cap enforced by the web layer too; reject others before spawning.
- No shell interpolation of filenames: spawn with argument arrays, write uploads to a scratch file named by hash.
- The web process never reads or logs key material; response bodies and SSE never contain env values.
- Rate limit submits (>= 11.5 s apart) and one job at a time.
- Escape/render-as-text for all report-derived strings (XSS fixtures).
- README states: local-only; a public deployment would let anyone spend from the demo wallet and run untrusted input on the host; this is not offered.

## 6. Agents and phases (dispatch rules: independent agents in parallel, builders never sign off their own work, each updates its AGENTS/<NAME>.md, log evidence in BUILD_LOG.md, commit per milestone with a short message, never push)

**W0 (orchestrator, 20 min).** Write D-016, put the API contract and SSE event schema in AGENTS/INTERFACES.md, add AGENTS/WEB_BACKEND.md, WEB_FRONTEND.md, QE_WEB.md from the template, add fixtures: sample SSE transcripts and /api/log responses (stub run in demo/run/ can seed them).

**W1 (parallel):**
- WEB_BACKEND (Person A area): web/server.mjs and helpers per sections 2, 4, 5. Reuse demo/run.mjs process handling and runAgent, verifyLogText, agent env filtering. Unit tests for budget accounting, host/origin/CSRF checks, size cap, one-job-at-a-time, filename safety.
- WEB_FRONTEND: web/public/ pages for screens 1 to 5 against the fixtures (no live backend needed), reusing demo/web/template.html styles and components. States: empty, loading, error, busy, refused, pending ("checking the chain").
Files do not overlap; the contract in INTERFACES.md is the only coupling.

**W2 (integration, stub on the Mac).** Wire frontend to backend, run the full flow on devnet with the stub verifier: reproduced (bond returned), not reproduced (forfeited), refusal (over-budget or bad file), busy, killed child. Confirm balances and tx links on chain. Needs ports 4021/4022 free and the repo .env; backend started by a script (extend scripts/demo.sh or add scripts/web.sh).

**W3 (QE, separate agents).**
- QE_WEB_SECURITY: section 5 probes, including DNS rebinding with a spoofed Host, cross-origin POST, oversize, path traversal, concurrent submits, XSS fixtures, and a check that no key appears in any response, log or process env of the web process.
- QE_FUNCTIONAL: re-runs W2 flows from a clean state; compares UI counts to the signed log; verifies every settle link and amount on chain.

**W4 (Person B's laptop, real verifier).** After B's `scripts/demo.sh --real` has passed: run the web app there, submit the real bug and a fake through the UI, capture the real run for the video. Real-mode view is UNVERIFIED until this happens.

**W5 (optional, only if W3 and W4 are green).** Replay with timeline, presentation mode, evidence pane (first ASan frame from the real run's detail; hidden on stub), committed snapshot of one real run's report.html.

## 7. Definition of done
- All flows above run end to end with observed output pasted into BUILD_LOG.md (commands, outputs, tx signatures); anything unrun marked UNVERIFIED.
- QE_WEB_SECURITY and QE_FUNCTIONAL green (no P0/P1) with evidence.
- Stub banner present and un-dismissable on every screen in stub mode; real mode label only when the log verifies and checks pass.
- UI counts equal the signed log's counts; settled amounts equal on-chain deltas.
- README gains a "Web app" section: how to start it, local-only rule, demo-wallet disclosure, what is and is not verified.

## 8. Cut order if time runs short
1. W5 extras. 2. Maintainer inbox (keep results and submit). 3. Agent policy screen. 4. Live SSE (fall back to a results page refreshed after the run). Never cut the stub/real labeling or the security checks for anything that spends money.

## 9. Human items
- Confirm the demo wallet is the buyer wallet on the host machine (B's laptop for the real run) and that the web app runs only there and on Person A's Mac with the stub.
- Review the Submit-screen wording (quote, demo-wallet disclosure) and the Maintainer screen labels.
- Record the video on the real run; capture Solana Explorer yourself.
- Optional: a one-hour spike on browser-wallet signing for upto. Not in this plan; only if the user asks, and drop it if it does not work within the hour.

## 10. Risks
- Per-process agent budget (handled by the backend's cumulative budget).
- Deposit signature not in the log (UI says so; recording it would change the server and log schema, not planned).
- The first real run through the server is still unverified; do not integrate real mode until B's run passes.
- Scope growth: any new screen or feature beyond section 3 goes to AGENTS/DECISIONS.md for approval.
- Restart limitation (README-bound, QE-F-006): the web app cannot be restarted on its own through scripts/web.sh: the launcher tears down the facilitator, the x402 server and the web app when the web child exits, and restarting the facilitator drops its in-memory channels (CLAUDE.md rule 6). Do not restart during the demo. The QE restart/kill tests used a separate web instance on another port, not the launcher-managed one. (README-bound; QE-F-006, launcher behavior deliberately unchanged.)
