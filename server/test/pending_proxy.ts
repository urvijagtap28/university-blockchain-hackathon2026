// TEST ONLY: facilitator proxy that SIMULATES settlement_pending so the server's polling path can be exercised on devnet.
// usage: node test/pending_proxy.ts <real-facilitator-url> <listen-port> <mode>
//   mode real  : forwards the CLAIM settle to the real facilitator ONCE (it really lands on-chain), then answers the
//                server with settlement_pending + the REAL claim signature (twice, because core retries once).
//   mode bogus : never forwards the claim settle; answers settlement_pending with a signature that does not exist.
// Everything else (/supported, /verify, ...) is forwarded untouched.
import http from "node:http";
const [upstream, port, mode] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
if (!upstream || !port || !["real", "bogus"].includes(mode)) { console.error("usage: pending_proxy.ts <url> <port> <real|bogus>"); process.exit(1); }
const BOGUS = "1".repeat(87); // valid base58 shape, no such tx
let phase: "deposit" | "claim" = "deposit"; let pendingSent = 0;
let real: { transaction: string; network: string; payer?: string } | undefined;
const body = (r: http.IncomingMessage) => new Promise<Buffer>(res => { const c: Buffer[] = []; r.on("data", d => c.push(d)); r.on("end", () => res(Buffer.concat(c))); });
http.createServer(async (req, res) => {
  const b = await body(req);
  const send = (status: number, obj: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  if (req.method === "POST" && req.url === "/settle") {
    // A paid request makes TWO settle calls: (1) the deposit/open, (2) the claim after the handler. Only the claim is
    // made pending: the deposit is forwarded untouched, otherwise the handler never runs. (First version of this proxy
    // got this wrong and polled the DEPOSIT tx as if it were the claim; see BUILD_LOG.)
    if (phase === "deposit") {
      const r = await fetch(`${upstream}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: b });
      const j = await r.json(); console.log(`[proxy] deposit settle forwarded success=${j.success} tx=${j.transaction}`);
      if (j.success) phase = "claim";
      return send(r.status, j);
    }
    if (mode === "bogus") {
      console.log("[proxy] claim settle NOT forwarded -> pending(bogus sig)");
      if (++pendingSent >= 2) { phase = "deposit"; pendingSent = 0; }
      return send(200, { success: false, errorReason: "settlement_pending", transaction: BOGUS, network: JSON.parse(b.toString()).paymentRequirements.network });
    }
    if (!real) {
      const r = await fetch(`${upstream}/settle`, { method: "POST", headers: { "content-type": "application/json" }, body: b });
      const j = await r.json() as { success: boolean; transaction: string; network: string; payer?: string };
      console.log(`[proxy] claim settle forwarded (really lands) success=${j.success} tx=${j.transaction}`);
      if (!j.success) { phase = "deposit"; return send(r.status, j); }
      real = j;
    }
    console.log(`[proxy] claim settle -> pending(real tx ${real.transaction})`);
    if (++pendingSent >= 2) { phase = "deposit"; pendingSent = 0; const out = real; real = undefined; return send(200, { success: false, errorReason: "settlement_pending", transaction: out.transaction, network: out.network, payer: out.payer }); }
    return send(200, { success: false, errorReason: "settlement_pending", transaction: real.transaction, network: real.network, payer: real.payer });
  }
  const r = await fetch(`${upstream}${req.url}`, { method: req.method, headers: { "content-type": "application/json" }, body: req.method === "GET" ? undefined : b });
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" }); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`[proxy] ${mode} on ${port} -> ${upstream}`));
