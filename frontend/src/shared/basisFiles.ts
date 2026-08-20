import { loadDatasetContent, saveDataset } from './datasets'
import { SUPABASE_ANON_KEY, SUPABASE_REST_URL, supabase } from './supabase'

/**
 * Идентификаторы, под которыми документ проекта может лечь в набор basis.
 *
 * ЗЕРКАЛО БЕЛОГО СПИСКА ИЗ БАЗЫ. Список живёт в `basis_item_ids()` (миграция
 * 0023) и повторён здесь, потому что клиенту он тоже нужен: слот,
 * пишущий под незнакомым базе ключом, получал 22023, уходил на запасной путь и
 * терял файлы молча. Расхождение двух списков ловит `basisFiles.test.ts`,
 * читающий массив прямо из SQL, — а не пользователь.
 *
 * Первые девять — исходно-разрешительная документация. Остальные — документы
 * объекта, которые в этот перечень не входят и входить не будут, но хранятся
 * так же: с проверкой и атомарно. У каждого документа СВОЙ идентификатор: две
 * формы топоосновы делили один, и восемь загруженных файлов давали семь ключей
 * при отчёте «Готово 8 из 8».
 */
export const BASIS_ITEM_IDS = [
  'assignment', 'apz', 'pdp', 'route_act', 'genplan_scheme',
  'topo', 'geology', 'vertical', 'tu',
  'survey_act', 'geology_appendices', 'route_scheme',
  'topo_survey',
] as const

export type BasisItemId = (typeof BASIS_ITEM_IDS)[number]

type JsonObject = Record<string, unknown>

function jsonObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function isMissingBasisFileRpc(error: unknown): boolean {
  const candidate = jsonObject(error)
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  if (code === 'PGRST202' || code === '42883') return true

  const text = [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return text.includes('save_basis_file') && (
    text.includes('could not find')
    || text.includes('does not exist')
    || text.includes('schema cache')
  )
}

let basisFileRpcCapability: Promise<boolean> | null = null

async function probeBasisFileRpc(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    if (error || !accessToken) return false

    const response = await fetch(SUPABASE_REST_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/openapi+json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!response.ok) return false
    const specification = jsonObject(await response.json())
    const paths = jsonObject(specification.paths)
    return Object.prototype.hasOwnProperty.call(paths, '/rpc/save_basis_file')
  } catch {
    // Capability discovery must never turn a compatible legacy deployment
    // into a save failure. The ordinary dataset path remains available.
    return false
  }
}

function hasBasisFileRpc(): Promise<boolean> {
  basisFileRpcCapability ??= probeBasisFileRpc()
  return basisFileRpcCapability
}

/**
 * Очередь записей: следующая начинается после того, как предыдущая легла.
 *
 * ЭТО И БЫЛА ПОТЕРЯ. Шесть загрузок мастера шли подряд, каждая писала набор
 * целиком из обрывка, переданного вызывающим, и затирала предыдущую. В базе
 * оставался последний файл, а мастер отчитывался «Готово 6 из 8, с ошибкой 0».
 *
 * Взяты ОБА средства сразу, потому что они закрывают разные дыры. Перечитка
 * снимает устаревание снимка (браузер не знает, что записали до него), очередь
 * снимает гонку внутри одной страницы (перечитка без неё читает базу до того,
 * как соседняя запись туда дошла). Порознь каждое оставляет свою половину
 * потери, и обе половины наблюдались.
 */
let basisWriteQueue: Promise<unknown> = Promise.resolve()

function queueBasisWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = basisWriteQueue.then(task, task)
  // Очередь не должна вставать из-за неудачи одной записи: следующая пробует.
  basisWriteQueue = next.then(() => undefined, () => undefined)
  return next
}

async function saveBasisFileLegacy(
  projectId: string,
  itemId: BasisItemId,
  fileName: string,
  base: JsonObject,
  extracted: JsonObject | undefined,
): Promise<void> {
  await queueBasisWrite(async () => {
    // Записанное в базе главнее снимка из браузера — как и в атомарном пути.
    const stored = jsonObject(await loadDatasetContent(projectId, 'basis'))
    const files = { ...jsonObject(base.files), ...jsonObject(stored.files) }
    // Разбор одного слота не стирает разбор другого; вызов без разбора не
    // стирает ничей: сохранить имя файла — не заявить, что величин больше нет.
    const parsed = { ...jsonObject(base.extracted), ...jsonObject(stored.extracted) }
    const merged = extracted === undefined ? parsed : { ...parsed, [itemId]: extracted }
    await saveDataset(projectId, 'basis', {
      ...base,
      ...stored,
      files: { ...files, [itemId]: fileName },
      // Пустой ключ не заводится: набор без единого разбора так и выглядит.
      ...(Object.keys(merged).length > 0 ? { extracted: merged } : {}),
    })
  })
}

/**
 * Merge one basis-document file name without overwriting concurrently saved
 * siblings. Migration 0015 performs the merge atomically in PostgreSQL. The
 * legacy branch is deliberately limited to a missing RPC/schema-cache entry;
 * permissions, validation and runtime errors must remain visible.
 *
 * `extracted` — то, что слот вычитал из документа: величины с цитатами, а не
 * подтверждённые инженером значения. Оно ложится в отдельное пространство
 * `extracted[itemId]` и перезаписывается вместе с именем файла, потому что
 * относится к тому же документу. Не передан — прежний разбор остаётся.
 */
export async function saveBasisFile(
  projectId: string,
  itemId: BasisItemId,
  fileName: string,
  baseContent: unknown,
  extracted?: JsonObject,
): Promise<void> {
  const base = jsonObject(baseContent)
  if (!await hasBasisFileRpc()) {
    await saveBasisFileLegacy(projectId, itemId, fileName, base, extracted)
    return
  }

  const { error } = await supabase.rpc('save_basis_file', {
    p_project_id: projectId,
    p_item_id: itemId,
    p_file_name: fileName,
    p_base_content: base,
    p_extracted: extracted ?? null,
  })
  if (!error) return
  if (!isMissingBasisFileRpc(error)) throw error
  // OpenAPI can briefly advertise a function that PostgREST has already lost
  // from its schema cache. Remember that mismatch for the rest of this page so
  // later uploads skip the same noisy 400/404 and use the compatible path.
  basisFileRpcCapability = Promise.resolve(false)
  await saveBasisFileLegacy(projectId, itemId, fileName, base, extracted)
}
