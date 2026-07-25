import { buildEngineeringRoute } from '@aquascheme/engine'

type RouteInput = Parameters<typeof buildEngineeringRoute>[0]

self.onmessage = (event: MessageEvent<RouteInput>) => {
  try {
    self.postMessage({ kind: 'progress', stage: 'Поиск связной оси внутри инженерного коридора…' })
    const result = buildEngineeringRoute(event.data)
    self.postMessage({ kind: 'result', result })
  } catch (error) {
    self.postMessage({ kind: 'error', error: error instanceof Error ? error.message : 'Ошибка маршрутного расчёта.' })
  }
}
