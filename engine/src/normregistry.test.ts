import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  getClause,
  justified,
  NORM_DOCUMENTS,
  NORM_FILES_PRESENT,
  NORM_REGISTRY,
  isCompleteConfirmation,
  unverifiedClauses,
} from './normregistry'

describe('norm registry', () => {
  it('every clause references a known document', () => {
    const codes = new Set(NORM_DOCUMENTS.map((d) => d.code))
    for (const clause of NORM_REGISTRY) {
      expect(codes.has(clause.documentCode)).toBe(true)
    }
  })

  it('an entry is verified only with a transcription source (file + PDF page)', () => {
    for (const clause of NORM_REGISTRY) {
      if (clause.status === 'verified') {
        expect(clause.sourceFile, clause.id).toMatch(/^docs\/norms\/.+\.pdf$/)
        expect(clause.sourcePage, clause.id).toBeGreaterThan(0)
        expect(clause.clause, clause.id).not.toBeNull()
      }
    }
    // Пока в docs/norms нет ни одного PDF, подтверждённых пунктов нет тоже, и
    // на сверку инженеру уходят все. Строгое «меньше, чем всего» стояло здесь
    // раньше и проходило только потому, что статус объявлялся, а не считался.
    expect(unverifiedClauses().length).toBeLessThanOrEqual(NORM_REGISTRY.length)
  })

  it('sewer clauses carry the values transcribed from СН РК 4.01-03-2013*', () => {
    // Проверяется запись о переписывании, а не статус: статус зависит от того,
    // лежит ли документ в репозитории, и подтверждать текст сам по себе не может.
    expect(getClause('sewer.minDiameter')?.sourceFile).toContain('sn-rk-4-01-03-2013')
    expect(getClause('sewer.minDiameter')?.sourcePage).toBe(39)
    expect(getClause('sewer.slope.min')?.valueText).toContain('0.008')
    expect(getClause('drainage.equalsWater')?.clause).toBe('5.5.1')
  })

  it('НБ3: GOST drawing/spec clauses and RK code clauses carry pages', () => {
    for (const id of ['spec.form', 'drawing.generalData', 'drawing.plan', 'drawing.profile', 'drawing.stamp']) {
      expect(getClause(id)?.sourcePage, id).toBeGreaterThan(0)
      expect(getClause(id)?.sourceFile, id).toMatch(/gost/)
    }
    expect(getClause('spec.form')?.documentCode).toBe('ГОСТ 21.110-2013')
    expect(getClause('water.protectionZone')?.documentCode).toBe('Водный кодекс РК')
    expect(getClause('water.sanitaryZone')?.appliesSystem).toEqual(['water'])
    expect(getClause('eco.wastewaterDischarge')?.appliesSystem).toEqual(['sewer', 'storm'])
    expect(getClause('construction.responsibility')?.sourcePage).toBe(176)
  })

  it('clause ids are unique and resolvable', () => {
    const ids = NORM_REGISTRY.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(getClause('freeHead.base')?.valueText).toBe('10')
    expect(getClause('nonexistent')).toBeUndefined()
  })

  it('a null clause marks TODO_NORM_REF (unknown exact number)', () => {
    expect(getClause('demand.perCapita')?.clause).toBeNull()
    expect(getClause('freeHead.base')?.clause).toBe('2.26')
  })

  it('justified() wraps a value with its basis', () => {
    const j = justified(10, ['freeHead.base'], 'normative')
    expect(j.value).toBe(10)
    expect(j.refs).toEqual(['freeHead.base'])
    expect(j.basis).toBe('normative')
    const eco = justified('ПЭ100', [], 'economic', 'норматив выбор не регламентирует')
    expect(eco.basis).toBe('economic')
    expect(eco.note).toContain('не регламентирует')
  })
})

describe('сверка пункта инженером проекта', () => {
  const target = unverifiedClauses()[0]
  const full = {
    clauseId: target.id,
    edition: 'СН РК 4.01-03-2013*, изм. от 07.11.2019',
    clause: '5.4.7',
    page: 61,
    confirmedBy: 'ГИП Иванов',
  }

  it('полная сверка снимает пункт с неподтверждённых', () => {
    const before = unverifiedClauses().length
    const after = unverifiedClauses([full]).length
    expect(after).toBe(before - 1)
    expect(unverifiedClauses([full]).some((c) => c.id === target.id)).toBe(false)
  })

  it('реестр при этом не меняется: сверка живёт в проекте', () => {
    unverifiedClauses([full])
    expect(unverifiedClauses().some((c) => c.id === target.id)).toBe(true)
  })

  it('неполная запись подтверждением не считается', () => {
    for (const gap of [
      { edition: '' },
      { edition: '   ' },
      { clause: '' },
      { page: 0 },
      { page: Number.NaN },
      { confirmedBy: '' },
    ]) {
      const partial = { ...full, ...gap }
      expect(isCompleteConfirmation(partial)).toBe(false)
      expect(unverifiedClauses([partial]).some((c) => c.id === target.id)).toBe(true)
    }
  })

  it('сверка чужого пункта ничего не снимает', () => {
    const before = unverifiedClauses().length
    expect(unverifiedClauses([{ ...full, clauseId: 'нет.такого.пункта' }]).length).toBe(before)
  })

  it('подтверждённый в реестре пункт повторной сверки не требует', () => {
    // Список неподтверждённых и так его не содержит, а лишняя запись не должна
    // ни на что влиять. Пока ни одного PDF в репозитории нет, подтверждённых
    // пунктов не остаётся вовсе — тогда проверять нечего, и это правильный
    // исход, а не пропуск: см. соседний блок про сторожа документов.
    const verified = NORM_REGISTRY.find((c) => c.status === 'verified')
    if (!verified) {
      expect(NORM_FILES_PRESENT.size).toBe(0)
      return
    }
    const before = unverifiedClauses().length
    expect(unverifiedClauses([{ ...full, clauseId: verified.id }]).length).toBe(before)
  })
})

describe('подтверждать нечем — значит не подтверждено', () => {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
  const onDisk = (repoPath: string) => existsSync(join(root, ...repoPath.split('/')))

  it('каждый файл из списка присутствующих действительно лежит на диске', () => {
    for (const file of NORM_FILES_PRESENT) {
      expect(onDisk(file), file).toBe(true)
    }
  })

  it('каждый PDF с диска перечислен в списке присутствующих', () => {
    const dir = join(root, 'docs', 'norms')
    const pdfs = existsSync(dir) ? readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.pdf')) : []
    for (const name of pdfs) {
      expect(NORM_FILES_PRESENT.has(`docs/norms/${name}`), name).toBe(true)
    }
  })

  it('пункт не может быть подтверждённым без документа на диске', () => {
    // Сторож, которого не было: прежний тест сверял только ФОРМУ пути
    // (`/^docs\/norms\/.+\.pdf$/`) и пропускал 47 пунктов, ссылавшихся на
    // файлы, которых в репозитории не было никогда.
    for (const clause of NORM_REGISTRY) {
      if (clause.status !== 'verified') continue
      expect(clause.sourceFile, clause.id).toMatch(/^docs\/norms\/.+\.pdf$/)
      expect(onDisk(clause.sourceFile!), clause.id).toBe(true)
      expect(clause.sourcePage, clause.id).toBeGreaterThan(0)
    }
  })

  it('документ не может быть подтверждённым без файла на диске', () => {
    for (const document of NORM_DOCUMENTS) {
      if (document.status !== 'verified') continue
      expect(document.sourceFile, document.code).toBeTruthy()
      expect(onDisk(document.sourceFile!), document.code).toBe(true)
    }
  })

  it('запись о том, откуда текст переписан, при понижении статуса не теряется', () => {
    const sewerMinDiameter = NORM_REGISTRY.find((clause) => clause.id === 'sewer.minDiameter')!
    expect(sewerMinDiameter.sourceFile).toBe('docs/norms/sn-rk-4-01-03-2013-vodootvedenie.pdf')
    expect(sewerMinDiameter.sourcePage).toBe(39)
    expect(sewerMinDiameter.note).toContain('сверить пункт нечем')
  })

  it('все пункты доходят до инженера на сверку, пока документов нет', () => {
    expect(unverifiedClauses().length).toBe(NORM_REGISTRY.length)
  })
})
