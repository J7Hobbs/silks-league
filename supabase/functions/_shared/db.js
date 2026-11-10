// The database client the shared pipeline code (scoring, bonuses, locking, withdrawals, result saving, notifications)
// talks to. That code runs in two places: in the app, with the signed-in browser client, and in Edge Functions, with a
// service-role client. Whoever starts up calls setClient() once; every `supabase.from(...)` in the shared files then
// goes to that client. The shared files themselves are the very same files in both places.
let client = null

export function setClient(c) { client = c }
export function getClient() { return client }

export const supabase = new Proxy({}, {
  get(_, prop) {
    if (!client) throw new Error('The database client has not been set (call setClient first)')
    const v = client[prop]
    return typeof v === 'function' ? v.bind(client) : v
  },
})
