import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { traceNetwork } from '@aquascheme/engine'
import type { SurveyPoint } from '@aquascheme/engine'
import { replaceNetwork } from '../../shared/network'
import type { NodeRow, PipeRow } from '../../shared/network'
import type { BuildingRow } from '../../shared/datasets'
import type { SourceData } from '../../shared/datasets'
import { Panel } from './Panel'

export function TraceSection({
  projectId,
  buildings,
  source,
  points,
  nodes,
  pipes,
  onChanged,
}: {
  projectId: string
  buildings: BuildingRow[]
  source: SourceData | null
  points: SurveyPoint[]
  nodes: NodeRow[]
  pipes: PipeRow[]
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'done' | 'error' | null>(null)

  const canTrace = buildings.length > 0 && source !== null

  const run = async () => {
    if (!canTrace || busy || !source) return
    setBusy(true)
    setNotice(null)
    try {
      const network = traceNetwork(
        buildings.map((b) => ({ id: b.id, x: b.x, y: b.y })),
        { x: source.x, y: source.y },
        points,
      )
      await replaceNetwork(projectId, network)
      setNotice('done')
      await onChanged()
    } catch {
      setNotice('error')
    } finally {
      setBusy(false)
    }
  }

  const totalLength = pipes.reduce((sum, p) => sum + (p.length_m ?? 0), 0)

  return (
    <Panel title={t('project.trace.title')} status={pipes.length > 0 ? 'filled' : 'empty'}>
      <p className="hint">{t('project.trace.hint')}</p>
      <div className="section-actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canTrace || busy}
          onClick={() => void run()}
        >
          {t('project.trace.run')}
        </button>
        {!canTrace && (
          <span className="stat-line warn" style={{ marginTop: 0 }}>
            {t('project.trace.needData')}
          </span>
        )}
        {notice === 'done' && <span className="stat-line ok">{t('project.trace.done')}</span>}
      </div>
      {pipes.length > 0 && (
        <p className="stat-line">
          {t('project.trace.stats', {
            nodes: nodes.length,
            pipes: pipes.length,
            length: Math.round(totalLength),
          })}
        </p>
      )}
      {notice === 'error' && <p className="notice error">{t('project.trace.error')}</p>}
    </Panel>
  )
}
