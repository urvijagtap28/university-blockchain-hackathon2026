// Round 2 UI helpers on top of lib.mjs: dump every tab's text, grep for bad strings, stub bar checks.
import { sleep } from "./lib.mjs";
export const TABS = ["overview", "submit", "run", "results", "inbox", "policy"];
export const BAD = /\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]|\b\d{5,}\s*atomic|\batomic\b/i;
export async function activeTab(p) { return p.eval(`(document.querySelector('[role=tab][aria-selected=true]')||{}).id||null`); }
export async function dumpAll(p, tag, shots = true) {
  const out = { tag, active: await activeTab(p), tabs: {}, bad: [] };
  out.top = await p.eval(`document.querySelector('header.top').innerText`);
  for (const t of TABS) {
    await p.tab(t); await sleep(500);
    const txt = await p.eval(`document.getElementById('panel-${t}').innerText`);
    const popTxt = await p.eval(`[...document.querySelectorAll('#panel-${t} .pop, header .pop')].map(x=>x.textContent).join(' | ')`);
    out.tabs[t] = { text: txt, pop: popTxt, stubBar: await p.eval(`[...document.querySelectorAll('.bar-msg.stub')].map(e=>({t:e.innerText,vis:!!(e.offsetParent),close:!!e.querySelector('button')}))`) };
    for (const [k, v] of [["panel", txt], ["pop", popTxt], ["top", out.top]]) { const m = BAD.exec(v); if (m) out.bad.push({ tab: t, in: k, match: m[0], ctx: v.slice(Math.max(0, m.index - 40), m.index + 60) }); }
    if (shots) await p.shot(`${tag}_${t}`);
  }
  return out;
}
