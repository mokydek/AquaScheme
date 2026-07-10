import { buildTerrain } from '@aquascheme/engine/terrain'
import type { SurveyPoint } from '@aquascheme/engine'

/**
 * Terrain worker: builds the TIN and contours off the main thread so the
 * interface never freezes on big surveys.
 */

const ctx = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<{ points: SurveyPoint[] }>) => void): void
  postMessage(data: unknown): void
}

ctx.addEventListener('message', (event) => {
  ctx.postMessage(buildTerrain(event.data.points))
})
