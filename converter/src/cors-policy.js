const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

function list(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseBoolean(value, name) {
  if (value === undefined || value === '') return undefined
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  throw new Error(`${name} must be true or false`)
}

function normalizedOrigin(value, name) {
  if (value === '*') throw new Error(`${name} must not contain *`)

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} contains an invalid origin: ${value}`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} allows only http:// or https:// origins`)
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${name} entries must be origins without credentials, path, query or fragment: ${value}`)
  }
  return url.origin
}

function requestOrigin(value) {
  if (typeof value !== 'string' || value === '' || value === 'null') return null
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      return null
    }
    return url
  } catch {
    return null
  }
}

function previewEntry(value) {
  const parts = value.split(':')
  if (parts.length !== 2) {
    throw new Error(`ALLOWED_VERCEL_PREVIEWS entries must use project:team, got: ${value}`)
  }
  const [project, team] = parts.map((part) => part.trim().toLowerCase())
  if (!SLUG_PATTERN.test(project) || !SLUG_PATTERN.test(team)) {
    throw new Error(`ALLOWED_VERCEL_PREVIEWS contains an invalid Vercel project or team slug: ${value}`)
  }
  return { project, team }
}

function isProductionEnvironment(env) {
  return env.NODE_ENV === 'production' || env.RENDER === 'true' || Boolean(env.RENDER_SERVICE_ID)
}

function isAllowedPreview(url, preview) {
  if (url.protocol !== 'https:' || url.port !== '') return false
  const prefix = `${preview.project}-`
  const suffix = `-${preview.team}.vercel.app`
  if (!url.hostname.startsWith(prefix) || !url.hostname.endsWith(suffix)) return false

  const deploymentPart = url.hostname.slice(prefix.length, -suffix.length)
  return deploymentPart.length > 0 && /^[a-z0-9-]+$/.test(deploymentPart)
}

/**
 * Build a fail-closed browser-origin policy for the converter.
 * Requests without an Origin header (health checks, curl and server-to-server
 * calls) remain available; browser origins must match the configured policy.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 */
export function createCorsPolicy(env = process.env) {
  const production = isProductionEnvironment(env)
  const exactOrigins = new Set(
    list(env.ALLOWED_ORIGINS).map((value) => normalizedOrigin(value, 'ALLOWED_ORIGINS')),
  )
  const vercelPreviews = list(env.ALLOWED_VERCEL_PREVIEWS).map(previewEntry)
  const configuredLocalhost = parseBoolean(env.ALLOW_LOCALHOST, 'ALLOW_LOCALHOST')
  const allowLocalhost = configuredLocalhost ?? !production

  return Object.freeze({
    exactOrigins: Object.freeze([...exactOrigins]),
    vercelPreviews: Object.freeze(vercelPreviews.map((value) => Object.freeze({ ...value }))),
    allowLocalhost,
    production,

    /** @param {string | undefined} origin */
    allows(origin) {
      // CORS is a browser boundary, not authentication. Render health checks,
      // CLI clients and trusted server-to-server calls normally omit Origin.
      if (origin === undefined || origin === '') return true

      const url = requestOrigin(origin)
      if (!url) return false
      if (exactOrigins.has(url.origin)) return true
      if (allowLocalhost && LOOPBACK_HOSTS.has(url.hostname)) return true
      return vercelPreviews.some((preview) => isAllowedPreview(url, preview))
    },
  })
}
