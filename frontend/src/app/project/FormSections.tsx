import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_FREEZING_DEPTH_M, NORMATIVE_DEFAULTS } from '@aquascheme/engine'
import { saveDataset } from '../../shared/datasets'
import type { DatasetKind, DatasetRow } from '../../shared/datasets'
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
      await saveDataset(projectId, kind, content)
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
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="input" inputMode="decimal" value={value} onChange={onChange} />
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

export function GeologySection(props: {
  projectId: string
  dataset: DatasetRow | undefined
  onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const form = useDatasetForm(
    props.projectId,
    'geology',
    props.dataset,
    {
      soilType: 'loam',
      groundwaterDepthM: '',
      corrosivity: 'medium',
      freezingDepthM: DEFAULT_FREEZING_DEPTH_M,
    },
    props.onSaved,
  )

  return (
    <Panel title={t('project.geology.title')} status={props.dataset ? 'filled' : 'empty'}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">{t('project.geology.soil')}</span>
          <select className="input" value={form.values.soilType} onChange={form.set('soilType')}>
            {(['sand', 'loam', 'clay', 'rock'] as const).map((soil) => (
              <option key={soil} value={soil}>
                {t(`project.geology.soils.${soil}`)}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label={t('project.geology.groundwater')}
          value={form.values.groundwaterDepthM ?? ''}
          onChange={form.set('groundwaterDepthM')}
        />
        <label className="field">
          <span className="field-label">{t('project.geology.corrosivity')}</span>
          <select
            className="input"
            value={form.values.corrosivity}
            onChange={form.set('corrosivity')}
          >
            {(['low', 'medium', 'high'] as const).map((level) => (
              <option key={level} value={level}>
                {t(`project.geology.corrosivityLevels.${level}`)}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label={t('project.geology.freezing')}
          value={form.values.freezingDepthM ?? ''}
          onChange={form.set('freezingDepthM')}
        />
      </div>
      <SectionFooter
        busy={form.busy}
        notice={form.notice}
        onSave={() =>
          void form.save((v) => {
            const numbers = numbersOrNull(v, ['groundwaterDepthM', 'freezingDepthM'])
            if (!numbers) return null
            return { ...numbers, soilType: v.soilType, corrosivity: v.corrosivity }
          })
        }
      />
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
  }
  const [intensity, setIntensity] = useState(String(content.siteIntensityPoints ?? 6))
  const [subsidence, setSubsidence] = useState(Boolean(content.subsidenceProne))
  const [flood, setFlood] = useState(Boolean(content.floodProne))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  useEffect(() => {
    setIntensity(String(content.siteIntensityPoints ?? 6))
    setSubsidence(Boolean(content.subsidenceProne))
    setFlood(Boolean(content.floodProne))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.dataset?.id, props.dataset?.content])

  const save = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await saveDataset(props.projectId, 'seismic', {
        siteIntensityPoints: Number(intensity),
        subsidenceProne: subsidence,
        floodProne: flood,
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
        <label className="field">
          <span className="field-label">{t('project.seismic.intensity')}</span>
          <select className="input" value={intensity} onChange={(e) => setIntensity(e.target.value)}>
            {['6', '7', '8', '9'].map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={subsidence}
            onChange={(e) => setSubsidence(e.target.checked)}
          />
          <span>{t('project.seismic.subsidence')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={flood} onChange={(e) => setFlood(e.target.checked)} />
          <span>{t('project.seismic.flooding')}</span>
        </label>
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
  const fields: Array<{ key: keyof typeof NORMATIVE_DEFAULTS; label: string }> = [
    { key: 'perCapitaDemandLpd', label: 'perCapita' },
    { key: 'dayMaxCoefficient', label: 'kDayMax' },
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
            label={t(`project.norms.${label}`)}
            value={form.values[key] ?? ''}
            onChange={form.set(key)}
          />
        ))}
      </div>
      <SectionFooter
        busy={form.busy}
        notice={form.notice}
        onSave={() => void form.save((v) => numbersOrNull(v, fields.map((f) => f.key)))}
      />
    </Panel>
  )
}
