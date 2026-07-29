export const SYNTHETIC_BASIS_NOTE =
  'Исходные документы не отмечаются загруженными автоматически: демо не заменяет реальные ТЗ, АПЗ, DWG, топосъёмку и ИГИ.'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Refreshes synthetic-demo metadata without claiming that source documents
 * exist. Manually uploaded file names and every non-demo field are retained.
 */
export function mergeSyntheticBasisContent(existingContent: unknown): JsonObject & { files: JsonObject } {
  return mergeSyntheticBasisContents([existingContent])
}

/**
 * Merges legacy duplicate rows ordered newest first. The newest row remains
 * canonical for every field except `files`; older rows only fill file keys
 * that are absent from newer rows.
 */
export function mergeSyntheticBasisContents(existingContents: readonly unknown[]): JsonObject & { files: JsonObject } {
  const newest = isObject(existingContents[0]) ? existingContents[0] : {}
  let files: JsonObject = {}
  for (let index = existingContents.length - 1; index >= 0; index -= 1) {
    const candidate = existingContents[index]
    const content = isObject(candidate) ? candidate : {}
    if (isObject(content.files)) files = { ...files, ...content.files }
  }
  return {
    ...newest,
    files,
    mode: 'synthetic',
    note: SYNTHETIC_BASIS_NOTE,
  }
}
