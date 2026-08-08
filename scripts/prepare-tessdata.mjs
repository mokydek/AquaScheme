/**
 * Кладёт языковые данные OCR в assets приложения.
 *
 * Требование — раздавать их СВОИМ хостингом: tesseract.js по умолчанию тянет
 * traineddata со стороннего CDN на лету, а это значит, что распознавание
 * документов проекта зависит от чужого сервера и уходит в чужие логи запросом
 * за словарём.
 *
 * Файл не кладётся в git: 2,7 МБ двоичных данных в истории репозитория ничем
 * не оправданы, они воспроизводимо берутся из пакета. Скрипт вызывается перед
 * dev и build.
 *
 * Берётся `4.0.0_best_int` (2,7 МБ), а не `4.0.0` (8,6 МБ): целочисленный
 * вариант «best» втрое легче при сопоставимом качестве на печатном тексте, а
 * ТУ и ТЗ — печатные документы, а не рукописи.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET_DIR = join(ROOT, 'frontend', 'public', 'tessdata')

const languages = [
  { code: 'rus', from: join(ROOT, 'node_modules', '@tesseract.js-data', 'rus', '4.0.0_best_int', 'rus.traineddata.gz') },
]

mkdirSync(TARGET_DIR, { recursive: true })
let copied = 0
for (const { code, from } of languages) {
  if (!existsSync(from)) {
    console.log(`ПРОПУЩЕНО: нет ${from}. Распознавание сканов на ${code} будет недоступно.`)
    continue
  }
  const to = join(TARGET_DIR, `${code}.traineddata.gz`)
  copyFileSync(from, to)
  copied += 1
  console.log(`${code}: ${(statSync(to).size / 1024 / 1024).toFixed(1)} МБ → frontend/public/tessdata/`)
}
if (copied === 0) console.log('Языковых данных нет: OCR покажет честное сообщение, а не молча промолчит.')
