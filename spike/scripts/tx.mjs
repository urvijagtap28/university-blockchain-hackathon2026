const sig = process.argv[2];
const r = await fetch("https://api.devnet.solana.com", {method:"POST",headers:{"content-type":"application/json"},
 body: JSON.stringify({jsonrpc:"2.0",id:1,method:"getTransaction",params:[sig,{encoding:"json",commitment:"confirmed",maxSupportedTransactionVersion:1}]})});
const j = (await r.json()).result;
if(!j){console.log("not found");process.exit()}
const m=j.transaction.message, keys=m.accountKeys.map(k=>k.pubkey??k);
console.log("sig",sig,"\nslot",j.slot,"err",JSON.stringify(j.meta.err),"fee",j.meta.fee,"feePayer",keys[0],"signers",m.header?.numRequiredSignatures);
const logs=(j.meta.logMessages||[]).filter(l=>/Instruction:|invoke \[1\]/.test(l)); console.log(logs.join("\n"));
const names={"2BPj3UYjD2tyRhgSBjzSVMV7VqER9ue7M2iTHKsCnrXA":"buyer","8uZAqWQTRPqsbFwvzDbsreAzLWTmSxk9En7aM78AuVib":"seller","FmT5TvNWkLQBsyJ1iFMiKtsTQVKbeSpodjqksmg8LSaM":"facilitator"};
const pre=j.meta.preTokenBalances, post=j.meta.postTokenBalances;
const all=new Map(); for(const b of pre) all.set(b.accountIndex,{o:b.owner,pre:b.uiTokenAmount.uiAmountString,post:"closed"}); for(const b of post){const e=all.get(b.accountIndex)||{o:b.owner,pre:"0"}; e.post=b.uiTokenAmount.uiAmountString; e.o=b.owner; all.set(b.accountIndex,e)}
for(const [i,e] of all) console.log("token acct",keys[i].slice(0,6),"owner",names[e.o]||e.o,"pre",e.pre,"->",e.post);
const sb=j.meta.preBalances.map((p,i)=>[keys[i],j.meta.postBalances[i]-p]).filter(x=>names[x[0]]); console.log("SOL lamport deltas:",sb.map(x=>`${names[x[0]]} ${x[1]}`).join(", "));
