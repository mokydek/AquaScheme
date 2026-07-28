import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversionGuard } from './conversion-guard.js'

test('limits concurrent ODA conversions and releases a slot exactly once', () => {
  const guard = createConversionGuard({ MAX_CONCURRENT_CONVERSIONS: '1' })
  const first = guard.admit('client-a')
  assert.equal(first.ok, true)
  assert.equal(guard.admit('client-b').code, 'CONVERTER_BUSY')
  first.release()
  first.release()
  assert.equal(guard.admit('client-b').ok, true)
})

test('limits requests per rolling minute per client', () => {
  let timestamp = 10_000
  const guard = createConversionGuard({
    MAX_CONCURRENT_CONVERSIONS: '5',
    CONVERSION_REQUESTS_PER_MINUTE: '2',
  }, () => timestamp)
  const first = guard.admit('client-a'); first.release()
  const second = guard.admit('client-a'); second.release()
  assert.equal(guard.admit('client-a').code, 'CONVERSION_RATE_LIMITED')
  timestamp += 60_001
  assert.equal(guard.admit('client-a').ok, true)
})

test('rejects unsafe limit configuration', () => {
  assert.throws(() => createConversionGuard({ MAX_CONCURRENT_CONVERSIONS: '0' }), /positive integer/)
  assert.throws(() => createConversionGuard({ CONVERSION_REQUESTS_PER_MINUTE: 'many' }), /positive integer/)
})
