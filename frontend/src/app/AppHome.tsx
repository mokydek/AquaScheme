import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../shared/supabase'
import { useAuth } from '../shared/auth'

interface ProjectRow {
  id: string
  name: string
  created_at: string
}

const DATE_LOCALES: Record<string, string> = { ru: 'ru-RU', kk: 'kk-KZ', en: 'en-GB' }

export function AppHome() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [failed, setFailed] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('id,name,created_at')
      .order('created_at', { ascending: false })
    if (error) {
      setFailed(true)
      return
    }
    setFailed(false)
    setProjects(data ?? [])
  }

  useEffect(() => {
    void load()
  }, [])

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!session || !name.trim() || busy) return
    setBusy(true)
    const { data, error } = await supabase
      .from('projects')
      .insert({ name: name.trim(), owner_id: session.user.id })
      .select('id')
      .single()
    setBusy(false)
    if (!error && data) navigate(`/app/projects/${data.id}`)
  }

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
        <form className="toolbar" onSubmit={(e) => void createProject(e)}>
          <input
            className="input toolbar-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('app.namePlaceholder')}
            required
          />
          <button className="btn btn-sm" type="submit" disabled={busy}>
            {t('app.create')}
          </button>
        </form>
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
