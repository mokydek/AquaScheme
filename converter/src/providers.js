import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * DXF -> DWG conversion providers behind one interface, chosen by config so
 * the provider can change without touching the endpoint (requirements
 * update 1, change 7). Primary: ODA File Converter (free, Open Design
 * Alliance). Fallback: CloudConvert API.
 *
 * @typedef {{ convert(dxf: Buffer, version: string): Promise<Buffer>, name: string }} ConvertProvider
 */

/** @returns {ConvertProvider} */
export function odaProvider() {
  const bin = process.env.ODA_CONVERTER_PATH || 'ODAFileConverter'
  return {
    name: 'oda',
    async convert(dxf, version) {
      const work = await mkdtemp(join(tmpdir(), 'aqua-'))
      const inDir = join(work, 'in')
      const outDir = join(work, 'out')
      await writeFile(join(work, 'in.dxf'), dxf).catch(() => {})
      // ODA expects input/output directories.
      await Promise.all([
        writeFile(join(inDir, 'drawing.dxf'), dxf, { flag: 'w' }).catch(async () => {
          const { mkdir } = await import('node:fs/promises')
          await mkdir(inDir, { recursive: true })
          await mkdir(outDir, { recursive: true })
          await writeFile(join(inDir, 'drawing.dxf'), dxf)
        }),
      ])
      const odaVersion = version === 'ACAD2018' ? 'ACAD2018' : 'ACAD2018'
      // Args: inputDir outputDir version filetype recurse audit filter
      const args = [inDir, outDir, odaVersion, 'DWG', '0', '1', '*.dxf']
      await new Promise((resolve, reject) => {
        const proc = spawn(bin, args, { stdio: 'ignore' })
        proc.on('error', reject)
        proc.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`ODA exit ${code}`))))
      })
      const dwg = await readFile(join(outDir, 'drawing.dwg'))
      await rm(work, { recursive: true, force: true }).catch(() => {})
      return dwg
    },
  }
}

/** @returns {ConvertProvider} */
export function cloudConvertProvider() {
  const apiKey = process.env.CLOUDCONVERT_API_KEY
  return {
    name: 'cloudconvert',
    async convert() {
      if (!apiKey) throw new Error('CLOUDCONVERT_API_KEY is not set')
      // The CloudConvert job flow (import/convert/export) would be implemented
      // here; kept as a declared fallback so the provider can be swapped by
      // config without changing the endpoint.
      throw new Error('cloudconvert provider not implemented in this build')
    },
  }
}

/** @returns {ConvertProvider} */
export function selectProvider() {
  const name = (process.env.CONVERT_PROVIDER || 'oda').toLowerCase()
  return name === 'cloudconvert' ? cloudConvertProvider() : odaProvider()
}
