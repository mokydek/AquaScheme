import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countSurveyActValues, extractConditionsFromTu, extractSurveyActFacts } from '@aquascheme/engine'
import { classifyDxfConstraints, parseDxfNetwork } from '@aquascheme/engine/dxfread'

/**
 * ЧТО МАСТЕР КОМПЛЕКТА ДОСТАЁТ ИЗ НАСТОЯЩИХ ДОКУМЕНТОВ ОБЪЕКТА.
 *
 * Прогон, а не проверка поведения: до правки пропа слоты не могли сохранить
 * ничего, и что именно они извлекают из документов Станкевича, никто не видел.
 *
 * Берутся ТЕ ЖЕ извлекатели, которые вызывают слоты: топооснова —
 * `parseDxfNetwork` + `classifyDxfConstraints`, ТУ — `extractConditionsFromTu`,
 * акт обследования — `extractSurveyActFacts`. PDF на этой машине лежат
 * текстовым слоем (`raw/*.txt`), и извлекатель получает ровно то, что дал бы
 * ему `loadPdfTextByPage`: подмены разбора нет, подменён только способ достать
 * текст.
 *
 * Исходники объекта в git не входят: нет их — прогон пропускается.
 */

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..')
const RAW = join(ROOT, 'docs', 'benchmark', 'stankevicha', 'raw')
const DXF = join(ROOT, 'docs', 'benchmark', 'stankevicha', 'dxf', 'topo_stankevicha.dxf')
const XLS = join(ROOT, 'docs', 'benchmark', 'stankevicha', 'src', 'app3_physprops.xls')
const ready = existsSync(DXF) && existsSync(join(RAW, 'pdf_tu.txt'))

/** Текст документа страницами — в том виде, в каком его отдаёт разбор PDF. */
const pages = (name: string) => readFileSync(join(RAW, name), 'utf8')
  .split(/\f/)
  .map((text, index) => ({ page: index + 1, text }))

describe('мастер комплекта на настоящих документах Станкевича', () => {
  it.skipIf(!ready)('извлекает величины из каждого слота', () => {
    const say = (line: string) => console.log(line)

    // Слот 1/2 — топооснова. DWG без конвертера не пройдёт; здесь DXF,
    // сконвертированный локально через ODA.
    const data = parseDxfNetwork(readFileSync(DXF, 'utf8')) as never as {
      segments: unknown[]; layers: unknown[]; textEntities?: unknown[]
    }
    const constraints = classifyDxfConstraints(data as never) as never as Record<string, never[]>
    const roles = Object.values(constraints.roles as unknown as Record<string, string>)
    say(`СЛОТ topobaseFull → topo_stankevicha.dxf → РАЗОБРАНО:`
      + ` слоёв ${data.layers.length}, с назначенной ролью ${roles.filter((r) => r !== 'unknown').length},`
      + ` сегментов ${data.segments.length}, отметок ${(constraints.surveyPoints ?? []).length},`
      + ` подписей ${(data.textEntities ?? []).length}`)

    // Слот 3 — технические условия.
    const tu = extractConditionsFromTu(pages('pdf_tu.txt') as never) as never as {
      diameterMm?: { value: number; quote: string; page: number } | null
      clearanceM?: { value: number; quote: string } | null
      values?: unknown[]
    }
    say(`СЛОТ technicalConditions → ТУ_05-3-2723.pdf → РАЗОБРАНО:`
      + ` диаметр ${tu.diameterMm ? `${tu.diameterMm.value} мм («${tu.diameterMm.quote.trim()}»)` : 'не найден'};`
      + ` просвет ${tu.clearanceM ? `${tu.clearanceM.value} м («${tu.clearanceM.quote.trim()}»)` : 'не найден'}`)

    // Слот 6 — акт технического обследования.
    const act = extractSurveyActFacts(pages('pdf_to.txt') as never)
    say(`СЛОТ surveyReport → ТО_5669_Станкевича.pdf → РАЗОБРАНО:`
      + ` величин ${countSurveyActValues(act)}; ${JSON.stringify(act, (key, value) => (
        key === 'quote' ? undefined : value
      )).slice(0, 600)}`)

    // Слот 7 — приложения геологии: basis-файл, разбора у слота нет.
    say(`СЛОТ geologyAppendices → app3_physprops.xls → СОХРАНЕНО basis-файлом:`
      + ` ${existsSync(XLS) ? `${readFileSync(XLS).length} байт` : 'файла нет'}`)

    expect(data.segments.length).toBeGreaterThan(0)
  })
})
