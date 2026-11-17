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
- Prior-art check (x402r, ERC-8183, Pact Network): not done.
- Solana program ID and USDC mint values from the hackathon rules: copy from the rules page, not yet checked against the chain.
