import { balances, saveJson } from "./lib.mjs";
const b = await balances(); const tag = process.argv[2]; if (tag) saveJson(`bal_${tag}.json`, b); console.log(JSON.stringify(b));
