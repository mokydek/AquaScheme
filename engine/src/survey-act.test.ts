import { describe, expect, it } from 'vitest'
import { countSurveyActValues, extractSurveyActFacts } from './survey-act'

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

  it('материал из описания объекта — кандидат, материал из ссылки на норму — помеченный', () => {
    // Обе формулировки взяты из настоящего акта. Первая описывает трубу
    // объекта, вторая и третья ссылаются на норматив: асбоцемент там — предмет
    // нормы, а труба по описанию керамическая. Кандидат не выбрасывается, иначе
    // противоречие акта осталось бы невидимым; он помечается.
    const mixed = extractSurveyActFacts([{
      page: 9,
      text: `Материал канализационной сети – керамическая труба.
Для керамических, асбоцементных трубопроводов – в соответствии со СН РК 1.04-26-2022 составляет 30 лет.
Трубы эксплуатируются более 70 лет, что превышает нормативный срок службы асбоцементных трубопроводов.`,
    }])
    const own = mixed.material.filter((item) => !item.fromNormReference)
    expect(own.map((item) => item.value)).toEqual(['керамическая'])
    expect(own[0].quote).toContain('Материал канализационной сети')

    const cited = mixed.material.filter((item) => item.fromNormReference)
    expect(cited.map((item) => item.value)).toContain('асбестоцементная')
    // Ссылка на норму называет ДВА материала — берутся оба, а не первый по
    // порядку списка.
    expect(cited.filter((item) => /СН РК/.test(item.quote)).map((item) => item.value))
      .toEqual(['керамическая', 'асбестоцементная'])
  })

  it('материал только из ссылок на нормы называется ненайденным по объекту', () => {
    const cited = extractSurveyActFacts([{
      page: 9,
      text: 'Для керамических, асбоцементных трубопроводов – в соответствии со СН РК 1.04-26-2022 составляет 30 лет.',
    }])
    expect(cited.material.every((item) => item.fromNormReference)).toBe(true)
    expect(cited.missing.join(' ')).toContain('только в ссылках на нормативы')
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

  it('перенос строки внутри предложения не разрывает величину', () => {
    // Так текстовый слой настоящего акта переносит эту фразу. Пока границей
    // предложения считался перевод строки, категория не находилась вовсе, а
    // приговор доходил обрубком «подлежат демонтажу».
    const wrapped = extractSurveyActFacts([{
      page: 11,
      text: `Техническое состояние железобетонных конструкций согласно приложению
Ж
(табл.
Ж.2),
классифицировано
как
категория
III
(ограниченно
работоспособная конструкция). К повторному применению не пригодны, и
подлежат демонтажу.`,
    }])
    expect(wrapped.category.map((item) => item.value)).toEqual(['III'])
    expect(wrapped.verdicts[0].quote).toBe('К повторному применению не пригодны, и подлежат демонтажу.')
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

  it('счётчик слота считает кандидатов, а не подтверждённые величины', () => {
    expect(countSurveyActValues(facts)).toBe(
      facts.diameterMm.length + facts.material.length + facts.lengthM.length
      + facts.depthRangeM.length + facts.category.length + facts.verdicts.length,
    )
    expect(countSurveyActValues(facts)).toBeGreaterThan(0)
    expect(countSurveyActValues(extractSurveyActFacts([{ page: 1, text: 'Осмотр проведён.' }]))).toBe(0)
  })
})
