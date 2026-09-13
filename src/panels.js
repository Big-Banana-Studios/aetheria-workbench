// Panels on a phone: every drawer, dialog, dropdown and overlay is a panel.
// Two things they all need and Android gives neither for free:
//
// - the back gesture (and the hardware back button) closes the open panel
//   instead of leaving the app: a history entry is pushed when a panel
//   opens and popped when it closes, so `popstate` closes the topmost;
// - the on-screen keyboard shrinks the visual viewport, not the layout
//   viewport, so a panel sized in vh keeps its old height and its bottom
//   half hides under the keyboard ("the window went off the screen"). The
//   visual viewport's height is mirrored into `--vvh` and panels size to it;
//   on a resize the focused field is scrolled back into view.

const stack = []; // {id, close}
let seq = 0;
let ignorePop = 0;

/** Register an open panel; returns a function that unregisters it without closing. */
export function pushPanel(id, close) {
  const entry = { id, key: ++seq, close };
  stack.push(entry);
  try {
    history.pushState({ panel: entry.key }, "");
  } catch {
    /* file: or a sandbox with no history */
  }
  return () => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    // pop our history entry without triggering the popstate close
    if (history.state?.panel === entry.key) {
      ignorePop++;
      try {
        history.back();
      } catch {
        ignorePop--;
      }
    }
  };
}

export function topPanel() {
  return stack[stack.length - 1]?.id || null;
}

/** Close the topmost panel (the ✕ that Escape and the back gesture share). */
export function closeTop() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

let watching = false;
/** Start mirroring the visual viewport and the back gesture. Idempotent. */
export function watchPanels() {
  if (watching) return;
  watching = true;
  addEventListener("popstate", () => {
    if (ignorePop > 0) {
      ignorePop--;
      return;
    }
    const top = stack.pop();
    if (top) top.close();
  });
  const vv = window.visualViewport;
  const root = document.documentElement;
  let lastH = innerHeight;
  const apply = () => {
    const h = Math.round(vv ? vv.height : innerHeight);
    root.style.setProperty("--vvh", `${h}px`);
    root.style.setProperty("--vv-top", `${Math.round(vv?.offsetTop || 0)}px`);
    const keyboard = h < lastH - 120 || (vv && innerHeight - h > 120);
    root.classList.toggle("keyboard", !!keyboard);
    lastH = Math.max(lastH, h);
    if (keyboard) {
      // the field being typed in stays visible above the keyboard
      const el = document.activeElement;
      if (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) setTimeout(() => el.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 60);
    }
    dispatchEvent(new CustomEvent("panels:viewport", { detail: { height: h, keyboard: !!keyboard } }));
  };
  apply();
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  addEventListener("resize", () => {
    lastH = innerHeight;
    apply();
  });
  addEventListener("orientationchange", () => setTimeout(apply, 250));
}

/** Below this width the drawer is a bottom sheet and the rail is icons only. */
export const PHONE = 768;
export const isPhone = () => innerWidth < PHONE;
