/**
 * CloudConvert as the fallback drawing converter.
 *
 * ODA runs locally and never sees the network, which is why it is the default:
 * a topographic base is confidential. CloudConvert exists for installations
 * that cannot host ODA, and it is a hosted service — the drawing leaves the
 * machine. The caller chooses it explicitly through CONVERT_PROVIDER; nothing
 * here falls back to it silently.
 *
 * The v2 API is a job of three tasks: import/upload, convert, export/url. The
 * upload form comes back in the job response, the file is posted to it, and the
 * job is polled until the export task carries a download URL.
 *
 * `fetchImpl` and `sleep` are injected so the flow can be tested without
 * touching the network.
 */

const API = 'https://api.cloudconvert.com/v2'

export class CloudConvertError extends Error {
  constructor(message, stage) {
    super(message)
    this.name = 'CloudConvertError'
    this.stage = stage
  }
}

/** Never let a key reach a log line or an HTTP response. */
function scrub(text, apiKey) {
  if (!apiKey) return text
  return String(text).split(apiKey).join('***')
}

/**
 * Ограничивает ожидание ответа.
 *
 * Сигнал прерывания передаётся в fetch, чтобы соединение действительно
 * закрылось, а не осталось висеть сокетом. Но полагаться только на него нельзя:
 * гарантию даёт гонка с таймером, потому что реализацию fetch подменяют — и в
 * тестах, и у установок с собственным HTTP-клиентом, а обязанность завершиться
 * лежит на этом модуле, а не на том, что ему передали.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} start
 * @param {number} ms
 * @param {() => Error} onTimeout
 * @returns {Promise<T>}
 */
function withDeadline(start, ms, onTimeout) {
  const bounded = Math.max(1, Math.ceil(ms))
  const controller = new AbortController()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(onTimeout())
    }, bounded)
    Promise.resolve()
      .then(() => start(controller.signal))
      .then(resolve, reject)
      .finally(() => clearTimeout(timer))
  })
}

async function readError(response, apiKey) {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 400)
  } catch {
    detail = ''
  }
  return `HTTP ${response.status}${detail ? `: ${scrub(detail, apiKey)}` : ''}`
}

/**
 * @param {object} options
 * @param {string} [options.apiKey]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.timeoutMs] предельное время всей конвертации
 * @param {number} [options.readyTimeoutMs] предельное время проверки готовности
 */
export function createCloudConvert(options = {}) {
  const apiKey = options.apiKey ?? process.env.CLOUDCONVERT_API_KEY
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const timeoutMs = options.timeoutMs ?? 180_000
  // Проверка готовности отвечает на /ready и предваряет каждую конвертацию:
  // ждать её столько же, сколько само задание, значит держать очередь впустую.
  const readyTimeoutMs = options.readyTimeoutMs ?? 10_000

  const authorized = (extra = {}) => ({ Authorization: `Bearer ${apiKey}`, ...extra })

  return {
    name: 'cloudconvert',

    async ready() {
      if (!apiKey) return { ok: false, reason: 'CLOUDCONVERT_API_KEY не задан.' }
      if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch недоступен в этой среде Node.' }
      try {
        const response = await withDeadline(
          (signal) => fetchImpl(`${API}/users/me`, { headers: authorized(), signal }),
          readyTimeoutMs,
          () => new CloudConvertError(
            `CloudConvert не ответил за ${Math.round(readyTimeoutMs / 1000)} с.`, 'ready'),
        )
        if (response.ok) return { ok: true }
        if (response.status === 401) return { ok: false, reason: 'CloudConvert отклонил ключ (401).' }
        return { ok: false, reason: `CloudConvert недоступен: ${await readError(response, apiKey)}` }
      } catch (error) {
        return { ok: false, reason: `CloudConvert недоступен: ${scrub(error?.message ?? error, apiKey)}` }
      }
    },

    /**
     * @param {Buffer} input
     * @param {'dxf'|'dwg'} from
     * @param {'dxf'|'dwg'} to
     * @param {string} version
     * @returns {Promise<Buffer>}
     */
    async convert(input, from, to, version) {
      if (!apiKey) throw new CloudConvertError('CLOUDCONVERT_API_KEY не задан.', 'config')
      const deadline = Date.now() + timeoutMs
      const seconds = Math.round(timeoutMs / 1000)

      /**
       * Запрос в пределах общего срока задания. Каждый шаг ограничен остатком
       * времени, поэтому вся конвертация укладывается в объявленный предел, а не
       * только промежутки между опросами.
       */
      const request = (url, init, stage) => withDeadline(
        (signal) => fetchImpl(url, { ...init, signal }),
        deadline - Date.now(),
        () => new CloudConvertError(`CloudConvert не ответил за ${seconds} с.`, stage),
      )

      // 1. Create the job.
      const created = await request(`${API}/jobs`, {
        method: 'POST',
        headers: authorized({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tasks: {
            'import-file': { operation: 'import/upload' },
            'convert-file': {
              operation: 'convert',
              input: 'import-file',
              input_format: from,
              output_format: to,
              engine_version: version || undefined,
            },
            'export-file': { operation: 'export/url', input: 'convert-file' },
          },
        }),
      })
      if (!created.ok) {
        throw new CloudConvertError(`Не удалось создать задание: ${await readError(created, apiKey)}`, 'create')
      }
      const job = (await created.json())?.data
      const jobId = job?.id
      const importTask = (job?.tasks ?? []).find((task) => task.name === 'import-file')
      const form = importTask?.result?.form
      if (!jobId || !form?.url) {
        throw new CloudConvertError('Ответ CloudConvert не содержит форму загрузки.', 'create')
      }

      // 2. Upload the drawing to the form the job handed back.
      const body = new FormData()
      for (const [key, value] of Object.entries(form.parameters ?? {})) body.append(key, String(value))
      body.append('file', new Blob([input]), `drawing.${from}`)
      const uploaded = await request(form.url, { method: 'POST', body }, 'upload')
      if (!uploaded.ok) {
        throw new CloudConvertError(`Загрузка чертежа отклонена: ${await readError(uploaded, apiKey)}`, 'upload')
      }

      // 3. Poll until the job finishes.
      let exported = null
      for (;;) {
        if (Date.now() > deadline) {
          throw new CloudConvertError(`Задание не завершилось за ${seconds} с.`, 'poll')
        }
        await sleep(pollIntervalMs)
        const polled = await request(`${API}/jobs/${jobId}`, { headers: authorized() }, 'poll')
        if (!polled.ok) {
          throw new CloudConvertError(`Опрос задания не удался: ${await readError(polled, apiKey)}`, 'poll')
        }
        const state = (await polled.json())?.data
        if (state?.status === 'error') {
          const failed = (state.tasks ?? []).find((task) => task.status === 'error')
          throw new CloudConvertError(
            `CloudConvert вернул ошибку: ${scrub(failed?.message ?? 'причина не указана', apiKey)}`, 'convert',
          )
        }
        if (state?.status === 'finished') {
          exported = (state.tasks ?? []).find((task) => task.name === 'export-file')
          break
        }
      }

      // 4. Download the result.
      const file = exported?.result?.files?.[0]
      if (!file?.url) throw new CloudConvertError('Готовое задание не содержит файла результата.', 'export')
      const downloaded = await request(file.url, {}, 'export')
      if (!downloaded.ok) {
        throw new CloudConvertError(`Не удалось скачать результат: ${await readError(downloaded, apiKey)}`, 'export')
      }
      const bytes = Buffer.from(await downloaded.arrayBuffer())
      if (bytes.length === 0) throw new CloudConvertError('CloudConvert вернул пустой чертёж.', 'export')
      return bytes
    },
  }
}
