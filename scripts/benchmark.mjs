#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

/**
 * Benchmark gate (docs/benchmark/SCORECARD.md). The real-object sources are
 * confidential and live only locally (docs/benchmark/ is gitignored), so this
 * script degrades honestly: without the sources it verifies their presence
 * and exits; with them it runs the comparable checks and prints the weighted
 * score. Dropping the score versus the last recorded iteration is a blocker
 * for merging (see CLAUDE.md).
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BM = join(ROOT, 'docs', 'benchmark')
const requiredGate = process.argv.includes('--required') || process.env.BENCHMARK_REQUIRED === '1'

// Local-only manifests list confidential input paths and their roles. Keeping
// project filenames here would itself leak acceptance-object information.
const manifestPath = join(BM, 'manifest.json')
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const REQUIRED_INPUTS = manifest?.requiredInputs ?? ['manifest.json']

const inputPath = (value) => isAbsolute(value) ? value : join(BM, value)
const missing = REQUIRED_INPUTS.filter((p) => !existsSync(inputPath(p)))
if (missing.length > 0) {
  console.log('benchmark: конфиденциальные исходники недоступны на этой машине:')
  for (const m of missing) console.log('  -', m)
  console.log(requiredGate
    ? 'Обязательный release-gate не пройден.'
    : 'Скрипт пропущен: бенчмарк выполняется локально у владельца данных.')
  process.exit(requiredGate ? 1 : 0)
}

// Generated set to score: docs/benchmark/out/ (exported from the app for the
// benchmark project). Until the first end-to-end run exists, report that
// honestly instead of inventing a score.
const OUT = join(BM, 'out')
if (!existsSync(OUT)) {
  console.log('benchmark: исходники на месте, но сгенерированный комплект docs/benchmark/out/ отсутствует.')
  console.log('Прогоните сквозной сценарий в приложении и выгрузите комплект в docs/benchmark/out/.')
  console.log('SCORE: не считался (итерация 0).')
  process.exit(requiredGate ? 1 : 0)
}

// When both PDFs are declared, visual comparison is a mandatory automatic
// gate. It stays separate from the manually reviewed engineering fields.
if (manifest?.referencePdf && manifest?.generatedPdf) {
  const visual = spawnSync(process.execPath, [join(ROOT, 'scripts', 'visual-benchmark.mjs'), manifestPath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (visual.stdout) process.stdout.write(visual.stdout)
  if (visual.stderr) process.stderr.write(visual.stderr)
  if (visual.status !== 0) process.exit(visual.status ?? 1)
} else {
  console.log('Visual benchmark: referencePdf/generatedPdf не заданы в локальном manifest.json; метрика сходства не считалась.')
  if (requiredGate) process.exit(1)
}

// --- Group 1: composition (25%) — presence of the etalon sheet kinds. ---
const readText = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
const outFiles = (await import('node:fs')).readdirSync(OUT)
const has = (re) => outFiles.some((f) => re.test(f))
const composition = [
  has(/общие[_ ]?данные/i),
  has(/план.*пк/i),
  has(/план.*сет/i),
  has(/профиль.*пк/i),
  has(/ксущ/i),
  has(/колодц/i),
  has(/сетк|решетк/i),
  has(/специфик/i),
]
const g1 = composition.filter(Boolean).length / composition.length

// --- Group 2 (engineering): the auto part comes from out/result.json written
// by the bench run (master-plan diameter comparison, structures present);
// slopes/elevations vs the etalon profiles stay manual. Auto covers 2 of the
// 6 sub-checks of the group; the remaining 4/6 come from manual-checks.json.
let manual = { engineering: null, formatting: null, note: null }
const manualPath = join(BM, 'manual-checks.json')
if (existsSync(manualPath)) manual = { ...manual, ...JSON.parse(readText(manualPath)) }

let engineering = manual.engineering
const resultPath = join(OUT, 'result.json')
if (existsSync(resultPath)) {
  const r = JSON.parse(readText(resultPath))
  const cmp = r.masterPlanComparison
  const diameters = cmp ? cmp.matched / Math.max(cmp.matched + cmp.differing, 1) : null
  const structures =
    [r.liftStationNeeded === true, r.grilles > 0 && r.grilles === r.manholes, r.outletPresent === true]
      .filter(Boolean).length / 3
  const auto = diameters === null ? structures : (diameters + structures) / 2
  console.log(`Инженерия (авто 2/6): диаметры vs генплан ${diameters === null ? '—' : (diameters * 100).toFixed(0) + '%'}, сооружения ${(structures * 100).toFixed(0)}%`)
  if (cmp) for (const row of cmp.rows) {
    if (row.verdict !== 'match') console.log(`  ≠ ${row.id}: план ${row.plan ?? '—'}, у нас ${row.design ?? '—'} (${row.verdict})`)
  }
  engineering = auto * (2 / 6) + (manual.engineering ?? 0) * (4 / 6)
  if (manual.engineering === null || manual.engineering === undefined) {
    console.log('  (4/6 подпунктов группы — уклоны/отметки/расход vs эталон — не заполнены в manual-checks.json, считаются как 0)')
  }
}

const parts = [
  ['Состав', 0.25, g1],
  ['Инженерия', 0.35, engineering],
  ['Оформление', 0.25, manual.formatting],
  ['Записка', 0.15, manual.note],
]
let total = 0
let counted = 0
for (const [name, w, v] of parts) {
  if (v === null || v === undefined) {
    console.log(`${name}: нет данных (заполните manual-checks.json)`)
  } else {
    console.log(`${name}: ${(v * 100).toFixed(1)}% × ${w}`)
    total += v * w
    counted += w
  }
}
if (counted > 0) {
  console.log(`SCORE (по заполненным группам, нормировано): ${((total / counted) * 100).toFixed(2)}%`)
  console.log(`SCORE (абсолютный, незаполненные = 0): ${(total * 100).toFixed(2)}%`)
} else {
  console.log('SCORE: не считался — нет ни одной заполненной группы.')
}
if (requiredGate && (counted < 1 || total < 0.99)) {
  console.error('Release-gate не пройден: все группы должны быть заполнены, абсолютная оценка должна быть не ниже 99%.')
  process.exit(1)
}
