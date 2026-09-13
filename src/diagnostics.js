// The diagnostics panel: which brain is live, endpoint latency, tokens per
// second, the last error, storage, and the mixed-content explainer with its
// four ways round (the fourth is Chrome's local-network permission).

import { endpoints } from "./settings.js";
import { addressSpaceSupport, blockedByMixedContent } from "./lab.js";
import { escapeHtml, fmtBytes } from "./ui.js";
import { store } from "./store.js";

export async function renderDiagnostics(el, { brain, settings, files, speech, voice }) {
  const st = brain.status();
  const stats = brain.stats || {};
  const e = endpoints(settings.lab.url);
  const usage = await store.usage();
  const sw = "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistration()) ? "registered" : "not registered" : "unsupported";
  const rows = [
    ["Brain live", st.live === "lab" ? `lab · ${st.model || "?"}` : st.live === "native" ? `in-app · ${st.model || "llama-server"}` : st.live === "device" ? `on-device · ${st.model || "Gemma 4 E2B"} (${st.deviceStatus})` : "none"],
    ["Endpoint", e ? e.base : "not set"],
    ["Endpoint reach", e ? `${e.loopback ? "loopback" : e.lan ? "on the LAN" : "out on the internet"} · ${e.http ? "plain http" : "https"} · ${addressSpaceSupport().supported ? "this browser takes targetAddressSpace" : "this browser does not take targetAddressSpace"}` : "—"],
    ["Ping", st.latency != null ? `${st.latency} ms round trip to GET /models; not generation speed (see First token and Tokens / second)` : "—"],
    ["Lab error", st.labError || "—"],
    ["Last turn", stats.at ? `${new Date(stats.at).toLocaleTimeString()} · ${stats.brain}` : "—"],
    ["First token", stats.firstTokenMs != null ? `${stats.firstTokenMs} ms from send to the first token (TTFT)` : "—"],
    ["Tokens / second", stats.tokPerSec != null ? `${stats.tokPerSec} tok/s while generating` : "—"],
    ["Tokens", stats.tokens != null ? `${stats.tokens}${stats.usage ? ` (prompt ${stats.usage.prompt_tokens ?? "?"})` : ""}` : "—"],
    ["Total time", stats.totalMs != null ? `${stats.totalMs} ms` : "—"],
    ["Last error", stats.lastError || "—"],
    ["WebGPU", st.gpu ? (st.gpu.ok ? `ok${st.gpu.f16 ? ", fp16 shaders" : ", no fp16"}` : st.gpu.reason) : "not probed (lab answered first)"],
    ["Embedder", files.embedder ? `ready · ${files.embedder.device}` : files.embedder === false ? "unavailable (keyword search instead)" : "not loaded yet"],
    ["Voice", speech.ready ? `Kokoro ready · ${speech.voice}` : "not loaded"],
    ["Ears", voice.ready ? `Silero + Moonshine ${settings.sttModel}` : "not loaded"],
    ["Storage", usage ? `${fmtBytes(usage.usage)} of ${fmtBytes(usage.quota)}${usage.persisted ? " · persistent" : " · not persistent"}` : "—"],
    ["Audio cache", `${await store.audioCount().catch(() => 0)} lines of a set synthesized and kept`],
    ["Viewport", `${innerWidth}×${innerHeight} css px · dpr ${devicePixelRatio} · ${innerWidth < 768 ? "phone layout (bottom sheet, icon rail)" : "desktop layout"}`],
    ["Service worker", sw],
    ["Page", `${location.protocol}//${location.host}${location.pathname}`],
  ];
  const blocked = blockedByMixedContent(settings.lab.url);
  const relaxed = !!e && e.http && e.lan && location.protocol === "https:" && !blocked;
  el.innerHTML = `
    <table class="diag">${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`).join("")}</table>
    <div class="diag-note ${blocked ? "warn" : ""}">
      <b>${blocked ? "Mixed content: the browser is blocking the endpoint." : relaxed ? "Mixed content, relaxed: Chrome lets this https page call the LAN box once you allow the local-network prompt." : "Mixed content, for reference."}</b>
      <p>A page served over <b>https</b> (GitHub Pages) cannot call a plain <b>http</b> endpoint on the LAN, such as a Khadas box, as it is. Loopback (<code>http://127.0.0.1</code>, this phone's in-app runtime) is exempt, and an https endpoint, like a Model Console instance's <code>https://&lt;id&gt;.laresprime.olares.com/v1</code> URL, is fine. Four ways round it:</p>
      <ol>
        <li><b>Let Chrome relax it.</b> Chrome 138 and later takes the address space on the request (<code>targetAddressSpace: "local"</code>, which this app sets for a LAN box) as consent, behind a one-time prompt under the address bar asking whether the site may reach devices on your network. Allow it and press Test again; if it never asked, look for the site's permission in the address-bar controls.</li>
        <li><b>Run the app over http on the LAN.</b> After <code>npm run build</code>: <code>npm run serve</code> (or <code>python -m http.server</code> in <code>dist/</code>), then open the printed http address. Same build, no mixed content.</li>
        <li><b>Put the endpoint behind https.</b> LiteLLM behind Caddy or Tailscale, or LiteLLM installed on the Olares from Market, which gets a laresprime https URL of its own. The README has the snippets.</li>
        <li><b>Install the app</b> (browser menu → Install) and run it from cache; once installed it can be opened from a plain http address too.</li>
      </ol>
    </div>`;
}
