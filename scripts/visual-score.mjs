/**
 * Compare two equally-sized RGBA renderings without using the reference as a
 * production input. The three metrics expose different failure modes:
 * whitespace-dominated pixel similarity, foreground overlap and coarse layout.
 */
export function scoreRgba(reference, generated, width, height, options = {}) {
  if (reference.length !== generated.length || reference.length !== width * height * 4) {
    throw new Error('RGBA buffers and dimensions do not match.')
  }
  const threshold = options.inkThreshold ?? 245
  const cellsX = options.cellsX ?? 64
  const cellsY = options.cellsY ?? 48
  const referenceCells = new Float64Array(cellsX * cellsY)
  const generatedCells = new Float64Array(cellsX * cellsY)
  const cellCounts = new Uint32Array(cellsX * cellsY)
  let absoluteDifference = 0
  let inkIntersection = 0
  let inkUnion = 0

  const luminance = (buffer, offset) =>
    0.2126 * buffer[offset] + 0.7152 * buffer[offset + 1] + 0.0722 * buffer[offset + 2]

  for (let y = 0; y < height; y++) {
    const cellY = Math.min(cellsY - 1, Math.floor(y * cellsY / height))
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const refGray = luminance(reference, offset)
      const generatedGray = luminance(generated, offset)
      absoluteDifference += Math.abs(reference[offset] - generated[offset])
        + Math.abs(reference[offset + 1] - generated[offset + 1])
        + Math.abs(reference[offset + 2] - generated[offset + 2])
      const refInk = refGray < threshold
      const generatedInk = generatedGray < threshold
      if (refInk && generatedInk) inkIntersection++
      if (refInk || generatedInk) inkUnion++
      const cell = cellY * cellsX + Math.min(cellsX - 1, Math.floor(x * cellsX / width))
      referenceCells[cell] += refInk ? 1 : 0
      generatedCells[cell] += generatedInk ? 1 : 0
      cellCounts[cell]++
    }
  }

  let structureDifference = 0
  for (let index = 0; index < cellCounts.length; index++) {
    const count = Math.max(cellCounts[index], 1)
    structureDifference += Math.abs(referenceCells[index] / count - generatedCells[index] / count)
  }
  const pixelSimilarity = 1 - absoluteDifference / (width * height * 255 * 3)
  const inkIoU = inkUnion === 0 ? 1 : inkIntersection / inkUnion
  const structureSimilarity = 1 - structureDifference / cellCounts.length
  const combined = pixelSimilarity * 0.2 + inkIoU * 0.4 + structureSimilarity * 0.4
  return { pixelSimilarity, inkIoU, structureSimilarity, combined }
}

export function summarizePageScores(pages) {
  if (pages.length === 0) throw new Error('At least one page score is required.')
  const fields = ['pixelSimilarity', 'inkIoU', 'structureSimilarity', 'combined']
  const average = Object.fromEntries(fields.map((field) => [
    field,
    pages.reduce((sum, page) => sum + page[field], 0) / pages.length,
  ]))
  const minimum = Object.fromEntries(fields.map((field) => [
    field,
    Math.min(...pages.map((page) => page[field])),
  ]))
  return { average, minimum }
}
