import { supabase } from './supabase'
import type { SurveyActRow } from '../app/project/SurveyActValues'

/**
 * Подтверждённые величины акта технического обследования.
 *
 * Модель АТО в проекте уже есть — таблица `survey_acts`; второй такой не
 * заводится. Колонки покрывают материал и диаметр; остальное акт даёт словами
 * (протяжённость, глубина заложения, категория состояния, приговор), и оно
 * ложится в `meta` вместе с ЦИТАТОЙ, СТРАНИЦЕЙ и ИМЕНЕМ ФАЙЛА.
 *
 * Происхождение сохраняется целиком, включая пометку «из ссылки на норматив»:
 * подтверждённая величина не должна становиться неотличимой от описания
 * объекта только потому, что инженер её принял.
 */

/** Одна подтверждённая величина в `meta.confirmed`. */
export interface ConfirmedActValue {
  key: SurveyActRow['key']
  value: SurveyActRow['value']
  quote: string
  page: number | null
  file: string
  fromNormReference: boolean
}

export interface SurveyActMeta {
  fileName?: string
  confirmed?: ConfirmedActValue[]
}

/** Заводит строку АТО под загруженный акт и возвращает её идентификатор. */
export async function createSurveyAct(
  projectId: string,
  scanPath: string,
  fileName: string,
): Promise<string> {
  const meta: SurveyActMeta = { fileName, confirmed: [] }
  const { data, error } = await supabase
    .from('survey_acts')
    .insert({ project_id: projectId, scan_path: scanPath, meta })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

/**
 * Дописывает одну подтверждённую величину.
 *
 * Строка читается перед записью, потому что `meta` — накопительный список, а не
 * одно значение: подтверждения идут поштучно, и перезапись целиком стирала бы
 * предыдущие.
 */
export async function confirmSurveyActValue(
  actId: string,
  confirmed: ConfirmedActValue,
): Promise<void> {
  const read = await supabase.from('survey_acts').select('meta').eq('id', actId).single()
  if (read.error) throw read.error
  const meta = ((read.data as { meta: SurveyActMeta | null }).meta ?? {}) as SurveyActMeta
  const next: SurveyActMeta = {
    ...meta,
    confirmed: [...(meta.confirmed ?? []), confirmed],
  }
  const patch: Record<string, unknown> = { meta: next }
  // Колонки заполняются только там, где они есть. Величина без колонки не
  // теряется — она уже записана в `meta.confirmed` с цитатой.
  if (confirmed.key === 'diameterMm' && typeof confirmed.value === 'number') {
    patch.diameter_mm = confirmed.value
  }
  if (confirmed.key === 'material' && typeof confirmed.value === 'string') {
    patch.material = confirmed.value
  }
  const { error } = await supabase.from('survey_acts').update(patch).eq('id', actId)
  if (error) throw error
}
