import { createCloudConvert } from './cloudconvert.js'
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

/**
 * ODA_CONVERTER_PATH may carry a wrapper prefix such as
 * "xvfb-run -a ODAFileConverter", which has to be split into command + args.
 * A local Windows install path is itself full of spaces
 * ("C:\\Program Files\\ODA\\ODAFileConverter 27.1.0\\ODAFileConverter.exe"),
 * so splitting it would look for "C:\\Program". The value is therefore only
 * split when it is not already an executable on its own.
 */
async function resolveOdaCommand() {
  const raw = (process.env.ODA_CONVERTER_PATH || 'ODAFileConverter').trim()
  if (await executableExists(raw)) return { bin: raw, prefixArgs: [] }
  const parts = raw.split(/\s+/).filter(Boolean)
  return { bin: parts[0] ?? raw, prefixArgs: parts.slice(1) }
}

/** @returns {ConvertProvider} */
export function odaProvider() {
  return {
    name: 'oda',
    async ready() {
      const { bin, prefixArgs } = await resolveOdaCommand()
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
        const { bin, prefixArgs } = await resolveOdaCommand()
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
  return createCloudConvert()
}

/** @returns {ConvertProvider} */
export function selectProvider() {
  const name = (process.env.CONVERT_PROVIDER || 'oda').toLowerCase()
  return name === 'cloudconvert' ? cloudConvertProvider() : odaProvider()
}
