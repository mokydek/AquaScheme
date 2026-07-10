import { sizeNetwork } from '@aquascheme/engine/sizing'
import type { SizingInput, SizingResult } from '@aquascheme/engine/sizing'

/**
 * Hydraulics worker: EPANET solves and the diameter selection loop run off
 * the main thread so the interface stays responsive.
 */

export type HydraulicsWorkerResponse =
  | { ok: true; result: SizingResult }
  | { ok: false; error: string }

const ctx = self as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<SizingInput>) => void,
  ): void
  postMessage(data: HydraulicsWorkerResponse): void
}

ctx.addEventListener('message', (event) => {
  sizeNetwork(event.data)
    .then((result) => ctx.postMessage({ ok: true, result }))
    .catch((error: unknown) => ctx.postMessage({ ok: false, error: String(error) }))
})
