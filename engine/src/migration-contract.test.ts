import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(new URL('../../backend/migrations/0012_engineering_route.sql', import.meta.url), 'utf8')

describe('engineering persistence migration', () => {
  it('replaces the complete network inside one PostgreSQL function', () => {
    expect(sql).toContain('create or replace function public.replace_project_network')
    expect(sql).toContain('delete from public.pipes where project_id = p_project_id;')
    expect(sql).toContain('delete from public.nodes where project_id = p_project_id;')
    expect(sql).toContain('insert into public.nodes')
    expect(sql).toContain('insert into public.pipes')
    expect(sql).toContain('network_revision = network_revision + 1')
  })

  it('persists engineering fields and route provenance outside generic metadata', () => {
    for (const field of [
      'input_data_hash', 'route_algorithm_version', 'route_quality',
      'flow_direction', 'inner_diameter_mm', 'roughness_mm', 'start_invert_m',
      'end_invert_m', 'design_flow_lps', 'velocity_mps', 'filling_ratio',
      'pressure_m', 'calculation_status', 'data_source',
    ]) expect(sql).toContain(field)
    expect(sql).toContain('set design_flow_lps = specific_demand_lpd')
    expect(sql).toContain('specific_demand_lpd = null')
  })

  it('persists gravity results through a project-scoped RPC', () => {
    expect(sql).toContain('create or replace function public.save_gravity_design')
    expect(sql).toContain("meta ->> 'engineId' = item ->> 'id'")
    expect(sql).toContain("calculation_status = case")
  })

  it('allows the explicit treatment, pumping-station and outfall node kinds', () => {
    expect(sql).toContain('drop constraint if exists nodes_kind_check')
    expect(sql).toContain("'treatment_facility'")
    expect(sql).toContain("'pumping_station'")
    expect(sql).toContain("'outfall'")
  })
})
