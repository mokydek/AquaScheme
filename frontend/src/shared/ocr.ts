/**
 * Распознавание сканов — локально, в браузере.
 *
 * Реальные ТУ и ТЗ приёмочного объекта приходят сканами и фотографиями: в
 * `pdf_tu.txt` 135 байт, в `pdf_tz.txt` 162 — текстового слоя там нет вовсе, и
 * весь разбор документов на них не срабатывал.
 *
 * ФАЙЛЫ НЕ ПОКИДАЮТ БРАУЗЕР. Распознавание идёт в WASM у пользователя.
 * Языковые данные раздаются своим хостингом из `/tessdata` — tesseract.js по
 * умолчанию тянет их со стороннего CDN, а это значит, что документы проекта
 * зависят от чужого сервера и запрос за словарём уходит в чужие логи.
 *
 * РАСПОЗНАННОЕ — ХУДШИЙ ИСТОЧНИК ИЗ ВСЕХ. OCR путает 0 и О, 4 и Ч; «450» с
 * плохого скана становится «45О». Поэтому здесь возвращается не только текст,
 * но и уверенность ПОСТРОЧНО: величина, прочитанная из неуверенной строки,
 * обязана дойти до инженера с предупреждением, а не молча встать в расчёт.
 */

export interface OcrLine {
  text: string
  /** Уверенность распознавания строки, 0…100. */
  confidence: number
}

export interface OcrPage {
  /** Номер страницы, с 1. */
  page: number
  text: string
  lines: OcrLine[]
  /** Средняя уверенность по странице, 0…100. */
  confidence: number
}

export interface OcrProgress {
  /** Страница, которая обрабатывается сейчас. */
  page: number
  totalPages: number
  /** 0…1 внутри страницы. */
  ratio: number
  stage: string
}

/**
 * Ниже этой уверенности строка считается сомнительной.
 *
 * Не подгонка: tesseract выдаёт около 90 и выше на чистом печатном тексте и
 * проваливается к 60…70 там, где скан замят или буквы слиплись. Порог
 * разделяет эти два случая с запасом, а сама величина показывается инженеру —
 * решает он.
 */
export const LOW_CONFIDENCE = 80

/** Разрешение рендера страницы PDF перед распознаванием. */
const RENDER_SCALE = 2.4

/** Языковые данные лежат в assets приложения, а не на чужом CDN. */
const LANG_PATH = '/tessdata'

async function pdfPagesToBitmaps(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  const canvases: HTMLCanvasElement[] = []
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      const viewport = page.getViewport({ scale: RENDER_SCALE })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Холст недоступен: страницу не отрисовать.')
      await page.render({ canvasContext: context, viewport }).promise
      canvases.push(canvas)
    }
  } finally {
    await doc.destroy()
  }
  return canvases
}

/**
 * Распознаёт скан-PDF или изображение.
 *
 * Языковые данные грузятся при ПЕРВОМ вызове, а не при старте приложения:
 * 2,6 МБ в начальной загрузке платил бы каждый, включая тех, кто сканов не
 * открывает вовсе.
 */
export async function recognizeScan(
  file: File,
  onProgress?: (progress: OcrProgress) => void,
): Promise<OcrPage[]> {
  const { createWorker } = await import('tesseract.js')
  const images: Array<HTMLCanvasElement | File> = /\.pdf$/i.test(file.name)
    ? await pdfPagesToBitmaps(file)
    : [file]

  const worker = await createWorker('rus', 1, {
    langPath: LANG_PATH,
    // Данные приходят сжатыми: так их и кладёт prepare-tessdata.
    gzip: true,
  })
  try {
    const pages: OcrPage[] = []
    for (const [index, image] of images.entries()) {
      onProgress?.({ page: index + 1, totalPages: images.length, ratio: 0, stage: 'recognizing' })
      const { data } = await worker.recognize(image)
      const lines: OcrLine[] = (data.blocks ?? [])
        .flatMap((block) => block.paragraphs ?? [])
        .flatMap((paragraph) => paragraph.lines ?? [])
        .map((line) => ({ text: line.text.trim(), confidence: line.confidence }))
        .filter((line) => line.text !== '')
      pages.push({
        page: index + 1,
        text: data.text,
        lines,
        confidence: lines.length > 0
          ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length
          : 0,
      })
      onProgress?.({ page: index + 1, totalPages: images.length, ratio: 1, stage: 'done' })
    }
    return pages
  } finally {
    await worker.terminate()
  }
}

/** Уверенность строки, из которой взята цитата: для пометки сомнительных находок. */
export function confidenceOfQuote(pages: OcrPage[], page: number, quote: string): number | null {
  const target = pages.find((item) => item.page === page)
  if (!target) return null
  const normalised = quote.replace(/\s+/g, ' ').trim().toLowerCase()
  let worst: number | null = null
  for (const line of target.lines) {
    const lineText = line.text.replace(/\s+/g, ' ').trim().toLowerCase()
    if (lineText === '' ) continue
    if (normalised.includes(lineText) || lineText.includes(normalised)) {
      worst = worst === null ? line.confidence : Math.min(worst, line.confidence)
    }
  }
  return worst
}
