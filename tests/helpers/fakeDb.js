// A small in-memory stand-in for the Supabase client, for testing the shared pipeline and the agent endpoint without a
// database. It follows the parts of PostgREST the code relies on:
//   - a write returns its rows only when .select() is chained on it (the app always does that to catch RLS changing 0 rows)
//   - .single() errors on 0 or many rows, .maybeSingle() on many
//   - unique constraints (see UNIQUE) answer with Postgres' 23505, including a partial unique index
//   - functions.invoke() records the call instead of sending anything
// Ids are counted ('id-1', 'id-2' ...) so two runs of the same steps give the same rows.

// table -> [{ cols, when? }]. `when` makes the index partial.
export const UNIQUE = {
  reminder_log: [{ cols: ['race_week_id', 'festival_day_id', 'kind'], nullsDistinct: false }],
  agent_drafts: [{ cols: ['kind', 'run_id'], when: r => r.run_id != null }],
  owner_silks: [{ cols: ['owner_id'] }],
  agent_watchdog_log: [{ cols: ['alert_key'] }],
  festival_day_points: [{ cols: ['festival_id', 'user_id', 'day_number'] }],
}

const DEFAULTS = {
  agent_drafts: () => ({ status: 'pending', flags: [] }),
  agent_log: () => ({ actor: 'agent', ok: true }),
  races: () => ({ is_abandoned: false, runner_count_at_lock: null }),
  festival_races: () => ({ is_abandoned: false, runner_count_at_lock: null }),
  runners: () => ({ is_withdrawn: false }),
  festival_runners: () => ({ is_withdrawn: false }),
}

const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export function createFakeDb(seed = {}, { unique = UNIQUE, clock = () => '2026-11-14T15:00:00.000Z' } = {}) {
  const tables = {}
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map(r => ({ ...clone(r) }))
  const calls = { invoked: [], writes: [] }
  let counter = 0
  const rowsOf = t => (tables[t] ||= [])

  const uniqueViolation = (table, candidate, ignore = null) => {
    for (const u of unique[table] || []) {
      if (u.when && !u.when(candidate)) continue
      const hit = rowsOf(table).find(r => r !== ignore && (!u.when || u.when(r)) && u.cols.every(c => {
        const a = r[c] ?? null, b = candidate[c] ?? null
        return a === b && !(a === null && u.nullsDistinct !== false)
      }))
      if (hit) return { code: '23505', message: `duplicate key value violates unique constraint on ${table} (${u.cols.join(', ')})` }
    }
    return null
  }

  class Query {
    constructor(table) {
      this.table = table; this.op = 'select'; this.filters = []; this.orders = []; this.rng = null; this.lim = null
      this.payload = null; this.wantRows = false; this.card = null; this.cols = '*'; this.countMode = false; this.head = false
      this.onConflict = null
    }
    select(cols = '*', opts = {}) {
      this.cols = cols
      if (this.op !== 'select') this.wantRows = true
      if (opts.count) this.countMode = true
      if (opts.head) this.head = true
      return this
    }
    eq(k, v) { this.filters.push(r => (r[k] ?? null) === v); return this }
    neq(k, v) { this.filters.push(r => (r[k] ?? null) !== v); return this }
    in(k, vs) { this.filters.push(r => vs.includes(r[k])); return this }
    is(k, v) { this.filters.push(r => (r[k] ?? null) === v); return this }
    not(k, op, v) {
      if (op === 'is') this.filters.push(r => (r[k] ?? null) !== v)
      else if (op === 'in') this.filters.push(r => !String(v).replace(/[()]/g, '').split(',').includes(String(r[k])))
      else throw new Error(`fakeDb: not(${op}) is not supported`)
      return this
    }
    gte(k, v) { this.filters.push(r => r[k] != null && r[k] >= v); return this }
    gt(k, v) { this.filters.push(r => r[k] != null && r[k] > v); return this }
    lte(k, v) { this.filters.push(r => r[k] != null && r[k] <= v); return this }
    lt(k, v) { this.filters.push(r => r[k] != null && r[k] < v); return this }
    order(k, { ascending = true } = {}) { this.orders.push({ k, ascending }); return this }
    range(a, b) { this.rng = [a, b]; return this }
    limit(n) { this.lim = n; return this }
    single() { this.card = 'one'; return this }
    maybeSingle() { this.card = 'maybe'; return this }
    insert(p) { this.op = 'insert'; this.payload = p; return this }
    update(p) { this.op = 'update'; this.payload = p; return this }
    upsert(p, opts = {}) { this.op = 'upsert'; this.payload = p; this.onConflict = opts.onConflict || null; return this }
    delete() { this.op = 'delete'; return this }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej) }

    project(rows) {
      const cols = this.cols === '*' ? null : String(this.cols).split(',').map(c => c.trim()).filter(Boolean)
      return rows.map(r => {
        if (!cols || cols.some(c => c.includes('('))) return clone(r)
        return Object.fromEntries(cols.map(c => [c, clone(r[c] ?? null)]))
      })
    }
    finish(rows, count = null) {
      let out = rows
      for (const o of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[o.k], y = b[o.k]
          if (x === y) return 0
          if (x == null) return 1
          if (y == null) return -1
          return (x < y ? -1 : 1) * (o.ascending ? 1 : -1)
        })
      }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1)
      if (this.lim != null) out = out.slice(0, this.lim)
      if (this.head) return { data: null, error: null, count: count ?? rows.length }
      const data = this.project(out)
      const countOut = this.countMode ? (count ?? rows.length) : null
      if (this.card === 'one') {
        return data.length === 1 ? { data: data[0], error: null, count: countOut } : { data: null, error: { code: 'PGRST116', message: `Expected one row, got ${data.length}` } }
      }
      if (this.card === 'maybe') {
        if (data.length > 1) return { data: null, error: { code: 'PGRST116', message: `Expected at most one row, got ${data.length}` } }
        return { data: data[0] || null, error: null, count: countOut }
      }
      return { data, error: null, count: countOut }
    }
    matching() { return rowsOf(this.table).filter(r => this.filters.every(f => f(r))) }

    run() {
      const t = this.table
      const rows = rowsOf(t)
      if (this.op === 'select') return this.finish(this.matching())

      if (this.op === 'insert' || this.op === 'upsert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map(clone)
        // all-or-nothing, like a single INSERT statement
        const staged = []
        for (const item of list) {
          const keys = this.onConflict ? this.onConflict.split(',').map(s => s.trim()) : null
          const existing = this.op === 'upsert' && keys ? rows.find(r => keys.every(k => (r[k] ?? null) === (item[k] ?? null))) : null
          const candidate = existing ? { ...existing, ...item } : { ...(DEFAULTS[t]?.() || {}), id: `id-${++counter}`, ...item }
          const dup = uniqueViolation(t, candidate, existing)
          if (dup) {
            const added = staged.filter(s => !s.existing).map(s => s.candidate)
            tables[t] = rows.filter(r => !added.includes(r))
            return { data: null, error: dup }
          }
          staged.push({ existing, candidate })
          if (!existing) rows.push(candidate)           // visible to the next item's uniqueness check
          else Object.assign(existing, candidate)
        }
        calls.writes.push({ table: t, op: this.op, n: list.length })
        const made = staged.map(s => s.candidate)
        return this.wantRows ? this.finish(made) : { data: null, error: null }
      }

      const hit = this.matching()
      if (this.op === 'update') {
        for (const r of hit) {
          const next = { ...r, ...clone(this.payload) }
          const dup = uniqueViolation(t, next, r)
          if (dup) return { data: null, error: dup }
          Object.assign(r, next)
        }
        calls.writes.push({ table: t, op: 'update', n: hit.length })
        return this.wantRows ? this.finish(hit) : { data: null, error: null }
      }
      if (this.op === 'delete') {
        tables[t] = rows.filter(r => !hit.includes(r))
        calls.writes.push({ table: t, op: 'delete', n: hit.length })
        return this.wantRows ? this.finish(hit) : { data: null, error: null }
      }
      throw new Error(`fakeDb: unknown op ${this.op}`)
    }
  }

  const client = {
    from: t => new Query(t),
    rpc: async name => ({ data: null, error: { message: `fakeDb: rpc ${name} is not supported` } }),
    functions: {
      invoke: async (name, opts = {}) => {
        calls.invoked.push({ name, body: clone(opts.body) })
        return { data: { ok: true }, error: null }
      },
    },
  }

  // The rows as they stand, with times and counter ids left out, so two runs can be compared exactly.
  const volatile = k => /(_at|_by)$/.test(k) || k === 'updated_at'
  const snapshot = () => Object.fromEntries(Object.keys(tables).sort().map(t => [t, tables[t]
    .map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !volatile(k)).sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))

  return { client, tables, calls, snapshot, clock }
}
