function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

/** In-process abuse guard. It complements CORS; CORS alone is not authentication. */
export function createConversionGuard(env = process.env, now = () => Date.now()) {
  const maxConcurrent = positiveInteger(env.MAX_CONCURRENT_CONVERSIONS, 1, 'MAX_CONCURRENT_CONVERSIONS')
  const requestsPerMinute = positiveInteger(env.CONVERSION_REQUESTS_PER_MINUTE, 6, 'CONVERSION_REQUESTS_PER_MINUTE')
  const buckets = new Map()
  let active = 0

  return Object.freeze({
    maxConcurrent,
    requestsPerMinute,
    admit(clientId) {
      const timestamp = now()
      const cutoff = timestamp - 60_000
      const recent = (buckets.get(clientId) ?? []).filter((item) => item > cutoff)
      if (recent.length >= requestsPerMinute) return { ok: false, code: 'CONVERSION_RATE_LIMITED' }
      if (active >= maxConcurrent) return { ok: false, code: 'CONVERTER_BUSY' }
      recent.push(timestamp)
      buckets.set(clientId, recent)
      active++
      let released = false
      return {
        ok: true,
        release() {
          if (released) return
          released = true
          active = Math.max(0, active - 1)
        },
      }
    },
  })
}
