import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { selectProvider } from './providers.js'
import { createCorsPolicy } from './cors-policy.js'
import { createConversionGuard } from './conversion-guard.js'

/**
 * Drawing conversion microservice, bidirectional since requirements update 3
 * (change 2): POST /convert?to=dwg|dxf accepts a DXF or DWG file and returns
 * the converted drawing. Export uses DXF -> DWG, import uses DWG -> DXF.
 * The provider is chosen by config (CONVERT_PROVIDER).
 */

const app = express()
const corsPolicy = createCorsPolicy(process.env)
const conversionGuard = createConversionGuard(process.env)
app.set('trust proxy', 1)

// Reject disallowed browser origins before an expensive conversion starts.
// Requests without Origin remain available to health checks and trusted
// server-to-server clients; CORS itself is not an authentication mechanism.
app.use((req, res, next) => {
  const origin = req.get('Origin')
  if (origin && !corsPolicy.allows(origin)) {
    res.vary('Origin')
    res.status(403).json({ error: 'origin not allowed', code: 'CORS_ORIGIN_DENIED' })
    return
  }
  next()
})
app.use(cors({
  origin: (origin, callback) => callback(null, corsPolicy.allows(origin)),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400,
}))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

function guardConversion(req, res, next) {
  if (corsPolicy.production && !req.get('Origin')) {
    res.status(403).json({ error: 'browser origin required', code: 'CLIENT_ORIGIN_REQUIRED' })
    return
  }
  const admission = conversionGuard.admit(req.ip || req.socket.remoteAddress || 'unknown')
  if (!admission.ok) {
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: admission.code === 'CONVERTER_BUSY' ? 'converter busy' : 'rate limit exceeded', code: admission.code })
    return
  }
  res.once('finish', admission.release)
  res.once('close', admission.release)
  next()
}

const CONTENT_TYPES = { dwg: 'application/acad', dxf: 'application/dxf' }

/**
 * Source format from the file name, falling back to the DWG magic bytes
 * (binary DWG starts with an ASCII version signature such as AC1032).
 * @param {Buffer} buffer
 * @param {string} name
 * @returns {'dwg' | 'dxf'}
 */
function sniffFormat(buffer, name) {
  if (/\.dwg$/i.test(name)) return 'dwg'
  if (/\.dxf$/i.test(name)) return 'dxf'
  return buffer.subarray(0, 4).toString('latin1') === 'AC10' ? 'dwg' : 'dxf'
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    provider: selectProvider().name,
    directions: ['dxf>dwg', 'dwg>dxf'],
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
  })
})

app.get('/ready', async (_req, res) => {
  const provider = selectProvider()
  const readiness = await provider.ready()
  res.status(readiness.ok ? 200 : 503).json({ ...readiness, provider: provider.name })
})

app.post('/convert', guardConversion, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'no file' })
    return
  }
  const to = String(req.query.to || 'dwg').toLowerCase()
  if (to !== 'dwg' && to !== 'dxf') {
    res.status(400).json({ error: 'to must be dwg or dxf' })
    return
  }
  const version = String(req.query.version || 'ACAD2018')
  if (!/^ACAD(2000|2004|2007|2010|2013|2018)$/.test(version)) {
    res.status(400).json({ error: 'unsupported AutoCAD version' })
    return
  }
  const from = sniffFormat(req.file.buffer, req.file.originalname || '')
  res.setHeader('Content-Type', CONTENT_TYPES[to])
  res.setHeader('Content-Disposition', `attachment; filename="drawing.${to}"`)
  if (from === to) {
    // Nothing to convert: hand the file back so callers stay format agnostic.
    res.send(req.file.buffer)
    return
  }
  try {
    const provider = selectProvider()
    const readiness = await provider.ready()
    if (!readiness.ok) {
      res.removeHeader('Content-Disposition')
      res.type('json')
      res.status(503).json({ error: readiness.reason, code: 'CONVERTER_NOT_READY' })
      return
    }
    const output = await provider.convert(req.file.buffer, from, to, version)
    res.setHeader('X-Converter-Provider', provider.name)
    res.setHeader('X-Converter-Version', process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? 'local')
    res.send(output)
  } catch (error) {
    res.removeHeader('Content-Disposition')
    res.type('json')
    res.status(500).json({ error: String(error instanceof Error ? error.message : error) })
  }
})

const port = process.env.PORT || 8080
app.listen(port, () => {
  console.log(`aquascheme-converter listening on ${port}`)
})
