import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isLockError, pickSaveMessage, bankerFailMessage } from '../src/lib/pickErrors.js'

test('a lock rejection from the database is shown as "Picks are locked"', () => {
  assert.equal(isLockError({ message: 'Picks are locked for this race day' }), true)
  assert.equal(pickSaveMessage({ message: 'Picks are locked for this race day' }), 'Picks are locked')
  assert.equal(pickSaveMessage({ message: 'Picks are locked: the banker can no longer be changed' }), 'Picks are locked')
})

test('any other error keeps its text', () => {
  assert.equal(isLockError({ message: 'That horse has been withdrawn' }), false)
  assert.equal(pickSaveMessage({ message: 'That horse has been withdrawn' }), 'Failed to save — That horse has been withdrawn')
  assert.equal(pickSaveMessage(null), 'Failed to save — something went wrong')
})

test('a banker failure says whether it was the lock', () => {
  assert.equal(bankerFailMessage({ message: 'Picks are locked: the banker can no longer be changed' }), 'Picks are locked, so the banker was not changed')
  assert.equal(bankerFailMessage({ message: 'boom' }), 'Pick saved, but the banker was not changed: boom')
})
