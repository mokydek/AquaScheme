import { saveDataset } from './datasets'
import { SUPABASE_ANON_KEY, SUPABASE_REST_URL, supabase } from './supabase'

type JsonObject = Record<string, unknown>

function jsonObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function isMissingBasisFileRpc(error: unknown): boolean {
  const candidate = jsonObject(error)
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  if (code === 'PGRST202' || code === '42883') return true

  const text = [candidate.message, candidate.details, candidate.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()
  return text.includes('save_basis_file') && (
    text.includes('could not find')
    || text.includes('does not exist')
    || text.includes('schema cache')
  )
}

let basisFileRpcCapability: Promise<boolean> | null = null

async function probeBasisFileRpc(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession()
    const accessToken = data.session?.access_token
    if (error || !accessToken) return false

    const response = await fetch(SUPABASE_REST_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/openapi+json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    })
    if (!response.ok) return false
    const specification = jsonObject(await response.json())
    const paths = jsonObject(specification.paths)
    return Object.prototype.hasOwnProperty.call(paths, '/rpc/save_basis_file')
  } catch {
    // Capability discovery must never turn a compatible legacy deployment
    // into a save failure. The ordinary dataset path remains available.
    return false
  }
}

function hasBasisFileRpc(): Promise<boolean> {
  basisFileRpcCapability ??= probeBasisFileRpc()
  return basisFileRpcCapability
}

async function saveBasisFileLegacy(
  projectId: string,
  itemId: string,
  fileName: string,
  base: JsonObject,
): Promise<void> {
  const files = jsonObject(base.files)
  await saveDataset(projectId, 'basis', {
    ...base,
    files: { ...files, [itemId]: fileName },
  })
}

/**
 * Merge one basis-document file name without overwriting concurrently saved
 * siblings. Migration 0015 performs the merge atomically in PostgreSQL. The
 * legacy branch is deliberately limited to a missing RPC/schema-cache entry;
 * permissions, validation and runtime errors must remain visible.
 */
export async function saveBasisFile(
  projectId: string,
  itemId: string,
  fileName: string,
  baseContent: unknown,
): Promise<void> {
  const base = jsonObject(baseContent)
  if (!await hasBasisFileRpc()) {
    await saveBasisFileLegacy(projectId, itemId, fileName, base)
    return
  }

  const { error } = await supabase.rpc('save_basis_file', {
    p_project_id: projectId,
    p_item_id: itemId,
    p_file_name: fileName,
    p_base_content: base,
  })
  if (!error) return
  if (!isMissingBasisFileRpc(error)) throw error
  // OpenAPI can briefly advertise a function that PostgREST has already lost
  // from its schema cache. Remember that mismatch for the rest of this page so
  // later uploads skip the same noisy 400/404 and use the compatible path.
  basisFileRpcCapability = Promise.resolve(false)
  await saveBasisFileLegacy(projectId, itemId, fileName, base)
}
