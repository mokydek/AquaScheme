import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../shared/supabase'

interface ProjectRow {
  id: string
  name: string
  created_at: string
  work_type?: string | null
  system_type?: string | null
}

const DATE_LOCALES: Record<string, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }
const SYSTEM_MARKS: Record<string, string> = { water: 'В1', sewer: 'К1', storm: 'К2' }

export function AppHome() {
  const { t, i18n } = useTranslation()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [failed, setFailed] = useState(false)

  const load = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      setFailed(true)
      return
    }
    setFailed(false)
    setProjects((data ?? []) as ProjectRow[])
  }

  useEffect(() => {
    void load()
  }, [])

  const removeProject = async (project: ProjectRow) => {
    if (!window.confirm(t('app.confirmDelete', { name: project.name }))) return
    await supabase.from('projects').delete().eq('id', project.id)
    void load()
  }

  const dateLocale = DATE_LOCALES[i18n.language] ?? 'ru-RU'

  return (
    <section className="page">
      <div className="container">
        <h1>{t('app.title')}</h1>
        <div className="toolbar">
          <Link to="/app/new" className="btn btn-sm">
            {t('app.newProject')}
          </Link>
        </div>
        {failed && <p className="notice error">{t('app.loadError')}</p>}
        {!failed && projects.length === 0 && <p className="hint">{t('app.empty')}</p>}
        {projects.length > 0 && (
          <div className="row-list">
            {projects.map((project) => (
              <div className="row" key={project.id}>
                <Link className="row-name" to={`/app/projects/${project.id}`}>
                  {project.name}
                </Link>
                <div className="row-actions">
                  <span className="badge">{SYSTEM_MARKS[project.system_type ?? 'water'] ?? 'В1'}</span>
                  <span className="row-meta">
                    {new Date(project.created_at).toLocaleDateString(dateLocale)}
                  </span>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => void removeProject(project)}
                  >
                    {t('app.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
