import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'
import {
  classifySheet,
  matchSheets,
  overlapRatio,
  parsePicketMetres,
  parsePicketRange,
  parseReferenceRegister,
} from './sheet-matching.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Самотесты пикетного сопоставления.
 *
 * Три обязательных проверки, ради которых метрика и менялась:
 *  а) одинаковые альбомы дают 100 % и пары один-к-одному;
 *  б) ТОТ ЖЕ чертёж, порезанный на листы иначе, по пикетам не теряет сходства,
 *     а постранично — теряет: это и есть доказательство, что правка честная, а
 *     не поблажка;
 *  в) перестановка страниц местами не меняет пикетный результат.
 *
 * Проверки идут на настоящих PDF, а не на выдуманных числах: синтетический
 * альбом рисует один и тот же участок трассы, разница только в границах листов.
 */

const PT_PER_MM = 72 / 25.4
const MM_PER_METRE = 1000 / 500
/** Поле слева от чертежа: рамка листа, за ней сразу чертёж — как на настоящих. */
const FRAME_MM = 10
const SHEET_HEIGHT_MM = 297

const FONT = join(ROOT, 'node_modules', 'pdfmake', 'fonts', 'Roboto', 'Roboto-Regular.ttf')

const picket = (metres) => {
  const hundreds = Math.floor(metres / 100)
  const rest = Math.round((metres - hundreds * 100) * 100) / 100
  return rest === 0 ? `ПК${hundreds}` : `ПК${hundreds}+${rest}`
}

/**
 * Содержимое трассы: одно и то же для любой нарезки.
 *
 * Каждые 10 м — вертикальный штрих, между ними ломаная, высота которой зависит
 * ТОЛЬКО от абсолютного пикетажа. Поэтому два альбома с разными границами
 * листов показывают буквально один чертёж, и всякая разница в оценке — это
 * разница нарезки, а не содержания.
 */
function drawSheet(document, fromM, toM) {
  const frameX = FRAME_MM * PT_PER_MM
  const x = (metre) => frameX + (metre - fromM) * MM_PER_METRE * PT_PER_MM
  // Название листа стоит ровно на левой кромке рамки: левый край чернил и
  // начало чертежа совпадают, как их и считает бенчмарк.
  document.font(FONT).fontSize(8).fillColor('#000')
    .text(`План К2 ${picket(fromM)} - ${picket(toM)}. М1:500`, frameX, 6, { lineBreak: false })
  document.lineWidth(0.5).strokeColor('#000')
    .rect(frameX, 40, (toM - fromM) * MM_PER_METRE * PT_PER_MM, SHEET_HEIGHT_MM * PT_PER_MM - 80).stroke()
  document.lineWidth(0.6)
  for (let metre = Math.ceil(fromM / 10) * 10; metre <= toM; metre += 10) {
    document.moveTo(x(metre), metre % 100 === 0 ? 120 : 180).lineTo(x(metre), 320).stroke()
  }
  document.lineWidth(1).moveTo(x(fromM), 420)
  for (let metre = fromM; metre <= toM; metre += 5) {
    document.lineTo(x(metre), 420 + 80 * Math.sin(metre / 37) + 40 * Math.cos(metre / 11))
  }
  document.stroke()
}

/**
 * Альбом из планов с заданными границами листов.
 *
 * Ширина страницы, как в настоящем альбоме, зависит от длины участка: 1 м = 2 мм
 * плюс поля. Поэтому разная нарезка даёт и разные форматы страниц — ровно тот
 * случай, ради которого понадобилось общее пикетное окно.
 */
function buildAlbum(path, cuts) {
  const size = ([fromM, toM]) => [
    (FRAME_MM * 2 + (toM - fromM) * MM_PER_METRE) * PT_PER_MM,
    SHEET_HEIGHT_MM * PT_PER_MM,
  ]
  const document = new PDFDocument({ size: size(cuts[0]), margin: 0, autoFirstPage: true })
  const chunks = []
  document.on('data', (chunk) => chunks.push(chunk))
  drawSheet(document, cuts[0][0], cuts[0][1])
  for (const cut of cuts.slice(1)) {
    document.addPage({ size: size(cut), margin: 0 })
    drawSheet(document, cut[0], cut[1])
  }
  return new Promise((resolvePromise, reject) => {
    document.on('end', () => {
      writeFileSync(path, Buffer.concat(chunks))
      resolvePromise(path)
    })
    document.on('error', reject)
    document.end()
  })
}

function runBenchmark(directory, referencePdf, generatedPdf, extraArgs, name) {
  const reportPath = join(directory, `${name}.json`)
  const manifestPath = join(directory, `${name}-manifest.json`)
  writeFileSync(manifestPath, JSON.stringify({
    referencePdf,
    generatedPdf,
    referenceRegister: 'pdf',
    expectedPages: 4,
    visualThreshold: 0.99,
    renderWidthPx: 1000,
    renderHeightPx: 707,
    visualReport: `${name}.json`,
    visualHtmlReport: `${name}.html`,
    visualMarkdownReport: `${name}.md`,
    visualArtifacts: `artifacts-${name}`,
  }), 'utf8')
  const result = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'visual-benchmark.mjs'), manifestPath, '--self-test', ...extraArgs,
  ], { encoding: 'utf8' })
  assert.ok(result.status === 0 || result.status === 1,
    `бенчмарк завершился неожиданно (${result.status}): ${result.stderr}`)
  return JSON.parse(readFileSync(reportPath, 'utf8'))
}

test('пикет читается, а пикет без номера сотни — не читается', () => {
  assert.equal(parsePicketMetres('ПК142+25.83'), 14225.83)
  assert.equal(parsePicketMetres('ПК0'), 0)
  // «ПК+10.54» в ведомости эталона потерял номер сотни. Достроить его можно
  // только догадкой, поэтому диапазон объявляется непрочитанным.
  assert.equal(parsePicketRange('Профиль К2 ПК0 - ПК+10.54'), null)
  assert.deepEqual(parsePicketRange('План К2 ПК6+10.53 - ПК15+71.23. М1:500'),
    { fromM: 610.53, toM: 1571.23 })
})

test('семейство листа определяется одинаково для обеих сторон', () => {
  assert.equal(classifySheet('План К2 ПК0 - ПК6+10.53. М1:500'), 'plan')
  assert.equal(classifySheet('Профиль К2 ПК15+71.23 - ПК25+60.89'), 'profile')
  assert.equal(classifySheet('Профиль на участке Ксущ1 - 111'), 'existingProfile')
  // Эталон называет сводный план «План сетей», мы — «Сводный план сетей»:
  // пикетов в названии нет ни там, ни там, и семейство у обоих одно.
  assert.equal(classifySheet('План сетей К2. М1:500'), 'networkPlan')
  assert.equal(classifySheet('Сводный план сетей К2. М1:500'), 'networkPlan')
  assert.equal(classifySheet('Таблица расхода материалов по сборным канализационным колодцам'), 'materials')
  assert.equal(classifySheet('Защитная сетка для колодцев'), 'grid')
})

/**
 * Ведомость эталона приватная и лежит только локально: `docs/benchmark`
 * закрыт от git. Тест не имеет права падать там, где её нет, — в чистом клоне
 * и в CI он честно пропускается с названной причиной. Падение на отсутствии
 * приватного файла — это не красный тест, а красный шум.
 */
const REGISTER = join(ROOT, 'docs', 'benchmark', 'ETALON-SHEETS.md')
const registerAvailable = existsSync(REGISTER)

test('ведомость эталона разбирается в листы с диапазонами', {
  skip: registerAvailable ? false : 'приватная ведомость эталона недоступна в этой среде',
}, () => {
  const register = parseReferenceRegister(readFileSync(REGISTER, 'utf8'))
  const plans = register.filter((sheet) => sheet.family === 'plan')
  assert.equal(plans.length, 28)
  // Лист 3 ведомости — страница 4 PDF: титул сдвигает нумерацию на единицу.
  assert.equal(plans[0].page, 4)
  assert.deepEqual(plans[0].range, { fromM: 0, toM: 610.53 })
  assert.equal(register.filter((sheet) => sheet.family === 'profile').length, 19)
  // Титул и прилагаемые НК.С стоят в ведомости не таблицей, а фразой о
  // структуре PDF. Без них сопоставление несимметрично: наши титул и
  // спецификация получали ноль, а эталонные страницы в сравнение не входили.
  assert.deepEqual(register.filter((sheet) => sheet.family === 'title').map((sheet) => sheet.page), [1])
  assert.deepEqual(register.filter((sheet) => sheet.family === 'spec').map((sheet) => sheet.page), [59, 60, 61])
  assert.equal(register.length, 61)
})

test('ведомость рабочих чертежей не принимается за титульный лист', () => {
  // Внутри ведомости есть строка «Титульный лист рабочего комплекта», и разбор
  // по всему тексту страницы уводил её в семейство титула.
  assert.equal(classifySheet('Ведомость рабочих чертежей Листы Раздел Количество PDF 1 Титульный лист рабочего комплекта 1 MAIN/1'), 'general')
  assert.equal(classifySheet('РАБОЧАЯ ДОКУМЕНТАЦИЯ Водосбросной коллектор до р. Есиль'), 'title')
})

test('сопоставление симметрично и не переиспользует эталонный лист', () => {
  const ours = [
    { page: 1, family: 'plan', title: 'A', range: { fromM: 0, toM: 100 } },
    { page: 2, family: 'plan', title: 'B', range: { fromM: 100, toM: 200 } },
  ]
  const theirs = [
    { page: 1, family: 'plan', title: 'X', range: { fromM: 10, toM: 110 } },
    { page: 2, family: 'plan', title: 'Y', range: { fromM: 110, toM: 210 } },
  ]
  const forward = matchSheets(ours, theirs)
  const backward = matchSheets(theirs, ours)
  assert.equal(forward.pairs.length, 2)
  assert.equal(backward.pairs.length, 2)
  assert.deepEqual(forward.pairs.map((pair) => [pair.generatedPage, pair.referencePage]), [[1, 1], [2, 2]])
  assert.deepEqual(backward.pairs.map((pair) => [pair.generatedPage, pair.referencePage]), [[1, 1], [2, 2]])
  assert.ok(Math.abs(overlapRatio({ fromM: 0, toM: 100 }, { fromM: 10, toM: 110 }) - 90 / 110) < 1e-9)
})

test('лист без пары назван и наказан, а не выброшен', () => {
  const ours = [{ page: 1, family: 'plan', title: 'A', range: { fromM: 0, toM: 100 } }]
  const theirs = [{ page: 1, family: 'plan', title: 'X', range: { fromM: 900, toM: 1000 } }]
  const matched = matchSheets(ours, theirs)
  assert.equal(matched.pairs.length, 0)
  assert.equal(matched.unmatchedGenerated.length, 1)
  assert.equal(matched.unmatchedReference.length, 1)
  assert.match(matched.unmatchedGenerated[0].reason, /ниже порога/)
})

test('самотесты бенчмарка: одинаковое, сдвиг нарезки, перестановка', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'aquascheme-picket-'))
  mkdirSync(directory, { recursive: true })
  const cutsA = [[0, 250], [250, 500], [500, 750], [750, 1000]]
  const cutsB = [[0, 300], [300, 550], [550, 800], [800, 1000]]
  const albumA = await buildAlbum(join(directory, 'a.pdf'), cutsA)
  const albumB = await buildAlbum(join(directory, 'b.pdf'), cutsB)
  const albumBShuffled = await buildAlbum(join(directory, 'b-shuffled.pdf'), [cutsB[2], cutsB[0], cutsB[3], cutsB[1]])

  await t.test('а) одинаковые альбомы: 100 % и пары один-к-одному', () => {
    const report = runBenchmark(directory, albumA, albumA, [], 'same')
    assert.equal(report.mode, 'by-picket')
    assert.equal(report.matching.pairs.length, 4)
    assert.equal(report.matching.unmatchedGenerated.length, 0)
    assert.equal(report.matching.unmatchedReference.length, 0)
    for (const pair of report.matching.pairs) {
      assert.equal(pair.generatedPage, pair.referencePage)
      assert.ok(pair.overlap > 0.999, `перекрытие пары ${pair.generatedPage}: ${pair.overlap}`)
    }
    assert.ok(report.summary.average.combined > 0.999,
      `одинаковые альбомы должны дать 100 %, получено ${report.summary.average.combined}`)
  })

  await t.test('б) сдвиг нарезки: пикетный режим не теряет, постраничный теряет', () => {
    const byPicket = runBenchmark(directory, albumB, albumA, [], 'shifted-picket')
    const byPage = runBenchmark(directory, albumB, albumA, ['--by-page'], 'shifted-page')
    assert.equal(byPicket.matching.pairs.length, 4)
    console.log(`  сдвиг нарезки: по пикетам combined ${(byPicket.summary.average.combined * 100).toFixed(3)} %,`
      + ` ink ${(byPicket.summary.average.inkIoU * 100).toFixed(3)} %;`
      + ` постранично combined ${(byPage.summary.average.combined * 100).toFixed(3)} %,`
      + ` ink ${(byPage.summary.average.inkIoU * 100).toFixed(3)} %`)
    // Чертёж один и тот же — по содержанию альбомы обязаны сойтись почти
    // полностью, несмотря на другие границы листов.
    assert.ok(byPicket.summary.average.inkIoU > 0.8,
      `пикетный ink должен остаться высоким, получено ${byPicket.summary.average.inkIoU}`)
    assert.ok(byPicket.summary.average.combined > byPage.summary.average.combined + 0.1,
      `пикетный ${byPicket.summary.average.combined} должен заметно превзойти постраничный ${byPage.summary.average.combined}`)
    assert.ok(byPage.summary.average.inkIoU < byPicket.summary.average.inkIoU,
      'постраничное сравнение обязано пострадать от сдвига нарезки')
  })

  await t.test('в) перестановка страниц не меняет пикетный результат', () => {
    const straight = runBenchmark(directory, albumB, albumA, [], 'order-straight')
    const shuffled = runBenchmark(directory, albumBShuffled, albumA, [], 'order-shuffled')
    assert.equal(straight.matching.pairs.length, shuffled.matching.pairs.length)
    const key = (report) => report.matching.pairs
      .map((pair) => `${pair.generatedPage}:${pair.referenceRange.fromM}-${pair.referenceRange.toM}`)
      .sort().join('|')
    // Сопоставляются одни и те же участки трассы: номер страницы эталона у
    // переставленного альбома другой, а диапазон — тот же.
    assert.equal(key(straight), key(shuffled))
    assert.ok(Math.abs(straight.summary.average.combined - shuffled.summary.average.combined) < 1e-6,
      `перестановка изменила результат: ${straight.summary.average.combined} против ${shuffled.summary.average.combined}`)
  })
})
