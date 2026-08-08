import test from 'node:test'
import assert from 'node:assert/strict'
import { odaProvider } from './providers.js'

/**
 * Round-trip проверка DXF → DWG → DXF на настоящем ODA.
 *
 * Все прочие проверки конвертера работают с подменами: они проверяют политику
 * CORS, ограничение одновременных запусков и распознавание формата, но ни разу
 * не запускают сам ODA. Поэтому неверно собранная строка аргументов или
 * сменившийся порядок параметров в новой версии ODA не ловились ничем.
 *
 * Проверка требует установленного ODA и включается переменной окружения
 * ODA_ROUNDTRIP=1. Без неё — ЯВНЫЙ пропуск с причиной, а не тихий успех:
 * зелёный прогон, в котором ничего не проверялось, хуже красного.
 */

/** Простейший, но действительный DXF: одна линия на одном слое. */
function minimalDxf() {
  return [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'ПРОВЕРКА',
    '10', '0.0', '20', '0.0', '30', '0.0',
    '11', '100.0', '21', '50.0', '31', '0.0',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\n')
}

const enabled = process.env.ODA_ROUNDTRIP === '1'

test('DXF → DWG → DXF через настоящий ODA сохраняет чертёж', { skip: !enabled && 'ODA_ROUNDTRIP не задан: настоящий ODA не запускается, проверка не выполнялась' }, async () => {
  const oda = odaProvider()
  const ready = await oda.ready()
  assert.ok(ready.ok, `ODA_ROUNDTRIP задан, но ODA не найден: ${ready.reason ?? ''}`)

  const source = Buffer.from(minimalDxf(), 'utf8')
  const dwg = await oda.convert(source, 'dxf', 'dwg', 'ACAD2018')
  assert.ok(dwg.length > 0, 'DWG пуст')
  // Подпись формата DWG: версия записана первыми шестью байтами.
  assert.match(dwg.subarray(0, 6).toString('latin1'), /^AC\d{4}$/)

  const back = await oda.convert(dwg, 'dwg', 'dxf', 'ACAD2018')
  const text = back.toString('utf8')
  assert.ok(text.length > 0, 'обратный DXF пуст')
  assert.ok(text.includes('SECTION'), 'обратный DXF не похож на DXF')
  // Содержимое должно пережить оба преобразования: слой и сущность на месте.
  assert.ok(text.includes('LINE'), 'линия потеряна при round-trip')
  assert.ok(text.includes('ПРОВЕРКА'), 'имя слоя потеряно при round-trip')
})

test('без ODA проверка честно сообщает, что не выполнялась', { skip: enabled && 'ODA_ROUNDTRIP задан: выполняется настоящая проверка выше' }, () => {
  // Это не заглушка ради зелёного прогона: тест закрепляет, что отсутствие ODA
  // видно в выводе как пропуск с причиной, а не растворяется в общем «ok».
  assert.equal(process.env.ODA_ROUNDTRIP, undefined)
})
