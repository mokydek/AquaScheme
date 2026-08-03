import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudConvert } from './cloudconvert.js'

const KEY = 'secret-key-12345'
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const bin = (bytes) => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(bytes).buffer })
const bad = (status, text) => ({ ok: false, status, text: async () => text, json: async () => ({}) })

/** A job that uploads, runs and exports a two-byte drawing. */
function happyPath(record = []) {
  let polls = 0
  return async (url, init) => {
    record.push({ url: String(url), method: init?.method ?? 'GET' })
    if (String(url).endsWith('/jobs') && init?.method === 'POST') {
      return ok({ data: {
        id: 'job-1',
        tasks: [{ name: 'import-file', result: { form: { url: 'https://upload.test/form', parameters: { k: 'v' } } } }],
      } })
    }
    if (String(url) === 'https://upload.test/form') return ok({ ok: true })
    if (String(url).endsWith('/jobs/job-1')) {
      polls += 1
      if (polls < 2) return ok({ data: { status: 'processing', tasks: [] } })
      return ok({ data: {
        status: 'finished',
        tasks: [{ name: 'export-file', result: { files: [{ url: 'https://files.test/out.dwg' }] } }],
      } })
    }
    if (String(url) === 'https://files.test/out.dwg') return bin([65, 67])
    throw new Error(`unexpected request: ${url}`)
  }
}

const instant = { sleep: async () => {}, pollIntervalMs: 0 }

test('runs the job: create, upload, poll, download', async () => {
  const calls = []
  const provider = createCloudConvert({ apiKey: KEY, fetchImpl: happyPath(calls), ...instant })
  const result = await provider.convert(Buffer.from([1, 2, 3]), 'dxf', 'dwg', 'ACAD2018')
  assert.deepEqual([...result], [65, 67])
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'POST', 'GET', 'GET', 'GET'])
})

test('reports a job the service failed, with its reason', async () => {
  const provider = createCloudConvert({
    apiKey: KEY,
    ...instant,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/jobs') && init?.method === 'POST') {
        return ok({ data: { id: 'j', tasks: [{ name: 'import-file', result: { form: { url: 'https://u.test' } } }] } })
      }
      if (String(url) === 'https://u.test') return ok({})
      return ok({ data: { status: 'error', tasks: [{ status: 'error', message: 'unsupported input' }] } })
    },
  })
  await assert.rejects(() => provider.convert(Buffer.from([1]), 'dxf', 'dwg', ''), /unsupported input/)
})

test('never puts the API key into an error message', async () => {
  const provider = createCloudConvert({
    apiKey: KEY,
    ...instant,
    fetchImpl: async () => bad(500, `upstream said ${KEY} is throttled`),
  })
  await assert.rejects(
    () => provider.convert(Buffer.from([1]), 'dxf', 'dwg', ''),
    (error) => {
      assert.ok(!error.message.includes(KEY), 'ключ просочился в сообщение об ошибке')
      assert.match(error.message, /\*\*\*/)
      return true
    },
  )
})

test('gives up instead of polling forever', async () => {
  let now = 0
  const provider = createCloudConvert({
    apiKey: KEY,
    pollIntervalMs: 0,
    timeoutMs: 50,
    sleep: async () => { now += 40 },
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/jobs') && init?.method === 'POST') {
        return ok({ data: { id: 'j', tasks: [{ name: 'import-file', result: { form: { url: 'https://u.test' } } }] } })
      }
      if (String(url) === 'https://u.test') return ok({})
      return ok({ data: { status: 'processing', tasks: [] } })
    },
  })
  const started = Date.now()
  await assert.rejects(() => provider.convert(Buffer.from([1]), 'dxf', 'dwg', ''), /не завершилось/)
  assert.ok(Date.now() - started < 5000, 'таймаут не сработал')
})

test('зависший запрос не держит конвертацию вечно', { timeout: 10_000 }, async () => {
  // Предел в 180 с объявлен, но проверялся только между опросами. Если сам
  // HTTP-вызов не отвечает, ждать было некому: обещание не завершалось никогда,
  // а при MAX_CONCURRENT_CONVERSIONS=1 это занимало единственное место очереди.
  for (const stalled of ['https://api.cloudconvert.com/v2/jobs', 'https://u.test', '/jobs/j', 'https://f.test']) {
    const provider = createCloudConvert({
      apiKey: KEY,
      pollIntervalMs: 0,
      timeoutMs: 120,
      sleep: async () => {},
      fetchImpl: async (url, init) => {
        if (String(url).includes(stalled)) return new Promise(() => {})
        if (String(url).endsWith('/jobs') && init?.method === 'POST') {
          return ok({ data: { id: 'j', tasks: [{ name: 'import-file', result: { form: { url: 'https://u.test' } } }] } })
        }
        if (String(url) === 'https://u.test') return ok({})
        if (String(url).endsWith('/jobs/j')) {
          return ok({ data: { status: 'finished', tasks: [{ name: 'export-file', result: { files: [{ url: 'https://f.test' }] } }] } })
        }
        return bin([7])
      },
    })
    const started = Date.now()
    await assert.rejects(
      () => provider.convert(Buffer.from([1]), 'dxf', 'dwg', ''),
      /не ответил|не завершилось/,
      `зависание на ${stalled} осталось незамеченным`,
    )
    assert.ok(Date.now() - started < 3000, `ожидание на ${stalled} не ограничено`)
  }
})

test('проверка готовности тоже ограничена по времени', { timeout: 10_000 }, async () => {
  const provider = createCloudConvert({
    apiKey: KEY,
    readyTimeoutMs: 60,
    fetchImpl: async () => new Promise(() => {}),
  })
  const started = Date.now()
  const readiness = await provider.ready()
  assert.equal(readiness.ok, false)
  assert.match(readiness.reason, /не ответил/)
  assert.ok(Date.now() - started < 3000, 'проверка готовности зависла')
})

test('rejects an empty result rather than passing it on', async () => {
  const provider = createCloudConvert({
    apiKey: KEY,
    ...instant,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/jobs') && init?.method === 'POST') {
        return ok({ data: { id: 'j', tasks: [{ name: 'import-file', result: { form: { url: 'https://u.test' } } }] } })
      }
      if (String(url) === 'https://u.test') return ok({})
      if (String(url).endsWith('/jobs/j')) {
        return ok({ data: { status: 'finished', tasks: [{ name: 'export-file', result: { files: [{ url: 'https://f.test' }] } }] } })
      }
      return bin([])
    },
  })
  await assert.rejects(() => provider.convert(Buffer.from([1]), 'dxf', 'dwg', ''), /пустой чертёж/)
})

test('readiness distinguishes a missing key, a rejected key and a live one', async () => {
  assert.deepEqual(
    await createCloudConvert({ apiKey: '', fetchImpl: async () => ok({}) }).ready(),
    { ok: false, reason: 'CLOUDCONVERT_API_KEY не задан.' },
  )
  const rejected = await createCloudConvert({ apiKey: KEY, fetchImpl: async () => bad(401, 'no') }).ready()
  assert.equal(rejected.ok, false)
  assert.match(rejected.reason, /401/)
  assert.deepEqual(await createCloudConvert({ apiKey: KEY, fetchImpl: async () => ok({}) }).ready(), { ok: true })
})

test('asks for the requested direction', async () => {
  let sent = null
  const provider = createCloudConvert({
    apiKey: KEY,
    ...instant,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/jobs') && init?.method === 'POST') {
        sent = JSON.parse(init.body)
        return ok({ data: { id: 'j', tasks: [{ name: 'import-file', result: { form: { url: 'https://u.test' } } }] } })
      }
      if (String(url) === 'https://u.test') return ok({})
      if (String(url).endsWith('/jobs/j')) {
        return ok({ data: { status: 'finished', tasks: [{ name: 'export-file', result: { files: [{ url: 'https://f.test' }] } }] } })
      }
      return bin([7])
    },
  })
  await provider.convert(Buffer.from([1]), 'dwg', 'dxf', 'ACAD2018')
  assert.equal(sent.tasks['convert-file'].input_format, 'dwg')
  assert.equal(sent.tasks['convert-file'].output_format, 'dxf')
})
