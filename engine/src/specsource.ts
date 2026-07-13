import type { ExportInput } from './exportdata'
import { buildSpecification } from './specification'
import type { SpecItem } from './specification'

/**
 * Pluggable specification source (requirements update 3, change 5). The bill
 * of materials can come from different sources behind one interface: the
 * built-in source derives items from the sizing and fittings (with codes from
 * the active catalog when present); a VGSK source will import and sync items
 * from the external VGSK base LATER — it is deliberately NOT implemented here
 * because its structure must not be invented (blocked pending the user's
 * decoding of the abbreviation, the data source and a sample export). The
 * architecture keeps the source swappable so VGSK plugs in without touching
 * the sheet or the export.
 */
export interface SpecificationSource {
  id: string
  /** Human label for the source picker. */
  name: string
  /** Whether the source is ready to use (VGSK is not, until configured). */
  available: boolean
  /** Build the specification items for the project. */
  build(input: ExportInput): SpecItem[]
}

/** Built-in source: items from the sizing and fittings via buildSpecification. */
export const builtinCatalogSource: SpecificationSource = {
  id: 'builtin',
  name: 'Встроенный каталог',
  available: true,
  build: (input) => buildSpecification(input),
}

/**
 * VGSK source placeholder. Declared so the source is a pluggable module, but
 * not implemented: the VGSK export structure is unknown and must not be
 * invented. It becomes available once the format is supplied.
 */
export const vgskSource: SpecificationSource = {
  id: 'vgsk',
  name: 'ВГСК (внешняя база)',
  available: false,
  build() {
    throw new Error('VGSK specification source is not configured (format pending from the user)')
  },
}

export const SPEC_SOURCES: SpecificationSource[] = [builtinCatalogSource, vgskSource]

/** Select a source by id, falling back to the built-in one. */
export function selectSpecificationSource(id?: string): SpecificationSource {
  const found = SPEC_SOURCES.find((s) => s.id === id && s.available)
  return found ?? builtinCatalogSource
}
