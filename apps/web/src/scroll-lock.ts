/** Reference-counted document scroll lock shared by modals, nav drawer, overlays. */
let locks = 0;

export function acquireScrollLock() {
  locks += 1;
  if (locks === 1) {
    document.documentElement.classList.add("scroll-lock");
    document.body.classList.add("scroll-lock");
  }
}

export function releaseScrollLock() {
  locks = Math.max(0, locks - 1);
  if (locks === 0) {
    document.documentElement.classList.remove("scroll-lock");
    document.body.classList.remove("scroll-lock");
  }
}
