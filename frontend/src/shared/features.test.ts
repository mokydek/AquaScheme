import { afterEach, describe, expect, it, vi } from 'vitest'
import { trainingScreensEnabled, waterSupplyEnabled } from './features'

/**
 * Флаг проверяется в ОБОИХ положениях.
 *
 * Проверка только выключенного положения доказывала бы, что В1 скрыт, но не
 * что он возвращается: ветка ждёт официальных СН, и включить её обратно должно
 * быть одним движением, а не археологией.
 */
afterEach(() => { vi.unstubAllEnvs() })

describe('признаки сборки', () => {
  it('водоснабжение выключено по умолчанию', () => {
    vi.stubEnv('VITE_WATER_SUPPLY', '')
    expect(waterSupplyEnabled()).toBe(false)
  })

  it('включается ровно значением «on», а не любой непустой строкой', () => {
    // Иначе случайное «false» или «0» в окружении включило бы ветку.
    vi.stubEnv('VITE_WATER_SUPPLY', 'on')
    expect(waterSupplyEnabled()).toBe(true)
    for (const value of ['off', 'false', '0', 'yes', 'ON ']) {
      vi.stubEnv('VITE_WATER_SUPPLY', value)
      expect(waterSupplyEnabled()).toBe(value.trim() === 'on')
    }
  })

  it('учебные экраны привязаны к режиму разработки, а не к своему флагу', () => {
    // Отдельный флаг для них завёл бы ещё одно положение сборки, которое можно
    // забыть выключить. Продовая сборка их не показывает по определению.
    vi.stubEnv('DEV', true)
    expect(trainingScreensEnabled()).toBe(true)
    vi.stubEnv('DEV', false)
    expect(trainingScreensEnabled()).toBe(false)
  })
})
