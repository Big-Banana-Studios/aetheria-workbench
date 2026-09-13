// The voice companion. Mira herself now lives on the workbench's own stage
// (src/stage.js); this is the link to her full voice app, which opens in its
// own tab: an iframe never had the mic or the GPU it needs. When both apps
// are served from the same origin (GitHub Pages project sites share
// big-banana-studios.github.io) Mira reads the lab endpoint this app wrote
// into `companion.settings`.

const PUBLIC = "https://big-banana-studios.github.io/aetheria-companion/";

export function miraUrl(settings) {
  if (settings.miraUrl?.trim()) return settings.miraUrl.trim();
  const { hostname, origin, protocol } = location;
  if (/github\.io$/i.test(hostname)) return `${origin}/aetheria-companion/`;
  if (hostname === "localhost" || hostname === "127.0.0.1") return `${protocol}//${hostname}:5173/`; // Mira's dev server
  return PUBLIC;
}

export function sameOrigin(url) {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** Open the companion in a new tab. Returns a note about settings sharing. */
export function openCompanion(settings) {
  const url = miraUrl(settings);
  window.open(url, "_blank", "noopener");
  return sameOrigin(url) ? "Same origin: Mira's Lab mode uses the endpoint set here." : "Different origin: set Mira's Lab endpoint inside her own Settings.";
}
