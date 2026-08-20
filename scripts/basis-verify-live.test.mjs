import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { kitSlotsFromSource, whitelistFromMigrations } from './basis-verify-live.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Скрипт достаёт два списка разбором исходников. Разбор — вещь хрупкая:
 * переименуют константу, поменяют формат строки — и проверка начнёт печатать
 * «слотов 0 из 0», выглядя при этом успешной. Пустой список здесь и есть
 * тихая неправда, поэтому он проверяется первым.
 */
test('белый список вычитывается из миграций и совпадает с кодом', () => {
  const whitelist = whitelistFromMigrations(ROOT)
  assert.ok(whitelist.length >= 12, `белый список не разобран: ${JSON.stringify(whitelist)}`)

  const source = readFileSync(join(ROOT, 'frontend', 'src', 'shared', 'basisFiles.ts'), 'utf8')
  const declaration = /export const BASIS_ITEM_IDS = \[([\s\S]*?)\] as const/.exec(source)
  assert.ok(declaration, 'BASIS_ITEM_IDS не найден в коде')
  const fromCode = [...declaration[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
  assert.deepEqual([...whitelist].sort(), [...fromCode].sort())
})

test('слоты мастера вычитываются с идентификаторами и без пропусков', () => {
  const slots = kitSlotsFromSource(ROOT)
  const source = readFileSync(join(ROOT, 'frontend', 'src', 'shared', 'kitWizard.ts'), 'utf8')
  const declared = [...source.matchAll(/\{ id: '(\w+)',/g)].map((match) => match[1])
  assert.deepEqual(slots.map((slot) => slot.slotId), declared,
    'разбор реестра слотов потерял слоты: проверка напечатала бы неполный комплект')

  const whitelist = whitelistFromMigrations(ROOT)
  for (const slot of slots) {
    assert.ok(whitelist.includes(slot.itemId), `${slot.slotId}: ключа ${slot.itemId} нет в белом списке`)
  }
})
