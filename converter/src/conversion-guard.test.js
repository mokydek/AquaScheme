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

test('счётчики выбывших клиентов не копятся', () => {
  // Запись заводилась на каждый адрес и удалялась только когда тот же адрес
  // возвращался. Служба смотрит в интернет: адреса не повторяются, и память
  // росла бы неограниченно — течь, которую не видно, пока процесс не упадёт.
  let timestamp = 0
  const guard = createConversionGuard({
    MAX_CONCURRENT_CONVERSIONS: '50',
    CONVERSION_REQUESTS_PER_MINUTE: '5',
  }, () => timestamp)
  for (let index = 0; index < 5_000; index++) {
    timestamp += 100
    guard.admit(`client-${index}`).release?.()
  }
  assert.ok(guard.trackedClients() < 1_000, `клиентов в памяти: ${guard.trackedClients()}`)

  // Забывчивость не должна ослаблять сам предел.
  timestamp += 60_001
  for (let index = 0; index < 5; index++) guard.admit('client-a').release?.()
  assert.equal(guard.admit('client-a').code, 'CONVERSION_RATE_LIMITED')
})

test('вернувшийся в пределах минуты клиент не забыт', () => {
  let timestamp = 0
  const guard = createConversionGuard({
    MAX_CONCURRENT_CONVERSIONS: '50',
    CONVERSION_REQUESTS_PER_MINUTE: '2',
  }, () => timestamp)
  guard.admit('client-a').release?.()
  guard.admit('client-a').release?.()
  for (let index = 0; index < 5_000; index++) {
    timestamp += 1
    guard.admit(`noise-${index}`).release?.()
  }
  assert.equal(guard.admit('client-a').code, 'CONVERSION_RATE_LIMITED')
})

test('rejects unsafe limit configuration', () => {
  assert.throws(() => createConversionGuard({ MAX_CONCURRENT_CONVERSIONS: '0' }), /positive integer/)
  assert.throws(() => createConversionGuard({ CONVERSION_REQUESTS_PER_MINUTE: 'many' }), /positive integer/)
})
