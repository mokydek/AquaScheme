import { describe, expect, it } from 'vitest'
import { extractSurveyActFacts } from './survey-act'

/*
 * Модуль намеренно НЕ экспортируется из index, пока у него нет пути с экрана:
 * храповик достижимости считает такую возможность недоделанной, и он прав.
 * Экспорт добавится вместе со слотом АТО в мастере.
 */

/**
 * Фрагменты обезличены: формулировки настоящего акта без адресов, названий
 * объекта и организаций. Кернинг сохранён как в текстовом слое PDF — «Ø 45 0
 * мм»: именно так извлечение расставляет пробелы по метрикам шрифта.
 */
const ACT = [{
  page: 11,
  text: `Общая протяженность канализационн ой сети составляет 458,94 м етр а .
Материал канализационн ой сети – керамическая труба. Трубы между собой соединяются
в раструб с зачеканкой мест соединения.
Глубина заложения труб составляет от 3,7 до 5,2 м етров .
1. Керамическая труба Ø 45 0 мм , протяженность ю 458,94 метров, без учет а врезок .
2 . К анализационн ые колодцы из сборных ж/б элементов: диаметром 1,5 метра.
Техническое состояние классифицировано как категория III (ограниченн о работоспособная
конструкция) . К повторному применению не пригодны, и подлежат демонтажу.`,
}]

describe('акт технического обследования', () => {
  const facts = extractSurveyActFacts(ACT)

  it('диаметр читается, хотя число разорвано кернингом', () => {
    // «Ø 45 0 мм» — настоящая форма из текстового слоя акта. Без склейки цифр
    // диаметр не читался бы вовсе.
    expect(facts.diameterMm.map((item) => item.value)).toContain(450)
    expect(facts.diameterMm[0].quote).toContain('45 0')
  })

  it('колодец Ø1,5 м не выдаётся за диаметр трубы', () => {
    // 1,5 метра — это метры, а не миллиметры: в мм-запись он не попадает.
    expect(facts.diameterMm.every((item) => item.value >= 50)).toBe(true)
    expect(facts.diameterMm).not.toContain(1.5)
  })

  it('материал существующей трубы прочитан', () => {
    expect(facts.material.map((item) => item.value)).toContain('керамическая')
  })

  it('протяжённость и глубина заложения прочитаны', () => {
    expect(facts.lengthM.map((item) => item.value)).toContain(458.94)
    expect(facts.depthRangeM[0].value).toEqual({ fromM: 3.7, toM: 5.2 })
  })

  it('категория состояния и приговор акта прочитаны с цитатой', () => {
    expect(facts.category.map((item) => item.value)).toContain('III')
    expect(facts.verdicts).toHaveLength(1)
    expect(facts.verdicts[0].quote).toContain('подлежат демонтажу')
  })

  it('каждая величина несёт цитату и страницу — извлечено не значит подтверждено', () => {
    for (const list of [facts.diameterMm, facts.material, facts.lengthM, facts.category]) {
      for (const item of list) {
        expect(item.quote.length).toBeGreaterThan(10)
        expect(item.page).toBe(11)
      }
    }
  })

  it('шероховатость объявляется отсутствующей, а не подставляется', () => {
    // Слова «шероховатость» в акте нет ни разу: документ о несущей способности.
    expect(facts.missing.join(' ')).toContain('шероховатость')
    expect(facts.missing.join(' ')).toContain('принимает инженер')
  })

  it('пустой акт называет всё ненайденное, а не молчит', () => {
    const empty = extractSurveyActFacts([{ page: 1, text: 'Настоящее заключение выдано по результатам осмотра.' }])
    expect(empty.missing).toContain('диаметр существующей трубы')
    expect(empty.missing).toContain('материал существующей трубы')
    expect(empty.missing).toContain('протяжённость сети')
    expect(empty.missing).toContain('категория технического состояния')
  })
})
