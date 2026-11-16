const P="CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX";
const who=process.argv[2]||"2BPj3UYjD2tyRhgSBjzSVMV7VqER9ue7M2iTHKsCnrXA";
const r=await fetch("https://api.devnet.solana.com",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getProgramAccounts",params:[P,{encoding:"base64",filters:[{dataSize:256},{memcmp:{offset:88,bytes:who}}]}]})});
const j=await r.json(); if(j.error){console.log(JSON.stringify(j.error));process.exit()}
console.log("channels with payer",who,":",j.result.length);
for(const a of j.result){const d=Buffer.from(a.account.data[0],"base64");console.log(a.pubkey,"lamports",a.account.lamports,"status/first bytes",[...d.subarray(0,16)].join(","))}
