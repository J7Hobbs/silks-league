// Banner photo positions: any stored value becomes a plain "X% Y%" (src/lib/photoPosition.js), and Admin reads the same values.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./helpers/viteResolve.mjs', import.meta.url)
const { photoPosition, parsePhotoPosition } = await import('../src/lib/photoPosition.js')
const { parseBannerPosition } = await import('../src/lib/setupView.js')

test('what Admin writes ("center <n>%") is unchanged in meaning', () => {
  assert.equal(photoPosition('center 35%'), '50% 35%')
  assert.equal(photoPosition('center 0%'), '50% 0%')
  assert.equal(photoPosition('center 100%'), '50% 100%')
  assert.equal(photoPosition('center 42.5%'), '50% 42.5%')
})

test('Tingle Creek\'s stored "35% center" reads as the browser reads it: 35% across, centred down', () => {
  assert.equal(photoPosition('35% center'), '35% 50%')
  assert.deepEqual(parsePhotoPosition('35% center'), { x: 35, y: 50 })
})

test('keywords, one value, other spacing and case', () => {
  assert.equal(photoPosition('top'), '50% 0%')
  assert.equal(photoPosition('Bottom'), '50% 100%')
  assert.equal(photoPosition('left'), '0% 50%')
  assert.equal(photoPosition('center'), '50% 50%')
  assert.equal(photoPosition('30%'), '30% 50%')
  assert.equal(photoPosition('  50%   20% '), '50% 20%')
  assert.equal(photoPosition('left top'), '0% 0%')
  assert.equal(photoPosition('top left'), '0% 0%')
  assert.equal(photoPosition('bottom center'), '50% 100%')
  assert.equal(photoPosition('right center'), '100% 50%')
})

test('out-of-range numbers are held to the photo; empty or unusable values use the default', () => {
  assert.equal(photoPosition('center 150%'), '50% 100%')
  assert.equal(photoPosition('center -20%'), '50% 0%')
  for (const v of [null, undefined, '', '   ', '10px 5px', 'calc(50% + 2px) center', 'nonsense', 'center 35% extra', 'top 30%', 'left right']) {
    assert.equal(photoPosition(v), '50% 35%', String(v))
  }
  assert.equal(photoPosition('', 'center 80%'), '50% 80%', 'a card can pass its own default')
  assert.equal(photoPosition('bad', 'center'), '50% 50%')
})

test('Admin: the values it wrote still read the same, and spellings the browser treats the same now show on the slider', () => {
  assert.deepEqual(parseBannerPosition('center 35%'), { y: 35, saved: true, odd: false })
  assert.deepEqual(parseBannerPosition(''), { y: 35, saved: false, odd: false })
  assert.deepEqual(parseBannerPosition('top'), { y: 0, saved: true, odd: false })
  assert.deepEqual(parseBannerPosition('50% 20%'), { y: 20, saved: true, odd: false })
  assert.deepEqual(parseBannerPosition('center  60%'), { y: 60, saved: true, odd: false })
  // Moves the photo sideways, which the slider can't show: flagged as odd, left alone.
  assert.deepEqual(parseBannerPosition('35% center'), { y: 35, saved: true, odd: true })
})
