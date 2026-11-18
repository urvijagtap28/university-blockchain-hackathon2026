// Round 3 (1): default state with an empty log on the single board. Key-free, no payment. Needs the stack on :4030 and web/run/stub absent at start.
import { Browser, openPage, snapshot, banned, Checks, readLog } from "./r3.mjs";
const C = new Checks("stage1");
const br = await Browser.launch(9341);
try {
  for (const w of [1280, 1600]) {
    const p = await openPage(br, "http://127.0.0.1:4030/", w, 900);
    await new Promise(r => setTimeout(r, 1200));
    const s = await snapshot(p);
    console.log(`--- ${w}px body text ---\n` + s.body);
    C.ok(readLog().length === 0, "log empty at start");
    C.ok(banned({ body: s.body }).length === 0, `${w}: no null/undefined/NaN/[object Object]/atomic`, banned({ body: s.body }).join("|"));
    C.ok(/Rehearsal: stub verdicts follow the filename, not a sandbox\./.test(s.body), `${w}: stub headline`);
    C.ok(!/sandbox run|real sandbox verdict|AddressSanitizer/i.test(s.body.replace(/Rehearsal: stub verdicts follow the filename, not a sandbox\./, "").replace(/not a real sandbox run/, "")), `${w}: no sandbox claim elsewhere`);
    C.ok(/STUB MODE/.test(s.body), `${w}: stub bar visible`);
    C.ok(/0 reports/.test(s.body) && /No entries to verify yet/.test(s.body), `${w}: summary 0 reports and neutral trust badge`);
    C.ok(/Nothing yet\./.test(s.body), `${w}: maintainer pane empty text`);
    C.ok(/waiting for a report/.test(s.body), `${w}: console idle`);
    C.ok(/not run yet/.test(s.body) && (s.body.match(/not run yet/g) || []).length === 5, `${w}: 5 rows not run yet`);
    C.ok(/Run all 5/.test(s.body), `${w}: Run all 5 button`);
    const info = await p.eval(`({runBtns:[...document.querySelectorAll('#panel-submit .rep button')].map(b=>b.disabled), all:document.getElementById('run-all').disabled, overflowX: document.documentElement.scrollWidth>document.documentElement.clientWidth})`);
    C.ok(info.runBtns.length === 5 && info.runBtns.every(x => !x) && !info.all, `${w}: run buttons enabled`);
    C.ok(!info.overflowX, `${w}: no horizontal overflow`);
    await p.shot(`s1_empty_${w}`);
    if (w === 1280) {
      for (const [tab, id] of [["results", "ledger"], ["policy", "agent"]]) {
        await p.tab(tab); const s2 = await snapshot(p);
        console.log(`--- ${id} drawer ---\n` + s2[id]);
        C.ok(banned({ [id]: s2[id] }).length === 0, `${id} drawer empty text clean`, banned({ [id]: s2[id] }).join("|"));
        C.ok(s2.stubBarInDialog[id] === true, `${id} drawer has stub bar`);
        await p.shot(`s1_${id}_empty`);
        await p.c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await p.c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await new Promise(r => setTimeout(r, 400));
        const st = await p.eval(`({open:document.getElementById(${JSON.stringify(id)}).open, focus:document.activeElement?.id||document.activeElement?.className||document.activeElement?.tagName})`);
        C.ok(!st.open, `Esc closes ${id}`, JSON.stringify(st));
        C.ok(st.focus === "tab-" + (tab) || /tab/.test(String(st.focus)), `focus returns to the opener after Esc (${id})`, JSON.stringify(st));
      }
    }
    await p.close();
  }
} finally { br.close(); }
process.exit(C.done() ? 1 : 0);
