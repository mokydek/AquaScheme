import assert from 'node:assert/strict'
import test from 'node:test'
import { scoreRgba, summarizePageScores } from './visual-score.mjs'

function white(width, height) {
  return new Uint8ClampedArray(width * height * 4).fill(255)
}

function solid(width, height, rgba) {
  const buffer = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < buffer.length; offset += 4) buffer.set(rgba, offset)
  return buffer
}

function paint(buffer, width, x0, y0, x1, y1, value = 0) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const offset = (y * width + x) * 4
    buffer[offset] = value
    buffer[offset + 1] = value
    buffer[offset + 2] = value
    buffer[offset + 3] = 255
  }
}

test('identical pages score exactly one', () => {
  const page = white(32, 24)
  paint(page, 32, 3, 4, 18, 7)
  assert.deepEqual(scoreRgba(page, page, 32, 24), {
    pixelSimilarity: 1,
    inkIoU: 1,
    structureSimilarity: 1,
    combined: 1,
  })
})

test('foreground displacement is not hidden by white page area', () => {
  const reference = white(100, 100)
  const generated = white(100, 100)
  paint(reference, 100, 10, 10, 30, 30)
  paint(generated, 100, 70, 70, 90, 90)
  const score = scoreRgba(reference, generated, 100, 100)
  assert.equal(score.inkIoU, 0)
  assert.ok(score.pixelSimilarity > 0.9)
  assert.ok(score.combined < 0.8)
})

test('changed content reduces every strict metric', () => {
  const reference = white(64, 48)
  const generated = white(64, 48)
  paint(reference, 64, 5, 5, 45, 12)
  paint(generated, 64, 5, 5, 25, 12)
  const score = scoreRgba(reference, generated, 64, 48)
  assert.ok(score.pixelSimilarity < 1)
  assert.ok(score.inkIoU < 1)
  assert.ok(score.structureSimilarity < 1)
  assert.ok(score.combined < 1)
})

test('different RGB colors with similar luminance cannot pass as identical', () => {
  const width = 10
  const height = 10
  const red = solid(width, height, [86, 0, 0, 255])
  const blue = solid(width, height, [0, 0, 254, 255])
  const score = scoreRgba(red, blue, width, height)
  assert.ok(score.pixelSimilarity < 0.6)
  assert.ok(score.combined < 0.95)
})

test('summary reports average and worst page separately', () => {
  const result = summarizePageScores([
    { pixelSimilarity: 1, inkIoU: 1, structureSimilarity: 1, combined: 1 },
    { pixelSimilarity: 0.8, inkIoU: 0.4, structureSimilarity: 0.6, combined: 0.56 },
  ])
  assert.equal(result.average.combined, 0.78)
  assert.equal(result.minimum.inkIoU, 0.4)
})
