import { expect, test } from '@playwright/test'

/**
 * Один сквозной путь: лендинг → вход → проект на демо-данных → расчёт →
 * скачанный PDF альбома.
 *
 * Реальные объекты здесь не участвуют: проект создаётся на демонстрационных
 * данных, встроенных в приложение. Ни адресов, ни отметок настоящих площадок
 * в этот прогон не попадает.
 */

const email = process.env.E2E_EMAIL ?? ''
const password = process.env.E2E_PASSWORD ?? ''
const hasCredentials = email !== '' && password !== ''

test.describe('сквозной путь пользователя', () => {
  test.skip(!hasCredentials, 'E2E_EMAIL и E2E_PASSWORD не заданы: браузерный смоук не выполнялся')

  test('от лендинга до скачанного альбома', async ({ page }) => {
    await page.goto('/')
    // Лендинг жив: заголовок отрисован, а не белый экран после падения сборки.
    await expect(page.locator('h1')).toBeVisible()

    await page.goto('/auth')
    await page.getByLabel(/e-?mail/i).fill(email)
    await page.getByLabel(/пароль|password/i).fill(password)
    await page.getByRole('button', { name: /войти|sign in/i }).click()

    // После входа открывается список проектов.
    await expect(page.getByRole('button', { name: /создать проект|create project/i }))
      .toBeVisible({ timeout: 30_000 })

    const projectName = `Смоук ${process.env.GITHUB_RUN_ID ?? 'локальный'}`
    await page.getByPlaceholder(/название проекта|project name/i).fill(projectName)
    await page.getByRole('button', { name: /создать проект|create project/i }).click()

    // Мастер создания: тип работ, система, имя. Значения по умолчанию годятся.
    for (const label of [/новое строительство|new construction/i, /водоснабжение|water supply/i]) {
      const option = page.getByRole('button', { name: label })
      if (await option.isVisible().catch(() => false)) await option.click()
    }
    await page.getByRole('button', { name: /создать проект|create project/i }).last().click()

    // Демо-данные и расчёт.
    await page.getByRole('button', { name: /демо|demo/i }).first().click()
    await expect(page.getByText(/готово|загружено|loaded|ready/i).first())
      .toBeVisible({ timeout: 60_000 })

    const download = page.waitForEvent('download', { timeout: 90_000 })
    await page.getByRole('button', { name: /пояснительная записка|explanatory note|pdf/i })
      .first().click()
    const file = await download
    const path = await file.path()
    expect(path).toBeTruthy()

    const { statSync } = await import('node:fs')
    // Пустой файл — самый частый исход сорвавшейся генерации: кнопка
    // отработала, скачивание началось, содержимого нет.
    expect(statSync(path!).size).toBeGreaterThan(1024)
  })
})
