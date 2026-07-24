import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { selectProvider } from './providers.js'

/**
 * Drawing conversion microservice, bidirectional since requirements update 3
 * (change 2): POST /convert?to=dwg|dxf accepts a DXF or DWG file and returns
 * the converted drawing. Export uses DXF -> DWG, import uses DWG -> DXF.
 * The provider is chosen by config (CONVERT_PROVIDER).
 */

const app = express()
app.use(cors())
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

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

app.post('/convert', upload.single('file'), async (req, res) => {
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
    const output = await provider.convert(req.file.buffer, from, to, version)
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
