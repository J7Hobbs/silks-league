// The app-start splash lives in index.html (so it is the very first thing painted) and is switched off here.
// It covers app start only: from the first paint until the first page has mounted. Pages keep their own skeletons after that.
// index.html defines window.__dismissSplash; calling it more than once, or when there is no splash, does nothing.
export function dismissSplash() {
  if (typeof window !== 'undefined') window.__dismissSplash?.()
}
