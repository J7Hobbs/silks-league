// Who may run the scheduled functions (picks-deadline-reminder, agent-watchdog): supabase/functions/_shared/cronAuth.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import { isCronAuthorised } from '../supabase/functions/_shared/cronAuth.js'

const SECRET = 'cron-secret-0123456789abcdef'
const SERVICE = 'service-role-key-xyz'
const req = headers => new Headers(headers)
const env = (over = {}) => ({ cronSecret: SECRET, serviceKey: SERVICE, ...over })

test('the right x-cron-secret is let in, even when Authorization is the legacy JWT that no longer matches the runtime key', () => {
  assert.equal(isCronAuthorised(req({ 'x-cron-secret': SECRET, Authorization: 'Bearer legacy.jwt.value' }), env()), true)
  assert.equal(isCronAuthorised(req({ 'x-cron-secret': SECRET }), env()), true)
})

test('a wrong or missing x-cron-secret is refused', () => {
  assert.equal(isCronAuthorised(req({ 'x-cron-secret': SECRET + 'x', Authorization: 'Bearer legacy.jwt.value' }), env()), false)
  assert.equal(isCronAuthorised(req({ 'x-cron-secret': SECRET.slice(0, -1) }), env()), false)
  assert.equal(isCronAuthorised(req({ 'x-cron-secret': '' }), env()), false)
  assert.equal(isCronAuthorised(req({ Authorization: 'Bearer legacy.jwt.value' }), env()), false)
  assert.equal(isCronAuthorised(req({}), env()), false)
})

test('with CRON_SECRET unset, empty or under 16 characters nothing can use the secret path', () => {
  for (const cronSecret of [undefined, null, '', 'short-secret']) {
    assert.equal(isCronAuthorised(req({ 'x-cron-secret': cronSecret ?? '' }), env({ cronSecret })), false, String(cronSecret))
    assert.equal(isCronAuthorised(req({ 'x-cron-secret': 'short-secret' }), env({ cronSecret: 'short-secret' })), false, 'a short secret is never accepted, even when it matches')
  }
  assert.equal(isCronAuthorised(req({ 'x-cron-secret': 'undefined' }), env({ cronSecret: undefined })), false)
})

test('the old Authorization check still works as an alternative', () => {
  assert.equal(isCronAuthorised(req({ Authorization: `Bearer ${SERVICE}` }), env()), true)
  assert.equal(isCronAuthorised(req({ Authorization: `Bearer ${SERVICE}` }), env({ cronSecret: undefined })), true)
  assert.equal(isCronAuthorised(req({ Authorization: `Bearer ${SERVICE}x` }), env()), false)
  assert.equal(isCronAuthorised(req({ Authorization: SERVICE }), env()), false, 'the Bearer prefix is required')
})

test('an unset service key can never be matched by "Bearer undefined" or an empty header', () => {
  assert.equal(isCronAuthorised(req({ Authorization: 'Bearer undefined' }), env({ serviceKey: undefined })), false)
  assert.equal(isCronAuthorised(req({ Authorization: 'Bearer ' }), env({ serviceKey: '' })), false)
  assert.equal(isCronAuthorised(req({}), env({ serviceKey: undefined, cronSecret: undefined })), false)
})
