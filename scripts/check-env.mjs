// Validates SVM_RPC_URL without printing it. Usage: node --env-file=.env scripts/check-env.mjs
const url = process.env.SVM_RPC_URL;
const fail = (m) => { console.error("FAIL: " + m); process.exit(1); };
if (!url) fail("SVM_RPC_URL is not set");
if (!/^[\x20-\x7e]+$/.test(url)) fail("SVM_RPC_URL contains non-ASCII or non-printable characters (curly quotes?)");
let u;
try { u = new URL(url); } catch { fail("SVM_RPC_URL is not a valid URL"); }
if (u.protocol !== "https:") fail("SVM_RPC_URL must be https");
if (/api\.devnet\.solana\.com$/.test(u.hostname)) fail("public devnet RPC is not allowed (429s); use a dedicated RPC");
const ctl = new AbortController();
const t = setTimeout(() => ctl.abort(), 10000);
try {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot" }), signal: ctl.signal });
  const j = await r.json();
  if (typeof j.result !== "number") fail("getSlot returned HTTP " + r.status + " without a numeric result");
  console.log("OK: host=" + u.hostname.split(".").slice(-2).join(".") + " getSlot=" + j.result);
} catch (e) { fail("getSlot request failed: " + (e.name || "error")); } finally { clearTimeout(t); }
