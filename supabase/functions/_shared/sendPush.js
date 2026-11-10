// Sending a push from a SERVER (an Edge Function), straight to OneSignal.
//
// Why this exists: the app sends pushes by calling the send-notification Edge Function as the signed-in admin. A function
// calling that same function with the service-role key depends on the Supabase gateway and send-notification both accepting
// that key, and that is what returned 401 for agent-api. Here there is no second function in the way: the same request
// send-notification would make (same OneSignal app, same external ids, same title / body / url), made directly with the
// ONESIGNAL_REST_API_KEY secret.
//
// send-notification stays as it is for the app (admin browser calls). This file does not know the wording: callers pass
// { userIds | broadcast, title, body, url } built from notifyCopy.js exactly as before.
//
// Plain JS, no Deno-only imports, so the tests run it with Node and a fake fetch.

// Public, non-secret. The same id as send-notification/index.ts and the client-side OneSignalInit.jsx.
export const ONESIGNAL_APP_ID = 'eedcef3b-5612-48ad-ac57-5e1e9f19abbc'
export const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications'

export class PushError extends Error {}

// What OneSignal is sent. Same checks as send-notification: a title and body, and exactly one of userIds / broadcast.
export function buildNotification({ userIds, broadcast, title, body, url } = {}) {
  if (!title || !body) throw new PushError('title and body are required')
  const hasUserIds = Array.isArray(userIds) && userIds.length > 0
  if (!broadcast && !hasUserIds) throw new PushError('Provide either a non-empty userIds array or broadcast: true')
  if (broadcast && hasUserIds) throw new PushError('Provide either userIds or broadcast, not both')
  return {
    app_id: ONESIGNAL_APP_ID,
    target_channel: 'push',
    headings: { en: title },
    contents: { en: body },
    ...(url ? { url } : {}),
    ...(broadcast
      ? { included_segments: ['Active Subscriptions'] }   // this app's default segment for any active push subscriber
      : { include_aliases: { external_id: userIds } }),
  }
}

// Sends it. Resolves { ok: true, id, recipients } or throws PushError with a plain-English reason.
export async function sendPush(payload, { restApiKey, fetchFn = globalThis.fetch } = {}) {
  if (!restApiKey) throw new PushError('ONESIGNAL_REST_API_KEY is not set for this function')
  const notification = buildNotification(payload)
  let res
  try {
    res = await fetchFn(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Key ${restApiKey}` },
      body: JSON.stringify(notification),
    })
  } catch (err) {
    throw new PushError(`could not reach OneSignal (${err?.message || err})`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.errors ? JSON.stringify(data.errors) : data ? JSON.stringify(data) : ''
    throw new PushError(`OneSignal answered ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
  }
  return { ok: true, id: data?.id, recipients: data?.recipients }
}

// A database client whose functions.invoke('send-notification', ...) goes straight to OneSignal instead. Everything else on the
// client, and every other function it invokes, is untouched. So the shared pipeline code (result teasers, non-runner notices,
// picks open, end of day, Replace race, the agent's admin pushes ...) sends from agent-api with no change to that code.
// Answers like invoke does: { data, error }. When a push fails, `onFail({ reason, title, userCount, broadcast })` is called
// (agent-api uses it to write "Push failed: ..." to agent_log) and the failure is returned as `error`, so each caller handles it
// exactly as it handled a failed invoke.
export function withDirectPush(client, { restApiKey, fetchFn, onFail } = {}) {
  const functions = {
    invoke: async (name, opts = {}) => {
      if (name !== 'send-notification') return client.functions.invoke(name, opts)
      const payload = opts.body || {}
      try {
        const out = await sendPush(payload, { restApiKey, fetchFn })
        return { data: out, error: null }
      } catch (err) {
        const reason = err?.message || String(err)
        console.error('[push] failed:', reason)
        try {
          await onFail?.({ reason, title: payload.title || '', userCount: Array.isArray(payload.userIds) ? payload.userIds.length : null, broadcast: !!payload.broadcast })
        } catch (e) { console.error('[push] could not record the failure:', e) }
        return { data: null, error: new PushError(reason) }
      }
    },
  }
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'functions') return functions
      const v = Reflect.get(target, prop)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}
