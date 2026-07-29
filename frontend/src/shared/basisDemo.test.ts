import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  mergeSyntheticBasisContent,
  mergeSyntheticBasisContents,
  syntheticBasisArtifact,
  SYNTHETIC_BASIS_ARTIFACTS,
  SYNTHETIC_BASIS_FILES,
  SYNTHETIC_BASIS_NOTE,
} from './basisDemo'

describe('mergeSyntheticBasisContent', () => {
  it('never clears file names that were uploaded before demo seeding', () => {
    const existing = {
      files: {
        assignment: 'ТЗ.pdf',
        apz: 'owner_apz.pdf',
        geology: 'ИГИ.pdf',
      },
    }

    const merged = mergeSyntheticBasisContent(existing)

    expect(merged.files).toEqual({ ...SYNTHETIC_BASIS_FILES, ...existing.files })
    expect(merged.files).not.toBe(existing.files)
    expect(existing.files).toHaveProperty('assignment', 'ТЗ.pdf')
  })

  it('preserves all other basis fields while refreshing synthetic demo metadata', () => {
    const project = { name: 'Коллектор', code: 'DEMO-K2-001' }
    const existing = {
      files: { topo: 'Топосъёмка.pdf' },
      referenceFiles: ['Генплан.pdf'],
      project,
      provenance: { topo: 'лист 4' },
      acceptedRoute: [{ x: 10, y: 20 }],
      mode: 'owner-managed',
      note: 'Проверено главным инженером',
    }

    const merged = mergeSyntheticBasisContent(existing)

    expect(merged).toMatchObject({
      files: { ...SYNTHETIC_BASIS_FILES, ...existing.files },
      project,
      provenance: existing.provenance,
      acceptedRoute: existing.acceptedRoute,
      mode: 'synthetic',
      note: SYNTHETIC_BASIS_NOTE,
    })
    expect(merged.referenceFiles).toEqual(existing.referenceFiles)
    expect(merged.project).toBe(project)
  })

  it('creates a complete persistent nine-file checklist for a new demo project', () => {
    expect(mergeSyntheticBasisContent(null)).toEqual({
      files: SYNTHETIC_BASIS_FILES,
      referenceFiles: [],
      mode: 'synthetic',
      note: SYNTHETIC_BASIS_NOTE,
    })
    expect(Object.keys(SYNTHETIC_BASIS_FILES)).toHaveLength(9)
  })

  it('merges files from every legacy row with deterministic newest-row precedence', () => {
    const newest = {
      files: { assignment: 'новое ТЗ.pdf', topo: 'новая топосъёмка.pdf' },
      project: { code: 'NEW' },
      newestOnly: true,
    }
    const middle = {
      files: { assignment: 'старое ТЗ.pdf', geology: 'ИГИ.pdf' },
      project: { code: 'OLD' },
      olderOnly: true,
    }
    const oldest = { files: { apz: 'АПЗ.pdf', geology: 'старое ИГИ.pdf' } }

    const merged = mergeSyntheticBasisContents([newest, middle, oldest])

    expect(merged.files).toEqual({
      ...SYNTHETIC_BASIS_FILES,
      assignment: 'новое ТЗ.pdf',
      apz: 'АПЗ.pdf',
      geology: 'ИГИ.pdf',
      topo: 'новая топосъёмка.pdf',
    })
    expect(merged.project).toEqual({ code: 'NEW' })
    expect(merged).not.toHaveProperty('olderOnly')
    expect(newest.files).toEqual({ assignment: 'новое ТЗ.pdf', topo: 'новая топосъёмка.pdf' })
  })

  it('provides a downloadable, honestly marked artifact for every generated demo row', () => {
    expect(Object.keys(SYNTHETIC_BASIS_ARTIFACTS)).toEqual(Object.keys(SYNTHETIC_BASIS_FILES))
    for (const [itemId, fileName] of Object.entries(SYNTHETIC_BASIS_FILES)) {
      const artifact = syntheticBasisArtifact(itemId, fileName)
      expect(artifact).not.toBeNull()
      expect(artifact?.fileName).toBe(fileName)
      expect(artifact?.content.length).toBeGreaterThan(40)
      expect(artifact?.content).toContain('synthetic-demo')
    }
  })

  it('does not offer a generated download when a real owner file replaced the demo row', () => {
    expect(syntheticBasisArtifact('apz', 'owner_apz.pdf')).toBeNull()
    expect(syntheticBasisArtifact('unknown', 'unknown.json')).toBeNull()
  })
})

describe('basis uniqueness migration contract', () => {
  it('merges duplicate basis files into the canonical row before deleting duplicates', () => {
    const migration = readFileSync(
      new URL('../../../backend/migrations/0014_dataset_uniqueness.sql', import.meta.url),
      'utf8',
    )
    const updatePosition = migration.search(/update public\.datasets as canonical/i)
    const deletePosition = migration.search(/delete from public\.datasets as dataset/i)

    expect(migration).toMatch(/jsonb_each/i)
    expect(migration).toMatch(/partition by dataset\.project_id, file\.key/i)
    expect(migration).toMatch(/order by dataset\.created_at desc, dataset\.id desc/i)
    expect(migration).toMatch(/jsonb_build_object\('files'/i)
    expect(updatePosition).toBeGreaterThan(-1)
    expect(deletePosition).toBeGreaterThan(updatePosition)
  })
})
