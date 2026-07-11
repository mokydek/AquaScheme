import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { selectProvider } from './providers.js'

/**
 * DXF -> DWG conversion microservice. POST /convert accepts a DXF file and
 * returns a DWG. The provider is chosen by config (CONVERT_PROVIDER).
 */

const app = express()
app.use(cors())
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } })

app.get('/health', (_req, res) => {
  res.json({ ok: true, provider: selectProvider().name })
})

app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'no file' })
    return
  }
  const version = String(req.query.version || 'ACAD2018')
  try {
    const provider = selectProvider()
    const dwg = await provider.convert(req.file.buffer, version)
    res.setHeader('Content-Type', 'application/acad')
    res.setHeader('Content-Disposition', 'attachment; filename="drawing.dwg"')
    res.send(dwg)
  } catch (error) {
    res.status(500).json({ error: String(error instanceof Error ? error.message : error) })
  }
})

const port = process.env.PORT || 8080
app.listen(port, () => {
  console.log(`aquascheme-converter listening on ${port}`)
})
