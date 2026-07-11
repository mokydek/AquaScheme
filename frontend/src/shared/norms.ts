import { NORM_DOCUMENTS, NORM_REGISTRY } from '@aquascheme/engine'
import { supabase } from './supabase'

/**
 * Mirrors the code owned norm registry into the database (upsert), so the
 * norm_documents / norm_clauses tables stay in sync with the engine without a
 * migration on every registry change (requirements update 2, N1). Best effort:
 * failures never block the UI. Runs at most once per session.
 */
let synced = false

export async function syncNormRegistry(): Promise<void> {
  if (synced) return
  synced = true
  try {
    await supabase.from('norm_documents').upsert(
      NORM_DOCUMENTS.map((d) => ({ code: d.code, title: d.title, edition: d.edition, status: d.status })),
    )
    await supabase.from('norm_clauses').upsert(
      NORM_REGISTRY.map((c) => ({
        id: c.id,
        document_code: c.documentCode,
        clause: c.clause,
        requirement: c.requirement,
        value_text: c.valueText,
        units: c.units,
        applies_system: c.appliesSystem,
        applies_work: c.appliesWork,
        status: c.status,
      })),
    )
  } catch {
    synced = false
  }
}
