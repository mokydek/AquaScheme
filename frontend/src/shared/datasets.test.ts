import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from },
}))

import { saveDataset } from './datasets'

interface SetupOptions {
  updateResults?: Array<{
    data?: Array<{ id: string }>
    error?: Record<string, string> | null
  }>
  insertError?: Record<string, string> | null
}

function setupTables(options: SetupOptions = {}) {
  const updateResults = options.updateResults ?? [{ data: [{ id: 'dataset-1' }] }]
  let updateResultIndex = 0
  const updateSelect = vi.fn(async () => {
    const result = updateResults[Math.min(updateResultIndex, updateResults.length - 1)] ?? { data: [] }
    updateResultIndex += 1
    return { data: result.data ?? [], error: result.error ?? null }
  })
  const updateKindEq = vi.fn(() => ({ select: updateSelect }))
  const updateProjectEq = vi.fn(() => ({ eq: updateKindEq }))
  const update = vi.fn(() => ({ eq: updateProjectEq }))
  const insert = vi.fn().mockResolvedValue({ error: options.insertError ?? null })

  const routeEq = vi.fn().mockResolvedValue({ error: null })
  const routeUpdate = vi.fn(() => ({ eq: routeEq }))

  const datasetsTable = { update, insert }
  const projectsTable = { update: routeUpdate }
  supabaseMock.from.mockImplementation((table: string) => (
    table === 'datasets' ? datasetsTable : projectsTable
  ))

  return {
    update,
    updateProjectEq,
    updateKindEq,
    updateSelect,
    insert,
    routeUpdate,
    routeEq,
  }
}

describe('saveDataset', () => {
  beforeEach(() => {
    supabaseMock.from.mockReset()
  })

  it('updates an existing project/kind row without issuing a failing upsert', async () => {
    const db = setupTables()

    await saveDataset('project-1', 'topography', { points: [] }, { accepted: 0 }, 'survey.csv')

    expect(db.update).toHaveBeenCalledWith({
      content: { points: [] },
      meta: { accepted: 0 },
      file_name: 'survey.csv',
    })
    expect(db.updateProjectEq).toHaveBeenCalledWith('project_id', 'project-1')
    expect(db.updateKindEq).toHaveBeenCalledWith('kind', 'topography')
    expect(db.updateSelect).toHaveBeenCalledWith('id')
    expect(db.insert).not.toHaveBeenCalled()
    expect(db.routeUpdate).toHaveBeenCalledWith({ route_status: 'stale' })
    expect(db.routeEq).toHaveBeenCalledWith('id', 'project-1')
  })

  it('inserts when no project/kind row exists on either schema version', async () => {
    const db = setupTables({
      updateResults: [{ data: [] }],
    })

    await saveDataset('project-2', 'normative', { minPressure: 10 }, null, 'norms.json')

    expect(db.insert).toHaveBeenCalledWith({
      project_id: 'project-2',
      kind: 'normative',
      content: { minPressure: 10 },
      meta: null,
      file_name: 'norms.json',
    })
  })

  it('retries update when a concurrent creator wins the unique insert race', async () => {
    const db = setupTables({
      updateResults: [{ data: [] }, { data: [{ id: 'concurrent-dataset' }] }],
      insertError: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })

    await saveDataset('project-3', 'seismic', { siteIntensityPoints: 7 })

    expect(db.update).toHaveBeenCalledTimes(2)
    expect(db.updateSelect).toHaveBeenCalledTimes(2)
    expect(db.insert).toHaveBeenCalledWith({
      project_id: 'project-3',
      kind: 'seismic',
      content: { siteIntensityPoints: 7 },
      meta: null,
      file_name: null,
    })
  })

  it('does not continue to insert after an update failure', async () => {
    const error = { code: '42501', message: 'row-level security policy denied the write' }
    const db = setupTables({ updateResults: [{ error }] })

    await expect(saveDataset('project-4', 'source', { x: 1, y: 2 })).rejects.toEqual(error)

    expect(db.insert).not.toHaveBeenCalled()
    expect(db.routeUpdate).not.toHaveBeenCalled()
  })

  it('does not hide a non-conflict insert failure behind a retry', async () => {
    const error = { code: '23514', message: 'dataset kind violates check constraint' }
    const db = setupTables({ updateResults: [{ data: [] }], insertError: error })

    await expect(saveDataset('project-5', 'manhole_catalog', { entries: [] })).rejects.toEqual(error)

    expect(db.update).toHaveBeenCalledTimes(1)
    expect(db.insert).toHaveBeenCalledTimes(1)
    expect(db.routeUpdate).not.toHaveBeenCalled()
  })
})

describe('dataset uniqueness migration contract', () => {
  it('keeps the consolidated schema and incremental migration on the same conflict target', () => {
    const fullSchema = readFileSync(
      new URL('../../../backend/migrations/0000_full_schema.sql', import.meta.url),
      'utf8',
    )
    const migration = readFileSync(
      new URL('../../../backend/migrations/0014_dataset_uniqueness.sql', import.meta.url),
      'utf8',
    )

    for (const sql of [fullSchema, migration]) {
      expect(sql).toMatch(/datasets_project_kind_unique\s+unique\s*\(project_id,\s*kind\)/i)
    }
    expect(migration).toMatch(/partition by project_id,\s*kind/i)
    expect(migration).toMatch(/order by created_at desc,\s*id desc/i)
    expect(migration).toMatch(/lock table public\.datasets in share row exclusive mode/i)
  })
})
