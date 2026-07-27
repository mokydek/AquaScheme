import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (name === 'node_modules' || name === 'dist') return []
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx|js|json)$/.test(name) ? [path] : []
  })
}

describe('confidential benchmark isolation', () => {
  it('keeps acceptance-object datasets out of tracked product source', () => {
    expect(existsSync(join(root, 'frontend', 'src', 'shared', 'realProjectData.json'))).toBe(false)
    const publicSources = [join(root, 'engine', 'src'), join(root, 'frontend', 'src'), join(root, 'scripts')]
      .flatMap(sourceFiles)
      .filter((path) => !path.endsWith('confidentiality.test.ts'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(publicSources).not.toContain('realProjectData')
    expect(publicSources).not.toContain('demo-derived')
  })
})
