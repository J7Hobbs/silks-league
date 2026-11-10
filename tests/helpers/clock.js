// Freeze `new Date()` and Date.now() at one moment, so code that looks at the time gives the same answer on every run.
export function freezeClock(iso) {
  const fixed = Date.parse(iso)
  const Real = Date
  class Frozen extends Real {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args) }
    static now() { return fixed }
  }
  globalThis.Date = Frozen
  return () => { globalThis.Date = Real }
}
