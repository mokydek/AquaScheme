import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  assessHazards,
  getRegion,
  localToLonLat,
  nearestRegion,
  NORMATIVE_DEFAULTS,
  REGIONS_KZ,
} from '@aquascheme/engine'
import type { GeologyInput, HazardKind, RegionInfo, SeismicInput } from '@aquascheme/engine'
import { supabase } from '../../shared/supabase'
import { saveDataset } from '../../shared/datasets'
import type { DatasetKind, DatasetRow } from '../../shared/datasets'
import type { RegionDatasetContent } from '../../shared/regions'
import { NormBadge } from './NormBadge'
import { Panel } from './Panel'

type Values = Record<string, string>
type Notice = 'saved' | 'saveError' | null

function toValues(source: Record<string, unknown>): Values {
  const out: Values = {}
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === null || value === undefined ? '' : String(value)
  }
  return out
}

/** Generic numeric/select form persisted as a dataset of the given kind. */
function useDatasetForm(
  projectId: string,
  kind: DatasetKind,
  dataset: DatasetRow | undefined,
  defaults: Record<string, unknown>,
  onSaved: () => Promise<void>,
) {
  const [values, setValues] = useState<Values>(() =>
    toValues({ ...defaults, ...((dataset?.content ?? {}) as Record<string, unknown>) }),
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    setValues(toValues({ ...defaults, ...((dataset?.content ?? {}) as Record<string, unknown>) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.id, dataset?.content])

  const set = (key: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setNotice(null)
    setValues((v) => ({ ...v, [key]: e.target.value }))
  }

  const save = async (transform: (values: Values) => Record<string, unknown> | null) => {
    const content = transform(values)
    if (content === null) {
      setNotice('saveError')
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      // Форма правит свои поля, а не весь набор: в той же строке живут и другие
      // ключи — например, сверки нормативных пунктов, — и запись одних только
      // преобразованных значений их бы стёрла.
      await saveDataset(projectId, kind, {
        ...((dataset?.content ?? {}) as Record<string, unknown>),
        ...content,
      })
      setNotice('saved')
      await onSaved()
    } catch {
      setNotice('saveError')
    } finally {
      setBusy(false)
    }
  }

  return { values, set, save, busy, notice }
}

function parseNum(value: string): number {
  return Number(value.trim().replace(',', '.'))
}

function numbersOrNull(values: Values, keys: string[]): Record<string, number> | null {
  const out: Record<string, number> = {}
  for (const key of keys) {
    const n = parseNum(values[key] ?? '')
    if (!Number.isFinite(n)) return null
    out[key] = n
  }
  return out
}

function SectionFooter({
  busy,
  notice,
  onSave,
}: {
  busy: boolean
  notice: Notice
  onSave: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="section-actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onSave}>
          {t('project.save')}
        </button>
        {notice === 'saved' && <span className="stat-line ok">{t('project.saved')}</span>}
      </div>
      {notice === 'saveError' && <p className="notice error">{t('project.saveError')}</p>}
    </>
  )
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} name={id} className="input" inputMode="decimal" value={value} onChange={onChange} />
    </label>
  )
}

export function SourceSection(props: {
  projectId: string
  dataset: DatasetRow | undefined
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const form = useDatasetForm(
    props.projectId,
    'source',
    props.dataset,
    { x: '', y: '', groundElevation: '', availableHead: '' },
    props.onSaved,
  )
  const keys = ['x', 'y', 'groundElevation', 'availableHead']
  const labels = ['x', 'y', 'elevation', 'head']

  return (
    <Panel title={t('project.source.title')} status={props.dataset ? 'filled' : 'empty'}>
      <p className="hint">{t('project.source.hint')}</p>
      <div className="form-grid">
        {keys.map((key, i) => (
          <NumberField
            key={key}
            id={`source-${key}`}
            label={t(`project.source.${labels[i]}`)}
            value={form.values[key] ?? ''}
            onChange={form.set(key)}
          />
        ))}
      </div>
      <SectionFooter
        busy={form.busy}
        notice={form.notice}
        onSave={() => void form.save((v) => numbersOrNull(v, keys))}
      />
    </Panel>
  )
}

/** Hazards edited as extra checkboxes (flood and subsidence stay booleans). */
const EXTRA_HAZARDS: HazardKind[] = ['mudflow', 'landslide', 'karst', 'high_groundwater']

/**
 * Region of the site and its emergency risks (requirements update 3,
 * change 3). Region is picked manually or auto detected by the site
 * coordinates; regional values arrive as defaults marked «региональное
 * значение по умолчанию» with a norm reference and stay editable in the
 * geology and seismicity sections. The official values are pending, so the
 * built in directory ships with empty values marked unverified.
 */
export function RegionSection(props: {
  projectId: string
  dataset: DatasetRow | undefined
  seismicDataset: DatasetRow | undefined
  geologyDataset: DatasetRow | undefined
  source: { x: number; y: number } | null
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const content = (props.dataset?.content ?? null) as RegionDatasetContent | null
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<
    'saved' | 'applied' | 'saveError' | 'migrationNeeded' | null
  >(null)

  // The code list is the source of truth; the dataset keeps a snapshot.
  const region = content ? (getRegion(content.regionId) ?? null) : null
  const seismicPoints = region?.seismicPoints ?? content?.seismicPoints ?? null
  const freezingDepthM = region?.freezingDepthM ?? content?.freezingDepthM ?? null
  const regionHazards: HazardKind[] =
    (region && region.hazards.length > 0 ? region.hazards : content?.hazards) ?? []

  const seismicContent = (props.seismicDataset?.content ?? null) as SeismicInput | null
  const measures = seismicContent ? assessHazards(seismicContent) : []

  const failNotice = (error: unknown) => {
    const code = (error as { code?: string } | null)?.code
    setNotice(code === '23514' ? 'migrationNeeded' : 'saveError')
  }

  const persist = async (info: RegionInfo, source: 'manual' | 'auto') => {
    setBusy(true)
    setNotice(null)
    try {
      const next: RegionDatasetContent = {
        regionId: info.id,
        name: info.name,
        source,
        seismicPoints: info.seismicPoints,
        freezingDepthM: info.freezingDepthM,
        hazards: info.hazards,
      }
      await saveDataset(props.projectId, 'region', next)
      setNotice('saved')
      await props.onSaved()
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await supabase.from('datasets').delete().eq('project_id', props.projectId).eq('kind', 'region')
      await props.onSaved()
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy(false)
    }
  }

  const onSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const info = getRegion(e.target.value)
    if (info) void persist(info, 'manual')
    else void clear()
  }

  const detect = () => {
    if (!props.source) return
    const [lon, lat] = localToLonLat(props.source.x, props.source.y)
    const info = nearestRegion(lon, lat)
    if (info) void persist(info, 'auto')
  }

  const canApply =
    region !== null && (seismicPoints !== null || freezingDepthM !== null || regionHazards.length > 0)

  /** Regional defaults into the seismic and geology datasets (still editable there). */
  const apply = async () => {
    if (!canApply || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const seismic: SeismicInput = seismicContent ?? {
        siteIntensityPoints: 6,
        subsidenceProne: false,
        floodProne: false,
      }
      await saveDataset(props.projectId, 'seismic', {
        ...seismic,
        siteIntensityPoints: seismicPoints ?? seismic.siteIntensityPoints,
        subsidenceProne: seismic.subsidenceProne || regionHazards.includes('subsidence'),
        floodProne: seismic.floodProne || regionHazards.includes('flood'),
        hazards: [
          ...new Set([
            ...(seismic.hazards ?? []),
            ...regionHazards.filter((h) => EXTRA_HAZARDS.includes(h)),
          ]),
        ],
      })
      const geology = (props.geologyDataset?.content ?? null) as GeologyInput | null
      if (geology && freezingDepthM !== null) {
        await saveDataset(props.projectId, 'geology', {
          ...geology,
          freezingDepthM,
          freezingDepthSource: `Региональный справочник: ${region?.name ?? content?.name ?? content?.regionId ?? 'не указан'}`,
          // Applying a regional suggestion invalidates any earlier approval.
          // An engineer must compare it with the project geology and confirm it.
          freezingDepthVerified: false,
        })
      }
      setNotice('applied')
      await props.onSaved()
    } catch (error) {
      failNotice(error)
    } finally {
      setBusy(false)
    }
  }

  const valueLine = (value: string | null) => value ?? t('project.region.noValue')

  return (
    <Panel title={t('project.region.title')} status={content ? 'filled' : 'empty'}>
      <p className="hint">{t('project.region.hint')}</p>
      <div className="form-grid">
        <label className="field" htmlFor="project-region">
          <span className="field-label">{t('project.region.select')}</span>
          <select id="project-region" name="project-region" className="input" value={content?.regionId ?? ''} disabled={busy} onChange={onSelect}>
            <option value="">{t('project.region.none')}</option>
            {REGIONS_KZ.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="section-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy || !props.source}
          onClick={detect}
        >
          {t('project.region.auto')}
        </button>
        {!props.source && (
          <span className="stat-line warn" style={{ marginTop: 0 }}>
            {t('project.region.needSource')}
          </span>
        )}
        {content && (
          <span className="stat-line" style={{ marginTop: 0 }}>
            {t(`project.region.source.${content.source}`)}
          </span>
        )}
      </div>

      {content && (
        <>
          <p className="field-label" style={{ marginTop: 16 }}>
            {t('project.region.defaultsTitle')}
          </p>
          <div className="kv-list">
            <div className="kv">
              <span className="kv-label">
                {t('project.region.seismic')} <NormBadge refs={['region.seismicMap']} />
              </span>
              <span className="kv-value">{valueLine(seismicPoints !== null ? String(seismicPoints) : null)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">
                {t('project.region.freezing')} <NormBadge refs={['region.freezing']} />
              </span>
              <span className="kv-value">{valueLine(freezingDepthM !== null ? freezingDepthM.toFixed(2) : null)}</span>
            </div>
            <div className="kv">
              <span className="kv-label">{t('project.region.hazards')}</span>
              <span className="kv-value">
                {regionHazards.length > 0
                  ? regionHazards.map((h) => t(`project.hazard.${h}`)).join(', ')
                  : t('project.region.noHazards')}
              </span>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {t('project.region.defaultsHint')}
          </p>
          <div className="section-actions">
            <button type="button" className="btn btn-sm" disabled={busy || !canApply} onClick={() => void apply()}>
              {t('project.region.apply')}
            </button>
            {notice === 'applied' && <span className="stat-line ok">{t('project.region.applied')}</span>}
            {notice === 'saved' && <span className="stat-line ok">{t('project.saved')}</span>}
          </div>
        </>
      )}

      {measures.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="field-label">{t('project.region.measuresTitle')}</p>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {measures.map((m) => (
              <p className={`stat-line${m.kind === 'warning' ? ' warn' : ''}`} key={m.code} style={{ marginTop: 0 }}>
                {t(`project.region.measure.${m.code}`)} <NormBadge refs={m.refs} basis={m.basis} />
              </p>
            ))}
          </div>
        </div>
      )}

      {notice === 'saveError' && <p className="notice error">{t('project.saveError')}</p>}
      {notice === 'migrationNeeded' && (
        <p className="notice error">{t('project.region.migrationNeeded')}</p>
      )}
    </Panel>
  )
}

export function SeismicSection(props: {
  projectId: string
  dataset: DatasetRow | undefined
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const content = (props.dataset?.content ?? {}) as {
    siteIntensityPoints?: number
    subsidenceProne?: boolean
    floodProne?: boolean
    hazards?: HazardKind[]
  }
  const [intensity, setIntensity] = useState(String(content.siteIntensityPoints ?? 6))
  const [subsidence, setSubsidence] = useState(Boolean(content.subsidenceProne))
  const [flood, setFlood] = useState(Boolean(content.floodProne))
  const [hazards, setHazards] = useState<HazardKind[]>(content.hazards ?? [])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    setIntensity(String(content.siteIntensityPoints ?? 6))
    setSubsidence(Boolean(content.subsidenceProne))
    setFlood(Boolean(content.floodProne))
    setHazards(content.hazards ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dataset?.id, props.dataset?.content])

  const toggleHazard = (hazard: HazardKind) => (e: ChangeEvent<HTMLInputElement>) => {
    setNotice(null)
    setHazards((prev) => (e.target.checked ? [...prev, hazard] : prev.filter((h) => h !== hazard)))
  }

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await saveDataset(props.projectId, 'seismic', {
        siteIntensityPoints: Number(intensity),
        subsidenceProne: subsidence,
        floodProne: flood,
        hazards: EXTRA_HAZARDS.filter((h) => hazards.includes(h)),
      })
      setNotice('saved')
      await props.onSaved()
    } catch {
      setNotice('saveError')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title={t('project.seismic.title')} status={props.dataset ? 'filled' : 'empty'}>
      <div className="form-grid">
        <label className="field" htmlFor="seismic-intensity">
          <span className="field-label">{t('project.seismic.intensity')}</span>
          <select id="seismic-intensity" name="seismic-intensity" className="input" value={intensity} onChange={(e) => setIntensity(e.target.value)}>
            {['6', '7', '8', '9'].map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </select>
        </label>
        <label className="check" htmlFor="seismic-subsidence">
          <input
            id="seismic-subsidence"
            name="seismic-subsidence"
            type="checkbox"
            checked={subsidence}
            onChange={(e) => setSubsidence(e.target.checked)}
          />
          <span>{t('project.seismic.subsidence')}</span>
        </label>
        <label className="check" htmlFor="seismic-flood">
          <input id="seismic-flood" name="seismic-flood" type="checkbox" checked={flood} onChange={(e) => setFlood(e.target.checked)} />
          <span>{t('project.seismic.flooding')}</span>
        </label>
      </div>
      <p className="field-label" style={{ marginTop: 12 }}>
        {t('project.seismic.hazardsTitle')}
      </p>
      <div className="form-grid" style={{ marginTop: 8 }}>
        {EXTRA_HAZARDS.map((hazard) => (
          <label className="check" htmlFor={`seismic-hazard-${hazard}`} key={hazard}>
            <input
              id={`seismic-hazard-${hazard}`}
              name={`seismic-hazard-${hazard}`}
              type="checkbox"
              checked={hazards.includes(hazard)}
              onChange={toggleHazard(hazard)}
            />
            <span>{t(`project.hazard.${hazard}`)}</span>
          </label>
        ))}
      </div>
      <SectionFooter busy={busy} notice={notice} onSave={() => void save()} />
    </Panel>
  )
}

export function NormsSection(props: {
  projectId: string
  dataset: DatasetRow | undefined
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const form = useDatasetForm(
    props.projectId,
    'normative',
    props.dataset,
    { ...NORMATIVE_DEFAULTS },
    props.onSaved,
  )
  // Метод — не число, поэтому в общий список числовых полей не входит.
  const fields: Array<{ key: 'perCapitaDemandLpd' | 'dayMaxCoefficient' | 'alphaMax'
    | 'fireFlowLps' | 'minFreeHeadBaseM' | 'freeHeadPerFloorM' | 'maxFreeHeadM'; label: string }> = [
    { key: 'perCapitaDemandLpd', label: 'perCapita' },
    { key: 'dayMaxCoefficient', label: 'kDayMax' },
    { key: 'alphaMax', label: 'alphaMax' },
    { key: 'fireFlowLps', label: 'fireFlow' },
    { key: 'minFreeHeadBaseM', label: 'minHead' },
    { key: 'freeHeadPerFloorM', label: 'perFloor' },
    { key: 'maxFreeHeadM', label: 'maxHead' },
  ]

  return (
    <Panel title={t('project.norms.title')} status={props.dataset ? 'filled' : 'default'}>
      <p className="hint">{t('project.norms.hint')}</p>
      <div className="form-grid">
        {fields.map(({ key, label }) => (
          <NumberField
            key={key}
            id={`normative-${key}`}
            label={t(`project.norms.${label}`)}
            value={form.values[key] ?? ''}
            onChange={form.set(key)}
          />
        ))}
      </div>
      <label className="field" htmlFor="normative-drainage-method">
        <span className="field-label">{t('project.norms.drainageMethod')}</span>
        <select
          id="normative-drainage-method"
          name="normative-drainage-method"
          className="input"
          value={String(form.values.drainageFlowMethod ?? 'water-demand')}
          onChange={form.set('drainageFlowMethod')}
        >
          <option value="water-demand">{t('project.norms.drainageByWater')}</option>
          <option value="kgen-table">{t('project.norms.drainageByKGen')}</option>
        </select>
      </label>
      <p className="hint">{t('project.norms.drainageMethodHint')}</p>

      <SectionFooter
        busy={form.busy}
        notice={form.notice}
        onSave={() => void form.save((v) => {
          const numbers = numbersOrNull(v, fields.map((f) => f.key))
          if (numbers === null) return null
          // Метод сохраняется как есть: приводить его к числу нечего.
          return { ...numbers, drainageFlowMethod: v.drainageFlowMethod ?? 'water-demand' }
        })}
      />
    </Panel>
  )
}
