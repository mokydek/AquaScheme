import { buildEngineeringRoute } from '@aquascheme/engine'
import type { EngineeringRouteResult } from '@aquascheme/engine'

type RouteInput = Parameters<typeof buildEngineeringRoute>[0]

export interface RunningRouteCalculation {
  promise: Promise<EngineeringRouteResult>
  cancel: () => void
}
/** Runs CPU-heavy grid routing off the React thread; terminate() is a real cancellation. */
export function runEngineeringRouteInWorker(
  input: RouteInput,
  onProgress?: (stage: string) => void,
): RunningRouteCalculation {
  const worker = new Worker(new URL('../workers/route.worker.ts', import.meta.url), { type: 'module' })
  let settled = false
  let rejectPromise: ((reason: Error) => void) | null = null
  const promise = new Promise<EngineeringRouteResult>((resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = (event: MessageEvent<
      | { kind: 'progress'; stage: string }
      | { kind: 'result'; result: EngineeringRouteResult }
      | { kind: 'error'; error: string }
    >) => {
      if (event.data.kind === 'progress') {
        onProgress?.(event.data.stage)
        return
      }
      settled = true
      worker.terminate()
      if (event.data.kind === 'result') resolve(event.data.result)
      else reject(new Error(event.data.error))
    }
    worker.onerror = () => {
      settled = true
      worker.terminate()
      reject(new Error('Рабочий поток трассировки завершился с ошибкой.'))
    }
    worker.postMessage(input)
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      worker.terminate()
      rejectPromise?.(new Error('Расчёт отменён пользователем.'))
    },
  }
}
