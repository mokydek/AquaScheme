import type { TextItem } from '@aquascheme/engine'

/**
 * Extract positioned text items from a digital PDF (requirements update 3,
 * change 1, G2). pdfjs-dist is heavy and only needed here, so it is lazy
 * imported into its own chunk. The engine (pdftable.ts) turns these items
 * into a table; a PDF with no text layer (a scan) yields no items and the UI
 * then asks for a digital PDF, XLSX or manual input until the OCR phase.
 */

export interface PdfPageText {
  page: number
  items: TextItem[]
}

export async function loadPdfTextByPage(file: File): Promise<PdfPageText[]> {
  const pdfjs = await import('pdfjs-dist')
  // The worker ships as an ESM module; Vite resolves ?url to an asset path.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  const pages: PdfPageText[] = []
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      const items: TextItem[] = []
      for (const raw of content.items) {
        const it = raw as { str?: string; transform?: number[]; width?: number; height?: number }
        if (typeof it.str !== 'string' || !it.transform) continue
        // transform = [a, b, c, d, e, f]; e = x, f = y (baseline), d ≈ font size.
        items.push({
          str: it.str,
          x: it.transform[4],
          y: it.transform[5],
          width: it.width ?? 0,
          height: it.height && it.height > 0 ? it.height : Math.abs(it.transform[3]) || 8,
        })
      }
      pages.push({ page: pageNo, items })
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return pages
}
