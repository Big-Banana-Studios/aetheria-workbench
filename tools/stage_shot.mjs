// Screenshots of the stage over time, to see her walk in and settle.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, killTree, sleep, waitHttp } from "./cdp.mjs";
const root = join(fileURLToPath(import.meta.url), "..", "..");
const PORT = 5176;
const preview = spawn(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "ignore" });
await waitHttp(`http://localhost:${PORT}/`);
const { proc, cdp } = await launchChrome({ port: 9336, args: ["--window-size=1200,800"] });
try {
  await cdp.navigate(`http://localhost:${PORT}/`);
  for (const t of [1500, 4000, 8000, 12000]) {
    await sleep(t === 1500 ? 1500 : t - (t === 4000 ? 1500 : t === 8000 ? 4000 : 8000));
    const info = await cdp.eval("(() => { const r = __wb.stage?.renderer; return r ? JSON.stringify({ x: r.x, state: r.state, seq: r.seq?.name || null, clip: r.clipName, vw: r.vw, vh: r.vh, s: r.s, regime: r.scene.regime }) : 'no renderer'; })()");
    console.log(t, "ms", info);
    await cdp.screenshot(join(root, "shots", `stage-${t}.png`));
  }
  await cdp.eval("__wb.selectDesk('paperless')");
  await sleep(6000);
  console.log("after travel", await cdp.eval("(() => { const r = __wb.stage.renderer; return JSON.stringify({ x: r.x, state: r.state, seq: r.seq?.name || null, regime: r.scene.regime }); })()"));
  await cdp.screenshot(join(root, "shots", "stage-travel.png"));
} finally {
  cdp.close();
  killTree(proc);
  killTree(preview);
}
