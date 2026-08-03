/**
 * Формат исходного файла: сначала по содержимому, и только потом по имени.
 *
 * Имя файла заявлено пользователем, содержимое измеримо. Пока имя шло первым,
 * DWG, названный «.dxf», признавался за DXF, и при to=dxf возвращался как есть
 * — конвертация молча не выполнялась, а разбор падал уже в движке, где причину
 * не видно.
 *
 * DWG с R13 начинается со строки версии AC10xx; двоичный DXF — со своего
 * заголовка. Текстовый DXF опознаваемой подписи не имеет, поэтому для него
 * остаётся имя, а при его отсутствии — предположение.
 *
 * @param {Buffer | Uint8Array} buffer
 * @param {string} name
 * @returns {'dwg' | 'dxf'}
 */
export function sniffFormat(buffer, name) {
  const head = Buffer.from(buffer.subarray(0, 22)).toString('latin1')
  if (head.startsWith('AC10')) return 'dwg'
  if (head.startsWith('AutoCAD Binary DXF')) return 'dxf'
  if (/\.dwg$/i.test(name)) return 'dwg'
  if (/\.dxf$/i.test(name)) return 'dxf'
  return 'dxf'
}
