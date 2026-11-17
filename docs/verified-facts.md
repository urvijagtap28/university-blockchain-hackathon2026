# Verified facts (use this wording in README, video, Devpost)

Rule: only quote what is here. Anything marked UNVERIFIED must not appear in submission text.

## curl bug bounty
Checked 2026-11-17 by reading curl's maintainer's own blog posts (fetched through a web-fetch agent that returns quotes of 125 characters or fewer). A person should re-open the links and confirm the quotes before the final README.

Primary source 1: https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/ (dated January 26, 2026, by Daniel Stenberg)
- End date, verbatim: "There is no longer a curl bug-bounty program. It officially stops on January 31, 2026."
- Valid-report rate, verbatim: "Previous years we have had a rate of somewhere north of 15% of the submissions ending up confirmed vulnerabilities." and "Starting 2025, the confirmed-rate plummeted to below 5%." and "Not even one in twenty was _real_."
- Track record, verbatim: "87 confirmed vulnerabilities and over 100,000 USD paid as rewards to researchers."
- The post gives NO absolute count of total reports. Do not quote one.

Primary source 2: https://daniel.haxx.se/blog/2026/02/25/curl-security-moves-again/ (February 25, 2026)
- Reporting moved back to HackerOne: "Starting March 1st 2026, [this](https://hackerone.com/curl) is now (again) the official place to report security problems to the curl project." The post says the earlier move to GitHub "turns out to have been a mistake".
- Rewards did not return: "The reward money is still gone, _there is no bug-bounty_, no money for vulnerability reports".

### Wording to use
- "curl ended its bug bounty effective January 31, 2026. Its maintainer wrote that the share of submissions that were confirmed vulnerabilities fell from somewhere north of 15% in previous years to below 5% starting in 2025."
- Say "below 5%", not "around 5%".
- Do NOT say curl left HackerOne. It returned to HackerOne for reports on March 1, 2026, without a bounty.

### UNVERIFIED (do not use)
- Figures from secondary sources (The Register, Pinggy and similar), for example "about 5% in early July 2025" or "20% AI slop".
- A claim that curl paused handling reports in July 2026 (single secondary article, nothing else found).
- A claim that the program shut down on February 1st (seen in a search summary, not in the primary text).
- Any objections or opinions attributed to named people. Include none without a primary source.

## Not yet checked
- Prior-art check: done 2026-11-17, see 'Prior art / related work' below (not exhaustive; a person should re-open the links).
- Solana program ID CHNLxYvV...: the organizers' guide (docs/hackathon.md) does NOT name it. Observed deployed on devnet by `solana program show -u devnet` during the spike (docs/spike-findings.md); not re-run since. USDC mint 4zMMC9sr...: seen as the token mint on the funded wallets in Solana Explorer (devnet) on 2026-11-17.

## Prior art / related work
Checked 2026-11-17 by FACT_CHECKER. Primary sources read through WebFetch (quotes are 125 characters or fewer). Search-result summaries were used only to find URLs. A person should re-open the links before the final README. This search is NOT exhaustive.

### Strong overlap, stated plainly (top)
The IDEA of a refundable deposit that is slashed for spam bug reports already exists and is deployed or proposed by others. Do not claim it as new.
- Cantina bounty deposits: refunded for valid and legitimately invalid submissions, slashed for spam/low-effort/AI-generated ones.
- Decred bounty: $5 deposit in DCR, refunded if the report is accepted.
- Bram Cohen's proposal (Jan 2026): deposits for bug bounty submissions.
- Firedancer (Solana): non-refundable 1 SOL burn per submission (a fee, not a bond).
What we found no match for in the sources checked: an automated, same-request verdict from a sandbox ASan reproduction that decides the refund on an x402 `upto` authorization. See the closing "no overlapping project found" line for its limits.

### Items asked about
1. x402r (BackTrack)
- Primary: https://x402r.org (read 2026-11-17, no date shown); spec PR https://github.com/x402-foundation/x402/pull/1425 (opened March 3, 2026; merged May 13, 2026 per the PR page).
- It is "Escrow-backed refunds for x402 payments" and "Funds are held in smart contract escrow - never by a third party." Funds are "released by your arbiter"; the merchant chooses the arbiter ("Automated verification, human dispute resolution, or anything in between.").
- The PR adds an `authCapture` scheme "built on Base's audited Commerce Payments Protocol" (EVM; the page says x402r is the author's own project: "At x402r.org, we've been working on refundable payments for x402.").
- Overlap: refundable x402 payments with an automated arbiter option. Difference (as far as sources show): escrow contracts on EVM/Base, a general refund protocol; we use the `upto` scheme on Solana with the verdict deciding settle amount. x402r's Solana support: UNVERIFIED (site does not clearly name networks). The site says it is in beta.
2. ERC-8183: Agentic Commerce
- Primary: https://eips.ethereum.org/EIPS/eip-8183 . Status "Draft", Standards Track ERC, created 2026-02-25.
- A job with an escrowed budget and "an evaluator who alone may mark the job completed". "When status is Submitted, only the evaluator MAY call" complete/reject; rejection returns escrow to the client; after expiry the client can be refunded.
- Overlap: escrow released or refunded by an evaluator's verdict (an evaluator could be automated; the spec does not describe evaluator internals). Difference: Ethereum smart-contract job standard (draft); not a bug-report bond; no x402 involvement seen in the text read. Production deployment claims seen in forum posts: UNVERIFIED.
3. Pact Network
- Primary: https://pactnetwork.io (no date shown) and https://github.com/pactnetwork/pact-skill (no date shown).
- Site: "the refund layer for x402": small premium per call, and the agent gets money back when the upstream API fails; "live on Solana". The repo describes it as "parametric micro-insurance for AI agent API payments on Solana."
- Overlap: refunds in the x402 flow on Solana with USDC. Difference: refunds are triggered by API failure (insurance for the payer), not by a bug-report verdict; premium-based. How failures are classified and how claims are verified: UNVERIFIED (not defined on pages read). A HackQuest page (not primary, not fetched) reportedly describes an Arbitrum version; not used.

### Other related work found
4. Cantina deposits for bounty submissions
- Primary: https://docs.cantina.security/researchers/participation/deposits.md (docs moved from docs.cantina.xyz; no date shown).
- Refunded: valid submissions, legitimate invalid submissions, out-of-scope findings. "Regular rejected findings will not lose their deposit." Slashed: "spam, low-effort, or AI-generated submissions", over-inflated severity, repeat abuse. Amount varies by program ($10 and $100 appear as examples).
- Overlap: refundable-deposit-slashed-for-spam for bug reports is the same economic idea. Difference: page does not say who decides or whether any automated check is used (UNVERIFIED); fiat/Stripe deposits per search summary only (UNVERIFIED); not agent-native or x402.
5. Decred bounty program
- Primary: https://bounty.decred.org/2026/07/bounty-program-resumes/ (July 14, 2026).
- Reporters make a "$5 USD deposit in DCR"; refunded if "the report is accepted as a valid security vulnerability"; the page also says rejected reports may be refunded if made in good faith. Who decides: not stated.
- Overlap: same refundable-deposit idea. Difference: human acceptance (as far as stated), different asset, not sandbox-verified.
6. Bram Cohen, "Bug Bounty Submissions Should Require Deposits"
- Primary: https://bramcohen.com/p/bug-bounty-submissions-should-require (January 8, 2026, by Bram Cohen).
- Proposes that bug bounty submitters pay a deposit (example amount $100); ideal policy: "submissions which are at all earnest get their deposit back even if they're mistaken." Refund decided by the evaluator, possibly "completely discretionary".
- Overlap: proposal of deposit for bounty submissions. Difference: discretionary human judgement, no automated verification described.
7. Firedancer bug bounty burn
- Primary: http://bounty.firedancer.io (no date on page): "This is permanent and non-refundable." Fee amount missing from the text fetched. Amount (1 SOL) and dates come from secondary coverage (Solana Compass, Crypto Briefing): platform launch 16 October 2026 per Solana Compass; "took effect on October 18, 2026" per Crypto Briefing. Dates conflict: treat the date as UNVERIFIED.
- Overlap: anti-spam payment on a bug-report channel, on Solana. Difference: non-refundable burn on every submission, i.e. a fee, not a refundable bond.
8. Stenberg, "Death by a thousand slops" (July 14, 2025)
- Primary: https://daniel.haxx.se/blog/2025/07/14/death-by-a-thousand-slops/
- Lists among possible routes "charging a fee for the right to submit a security vulnerability" that could be refunded for a valid report. (Quote shortened; the post's own evaluation of the idea is not reproduced here per the no-opinion-attribution rule.)
- Relevance: shows the fee/deposit idea has been discussed publicly before. Do not attribute a view on it to him.
9. Escrow/refund schemes around x402 (vendor and community, none read in full): agora402, Fortytwo x402escrow, Kustodia, x402 batch settlement. Seen only in search results: UNVERIFIED. They indicate x402 escrow work exists beyond x402r. x402 `upto` itself, primary: https://github.com/x402-foundation/x402/blob/main/specs/schemes/upto/scheme_upto.md : "The settled `amount` MAY be `0` (no charge if no usage occurred)."
10. Crash reproduction for triage
- OSS-Fuzz reproducing docs, https://google.github.io/oss-fuzz/advanced-topics/reproducing : every issue includes a reproducer file, the input the fuzz target received, and it can be run against the target built with the matching sanitizer. ClusterFuzz recheck-and-close behavior: seen only in search summaries, UNVERIFIED.
- ARVO, https://arxiv.org/abs/2408.02153 (v1 August 4, 2024; v2 June 19, 2026): "over 6,100 real-world vulnerabilities across 311 projects" from OSS-Fuzz, "reproduces 81% of vulnerabilities". This is the dataset our vul/fix images come from (see docs/DECISIONS.md). It is a dataset, not a payment or triage system.
- AXE, https://arxiv.org/abs/2602.14345 (submitted 15 February 2026): multi-agent exploitability confirmation for web vulnerability reports from a CWE and code location; produces "actionable, reproducible proof-of-concept artifacts." Different target (web apps, agent-generated exploits) and no payments seen.
- Overlap: automated reproduction of a crash from an input as a verification step is standard in OSS-Fuzz-style workflows. Do not claim it as new. Commercial triage vendors (YesWeHack, Aikido, Yogosha) appeared in search summaries only: UNVERIFIED.

### Searches run (WebSearch, 2026-11-17)
1. x402r refundable payments x402 escrow
2. ERC-8183 agentic commerce escrow evaluator
3. Pact Network agent payments insurance API failures Solana
4. refundable deposit slashable stake vulnerability report spam bug bounty proposal
5. x402 escrow scheme upto refund agent-to-agent escrow
6. ClusterFuzz OSS-Fuzz reproduce crash testcase verify bug report automatically
7. ARVO atlas of reproducible vulnerabilities
8. charge fee to submit bug report AI slop skin in the game maintainers deposit
9. Firedancer bug bounty burn 1 SOL official announcement
10. pactnetwork.io docs (no useful results)
11. automated vulnerability report validation PoC reproduce sandbox AI agents triage
12. Daniel Stenberg refund fee bug report deposit idea (no primary hit; superseded by reading the 2025-07-14 post)
13. Cantina "Deposits for Bounty Submissions"
Plus WebFetch reads of every primary URL above. Not searched: academic literature on deposit mechanisms, Immunefi/HackerOne/Bugcrowd policy pages, GitHub/Hugging Face spam rules, Solana-native escrow programs.

### Closing statement
No overlapping project was found in the sources checked that combines an x402 `upto` bond, a sandboxed ASan verdict, and a same-request settle of $0 or the full amount. This search is not exhaustive and is not a claim of novelty.

### Wording for README
Safe:
- "Refundable deposits for bug reports are not a new idea; Cantina and Decred describe them, and a published proposal argues for them."
- "x402r and Pact Network add refunds to x402 payments; Prove-It Bond applies the x402 `upto` scheme, where the settled amount may be 0, to a bug-report bond."
- "Reproducing a crash from an input file under a sanitizer follows the OSS-Fuzz reproducer workflow; our images come from the ARVO dataset."
- "ERC-8183 (a draft Ethereum standard) describes escrow released or refunded by an evaluator; ours is a Solana devnet prototype."
- "Firedancer charges a non-refundable burn per submission; ours is a refundable bond."
Do NOT say:
- "first", "novel", "the only", "nobody has done this".
- That Cantina/Decred/Firedancer programs use or lack automated verification (not stated in sources).
- Any claim that x402r or Pact supports or lacks Solana beyond what is listed above.
- Any opinion attributed to Stenberg, Cohen or others beyond the quotes above.
- The Firedancer start date.
