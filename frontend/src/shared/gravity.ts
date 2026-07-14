import type { GravityNetworkResult } from '@aquascheme/engine'
import { supabase } from './supabase'

/**
 * Persistence for the gravity (К1/К2) calculation. The result is stored in
 * calc_runs with its `kind: 'gravity'` discriminator, so the water pressure
 * runs and the gravity runs share the same history table without being
 * confused (the loader checks the discriminator).
 */

export interface SavedGravityRun {
  summary: GravityNetworkResult
  finishedAt: string | null
}

export async function persistGravity(projectId: string, result: GravityNetworkResult): Promise<void> {
  const { error } = await supabase.from('calc_runs').insert({
    project_id: projectId,
    status: 'done',
    params: { system: result.systemType, outletFlowLps: result.outletFlowLps },
    summary: result as unknown as Record<string, unknown>,
    finished_at: new Date().toISOString(),
  })
  if (error) throw error
}

/** The latest calc_run for the project, but only if it is a gravity run. */
export async function fetchLastGravityRun(projectId: string): Promise<SavedGravityRun | null> {
  const res = await supabase
    .from('calc_runs')
    .select('summary, finished_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const summary = res.data?.summary as (GravityNetworkResult & { kind?: string }) | undefined
  if (!summary || summary.kind !== 'gravity') return null
  return { summary, finishedAt: (res.data?.finished_at as string | null) ?? null }
}
