import { spawn } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

/**
 * Drawing conversion providers behind one interface, chosen by config so
 * the provider can change without touching the endpoint (requirements
 * update 1, change 7). Requirements update 3, change 2 makes the service
 * bidirectional: DXF -> DWG for export and DWG -> DXF for import.
 * Primary: ODA File Converter (free, Open Design Alliance).
 * Fallback: CloudConvert API.
 *
 * @typedef {'dxf' | 'dwg'} DrawingFormat
 * @typedef {{ convert(input: Buffer, from: DrawingFormat, to: DrawingFormat, version: string): Promise<Buffer>, ready(): Promise<{ok: boolean, reason?: string}>, name: string }} ConvertProvider
 */

async function executableExists(command) {
  if (isAbsolute(command)) return access(command).then(() => true).catch(() => false)
  for (const directory of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    if (await access(join(directory, command)).then(() => true).catch(() => false)) return true
  }
  return false
}

/** @returns {ConvertProvider} */
export function odaProvider() {
  // ODA_CONVERTER_PATH may carry a wrapper prefix such as
  // "xvfb-run -a ODAFileConverter", so split it into command + args.
  const parts = (process.env.ODA_CONVERTER_PATH || 'ODAFileConverter').split(/\s+/).filter(Boolean)
  const bin = parts[0]
  const prefixArgs = parts.slice(1)
  return {
    name: 'oda',
    async ready() {
      const wrapperOk = await executableExists(bin)
      const converterCommand = prefixArgs.find((part) => /ODAFileConverter$/i.test(part)) ?? bin
      const converterOk = converterCommand === bin ? wrapperOk : await executableExists(converterCommand)
      return wrapperOk && converterOk
        ? { ok: true }
        : { ok: false, reason: `Не найден исполняемый файл ${!wrapperOk ? bin : converterCommand}.` }
    },
    async convert(input, from, to, version) {
      const work = await mkdtemp(join(tmpdir(), 'aqua-'))
      try {
        const ready = await this.ready()
        if (!ready.ok) throw new Error(ready.reason)
        const inDir = join(work, 'in')
        const outDir = join(work, 'out')
        await mkdir(inDir, { recursive: true })
        await mkdir(outDir, { recursive: true })
        await writeFile(join(inDir, `drawing.${from}`), input)
        // ODA args: inputDir outputDir version filetype recurse audit filter
        const args = [...prefixArgs, inDir, outDir, version, to.toUpperCase(), '0', '1', `*.${from}`]
        await new Promise((resolve, reject) => {
          const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
          let output = ''
          const timeout = setTimeout(() => {
            proc.kill('SIGKILL')
            reject(new Error('ODA conversion timed out after 120 seconds'))
          }, 120_000)
          proc.stdout.on('data', (chunk) => { output += chunk.toString() })
          proc.stderr.on('data', (chunk) => { output += chunk.toString() })
          proc.on('error', (error) => { clearTimeout(timeout); reject(error) })
          proc.on('exit', (code) => {
            clearTimeout(timeout)
            if (code === 0) {
              resolve(undefined)
              return
            }
            const details = output.trim().slice(-2000)
            reject(new Error(`ODA exit ${code}${details ? `: ${details}` : ''}`))
          })
        })
        const output = await readFile(join(outDir, `drawing.${to}`))
        if (output.length === 0) throw new Error('ODA produced an empty drawing')
        return output
      } finally {
        await rm(work, { recursive: true, force: true }).catch(() => {})
      }
    },
  }
}

/** @returns {ConvertProvider} */
export function cloudConvertProvider() {
  const apiKey = process.env.CLOUDCONVERT_API_KEY
  return {
    name: 'cloudconvert',
    async ready() {
      return apiKey ? { ok: false, reason: 'CloudConvert provider is declared but not implemented.' } : { ok: false, reason: 'CLOUDCONVERT_API_KEY is not set.' }
    },
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
