// Appends LOG_SIGNING_KEY=<base58 64-byte ed25519 keypair> to the repo .env (default ../.env) WITHOUT printing it.
// Prints only the PUBLIC key (safe; use it with verify-log.ts --pubkey). Refuses if LOG_SIGNING_KEY already exists.
// usage (from server/): node scripts/gen-log-key.mjs [path-to-env]
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { base58 } from "@scure/base";
const envPath = process.argv[2] || new URL("../../.env", import.meta.url).pathname;
if (existsSync(envPath) && /^LOG_SIGNING_KEY=/m.test(readFileSync(envPath, "utf8"))) { console.error("LOG_SIGNING_KEY already set in .env; not overwriting."); process.exit(1); }
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const needsNl = existsSync(envPath) && !readFileSync(envPath, "utf8").endsWith("\n") && readFileSync(envPath, "utf8").length > 0;
appendFileSync(envPath, `${needsNl ? "\n" : ""}LOG_SIGNING_KEY=${base58.encode(Buffer.concat([seed, pub]))}\n`, { mode: 0o600 });
console.log("LOG_SIGNING_KEY appended to", envPath, "(value not shown). Public key:", base58.encode(pub));
