import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../shared/supabase', () => ({ supabase: {} }))
vi.mock('../shared/auth', () => ({ useAuth: () => ({ session: null }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, Link: 'a' }))

const { systemTypes } = await import('./NewProjectPage')

afterEach(() => { vi.unstubAllEnvs() })

/**
 * Состав предлагаемых систем в ОБОИХ положениях флага.
 *
 * Проверяется сама точка решения, а не разметка: мастер пошаговый, и до
 * выбора системы статический рендер не доходит — проверка по разметке была бы
 * проверкой первого шага, а не состава.
 *
 * В1 скрыт не навсегда: ветка ждёт официальных СН по водоснабжению, и второй
 * случай держит путь обратно открытым.
 */
describe('какие системы предлагает мастер', () => {
  it('без флага — только канализация и ливневая', () => {
    vi.stubEnv('VITE_WATER_SUPPLY', '')
    expect(systemTypes()).toEqual(['sewer', 'storm'])
  })

  it('с флагом В1 возвращается на первое место', () => {
    vi.stubEnv('VITE_WATER_SUPPLY', 'on')
    expect(systemTypes()).toEqual(['water', 'sewer', 'storm'])
  })
})
