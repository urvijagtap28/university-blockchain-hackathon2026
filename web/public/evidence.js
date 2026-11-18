"use strict";
/* Pure parsers for the verifier detail string and for agent decision-event detail strings. No DOM.
   Loaded as a plain script in the browser (window.Evidence) and evaluated in node by web/test/evidence.test.mjs.
   Strict whole-string regexes against the exact formats verifier/verify.py (and web/lib/jobs.mjs mapDecision) write.
   Anything that does not match returns kind "raw": the caller shows the raw text and a neutral line. Nothing is guessed. */
(function (g) {
  const ERR = "[A-Za-z0-9_-]{2,40}";          // ASan error type, as in verify.py ASAN_ERR
  const FN = "[A-Za-z_][A-Za-z0-9_]{0,100}";   // function name
  const LOC = "[A-Za-z0-9_./+-]{1,120}(?::\\d{1,7}(?::\\d{1,5})?)?"; // path with optional :line[:col]
  const CRASH = `(${ERR}) at (${FN}) (${LOC})`; // 3 capture groups
  const TAG = "case (\\d{1,12}), (\\d{1,9}) B input: ";
  const re = s => new RegExp("^" + s + "$");

  const R = {
    reproduced: re(`${TAG}vul 3/3 ${CRASH}; fixed build clean`),
    notRepro: re(`${TAG}vul 3/3 clean`),
    runList: re(`${TAG}(vul run\\d: .{1,600})`),
    both: re(`${TAG}crashes on both builds \\(vul 3/3 ${CRASH}; fix: ${CRASH}\\)`),
    ctlNotClean: re(`${TAG}vul 3/3 ${CRASH}; fixed-build control not clean \\((.{1,300})\\)`),
    inputMissing: re("input file not found"),
    inputBig: re("input is (\\d{1,12}) bytes, over the (\\d{1,12}) byte limit"),
    inputBig2: re("input over the (\\d{1,12}) byte limit"),
    imgMissing: re("sandbox error: image n132/arvo@sha256:[0-9a-f]{64} not present locally"),
    imgPlat: re("sandbox error: image n132/arvo@sha256:[0-9a-f]{64} is (\\S{1,40}), verified only on (\\S{1,40})"),
  };
  // One run's info text (verify.py run_once). Returns {text, crash?:{err,fn,loc}} or null.
  const noCol = loc => loc.replace(/^(.*?:\d+):\d+$/, "$1");
  function runInfo(s) {
    let m;
    if (s === "clean") return { key: "clean", text: "clean" };
    if ((m = re(CRASH).exec(s))) return { key: "crash:" + s, text: `${m[1]} in ${m[2]}, ${noCol(m[3])}`, crash: { err: m[1], fn: m[2], loc: noCol(m[3]) } };
    if ((m = re(`(${ERR}) with no library frame`).exec(s))) return { key: "noframe:" + m[1], text: `${m[1]}, no frame in library source` };
    if (s === "non-ASan sanitizer report") return { key: "other-san", text: "a sanitizer report that is not an ASan error" };
    if ((m = /^exit (-?\d{1,4}) without sanitizer report$/.exec(s))) return { key: "exit:" + m[1], text: `exit ${m[1]} with no sanitizer report` };
    if ((m = /^sandbox error \(docker exit (\d{1,3})\): /.exec(s))) return { key: "sbx:" + m[1], text: `sandbox error (docker exit ${m[1]})` };
    if ((m = /^killed \(exit (\d{1,3}): SIGKILL, usually out of memory or amd64 emulation on a non-amd64 host\)$/.exec(s))) return { key: "kill:" + m[1], text: `sandbox run killed (exit ${m[1]}), usually out of memory or emulation` };
    if ((m = /^run exceeded (\d{1,3}) s, container killed$/.exec(s))) return { key: "to:" + m[1], text: `timeout, run exceeded ${m[1]} s`, timeout: true };
    if (s === "no time left in the total time cap") return { key: "nocap", text: "time cap used up" };
    return null;
  }
  const L = (k, text) => ({ k, text });
  const ok = (head, lines) => ({ kind: "evidence", head, lines: lines.slice(0, 3) });
  const RAW = { kind: "raw", lines: [] };

  /** parseEvidence(verdict, detail) -> {kind:"evidence", lines:[{k,text}] (max 3)} | {kind:"stub", lines:[{k:"stub",text}]} | {kind:"raw", lines:[]} */
  function parseEvidence(verdict, detail) {
    if (typeof detail !== "string" || typeof verdict !== "string" || detail.length > 2000) return RAW;
    if (/^stub: /.test(detail)) return { kind: "stub", lines: [L("stub", "Stub verdict (filename rule)")] };
    let m;
    if (verdict === "reproduced" && (m = R.reproduced.exec(detail))) {
      return ok("reproduced", [L("err", `Error: ${m[3]}, 3 of 3 vulnerable runs`), L("where", `In libucl: ${m[4]}, ${noCol(m[5])}`), L("ctl", "Fixed build: clean")]);
    }
    if (verdict === "not_reproduced" && R.notRepro.test(detail)) return ok("not_reproduced", [L("runs", "3 of 3 vulnerable runs clean")]);
    if (verdict !== "inconclusive") return RAW;
    if (R.inputMissing.test(detail)) return ok("inconclusive", [L("why", "Input file not found")]);
    if ((m = R.inputBig.exec(detail))) return ok("inconclusive", [L("why", `Input over the size cap (${m[1]} bytes, limit ${m[2]})`)]);
    if ((m = R.inputBig2.exec(detail))) return ok("inconclusive", [L("why", `Input over the size cap (limit ${m[1]} bytes)`)]);
    if (R.imgMissing.test(detail)) return ok("inconclusive", [L("why", "Sandbox image not present on this host")]);
    if ((m = R.imgPlat.exec(detail))) return ok("inconclusive", [L("why", `Sandbox image is ${m[1]}, verified only on ${m[2]}`)]);
    if ((m = R.both.exec(detail))) {
      return ok("inconclusive", [L("why", "Crashed on both builds, so no clean control"), L("where", `Vulnerable: ${m[3]} in ${m[4]}, ${noCol(m[5])}`), L("ctl", `Fixed: ${m[6]} in ${m[7]}, ${noCol(m[8])}`)]);
    }
    if ((m = R.ctlNotClean.exec(detail))) {
      const ci = runInfo(m[6]);
      if (!ci) return RAW;
      return ok("inconclusive", [L("why", "Fixed-build control did not run clean"), L("where", `Vulnerable: ${m[3]} in ${m[4]}, ${noCol(m[5])}`), L("ctl", `Fixed: ${ci.text}`)]);
    }
    if ((m = R.runList.exec(detail))) {
      // "vul run1: X; vul run2: Y; ..." Each segment must itself be a known run info, runs numbered 1..n in order.
      const segs = m[3].split(/; (?=vul run\d: )/);
      const infos = [];
      for (let i = 0; i < segs.length; i++) {
        const s = /^vul run(\d): (.*)$/.exec(segs[i]);
        if (!s || Number(s[1]) !== i + 1) return RAW;
        const info = runInfo(s[2]);
        if (!info) return RAW;
        infos.push(info);
      }
      const n = infos.length;
      if (n === 3 && infos.every(x => x.key === infos[0].key)) {
        // verify.py reaches this format with three identical runs only when none was a crash: the crash case goes on to the control run.
        const f = infos[0];
        if (f.crash) return ok("inconclusive", [L("why", `Different error type than expected: ${f.crash.err}`), L("where", `In ${f.crash.fn}, ${f.crash.loc}`), L("runs", "3 of 3 vulnerable runs")]);
        if (f.timeout) return ok("inconclusive", [L("why", "Timeout"), L("runs", `3 of 3 vulnerable runs: ${f.text}`)]);
        return ok("inconclusive", [L("why", `Could not decide: ${f.text}`), L("runs", "3 of 3 vulnerable runs")]);
      }
      if (n === 1 && infos[0].timeout) return ok("inconclusive", [L("why", "Timeout"), L("runs", `Vulnerable run 1: ${infos[0].text}`)]);
      return ok("inconclusive", [L("why", "Vulnerable runs did not agree or did not finish"), ...infos.slice(0, 2).map((x, i) => L("runs", `Run ${i + 1}: ${x.text}`))]);
    }
    return RAW;
  }

  /** parseDecision(action, detail) -> {step:"policy"|"approved"|"signed", ok:boolean, text} | null. Only wording the backend/fixtures actually emit. */
  function parseDecision(action, detail) {
    const d = typeof detail === "string" ? detail : "";
    let m;
    const usd = a => "$" + (Number(a) / 1e6).toFixed(2);
    if (action === "allow" && (m = /^allowlist: (https?:\/\/[^\s/]{1,100})(?:\/\S{0,100})?$/.exec(d))) return { step: "policy", ok: true, text: `Endpoint allowed (${m[1].replace(/^https?:\/\//, "")})` };
    if (action === "refuse") {
      if (/allowlist|endpoint|URL/i.test(d)) return { step: "policy", ok: false, text: "Failed: endpoint allowlist" };
      if (/per-report cap|above .*cap/i.test(d)) return { step: "policy", ok: false, text: "Failed: per-report cap" };
      if (/budget/i.test(d)) return { step: "policy", ok: false, text: "Failed: session budget" };
      return null;
    }
    if (action === "approve") {
      if (d === "approved") return { step: "approved", ok: true, text: "Approved" };
      if (d === "approved (confirmed in the web UI, up to the per-report cap)") return { step: "approved", ok: true, text: "Approved in the web UI" };
      if ((m = /^auto-approved: ask (\d{1,12}) atomic is within AGENT_AUTO_APPROVE_USD ([0-9.]{1,10})$/.exec(d))) return { step: "approved", ok: true, text: `Auto-approved: ${usd(m[1])} ask within the $${m[2]} limit` };
      return null;
    }
    if (action === "reject" && d === "approval rejected: nothing paid") return { step: "approved", ok: false, text: "Not approved" };
    if (action === "sign") {
      if (d === "x402 upto authorization signed (maximum is the per-report cap)") return { step: "signed", ok: true, text: "upto authorization signed" };
      if ((m = /^x402 upto authorization signed for (\d{1,12}) atomic to [1-9A-HJ-NP-Za-km-z]{32,50}$/.exec(d))) return { step: "signed", ok: true, text: `upto authorization signed, up to ${usd(m[1])}` };
      return null;
    }
    return null;
  }
  g.Evidence = { parseEvidence, parseDecision };
})(typeof window !== "undefined" ? window : globalThis);
