#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

const REQUIRED_INPUTS = [
  'input/tz-vodosbros-os-34-33-38.pdf',
  'input/apz-ispravlenny-2210.pdf',
  'input/pdp-vodosbrosnoy-2025.pdf',
  'input/akt-vybora-sbrosnoy-2025.pdf',
  'input/shema-lk-genplan-diametry.pdf',
  'input/topo-vodosbrosnoy-1510.pdf',
  'input/vert-planirovka-1510.pdf',
  'input/geologiya-arh-17-08-25.pdf',
  'input/too-akva-bolshoy-taldykol.dwg',
  'etalon/tom2-albom1-nk-izm-od-020226.pdf',
]

const missing = REQUIRED_INPUTS.filter((p) => !existsSync(join(BM, p)))
if (missing.length > 0) {
  console.log('benchmark: конфиденциальные исходники недоступны на этой машине:')
  for (const m of missing) console.log('  -', m)
  console.log('Скрипт пропущен (не ошибка): бенчмарк выполняется локально у владельца данных.')
  process.exit(0)
}

// Generated set to score: docs/benchmark/out/ (exported from the app for the
// benchmark project). Until the first end-to-end run exists, report that
// honestly instead of inventing a score.
const OUT = join(BM, 'out')
if (!existsSync(OUT)) {
  console.log('benchmark: исходники на месте, но сгенерированный комплект docs/benchmark/out/ отсутствует.')
  console.log('Прогоните сквозной сценарий в приложении и выгрузите комплект в docs/benchmark/out/.')
  console.log('SCORE: не считался (итерация 0).')
  process.exit(0)
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

// --- Groups 2-4: engineering/formatting/note need the parsed etalon model;
// manual checks live in manual-checks.json (0..1 each). ---
let manual = { engineering: null, formatting: null, note: null }
const manualPath = join(BM, 'manual-checks.json')
if (existsSync(manualPath)) manual = { ...manual, ...JSON.parse(readText(manualPath)) }

const parts = [
  ['Состав', 0.25, g1],
  ['Инженерия', 0.35, manual.engineering],
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
