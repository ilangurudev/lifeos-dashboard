import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './index.css'

type Task = {
  id: string
  slug: string
  title: string
  status: string
  priority: string
  area: string
  energyRequired: string
  timeRequired: string
  recurrence: string
  project: string | null
  dueDate: string
  dueAt: string | null
  nextReminderTime: string
  updated: string
  tags: string[]
  link: string
  section: 'overdue' | 'dueSoon' | 'inProgress' | 'blocked' | 'active' | 'done'
}

type Project = {
  id: string
  slug: string
  title: string
  status: string
  targetDate: string
  updated: string
  tags: string[]
  link: string
  openTaskCount: number
  overdueTaskCount: number
  dueSoonTaskCount: number
  inProgressTaskCount: number
  tasks: Task[]
  nextAction: Task | null
}

type DashboardPayload = {
  generatedAt: string
  lifeOsRoot: string
  summary: {
    tasks: number
    overdue: number
    dueSoon: number
    inProgress: number
    blocked: number
    activeProjects: number
  }
  tasks: Task[]
  projects: Project[]
}

type FrontmatterEntry = {
  key: string
  label: string
  value: string
}

type NoteDetail = {
  id: string
  slug: string
  title: string
  folder: string
  type: string
  status: string
  updated: string
  tags: string[]
  project: string | null
  obsidianLink: string
  appLink: string
  frontmatter: FrontmatterEntry[]
  markdown: string
}

type Tab = 'tasks' | 'projects'

const taskSections: Array<{ key: Task['section']; title: string; empty: string }> = [
  { key: 'overdue', title: 'Overdue', empty: 'No overdue chaos. Nice.' },
  { key: 'dueSoon', title: 'Due soon', empty: 'Nothing urgent breathing down your neck.' },
  { key: 'inProgress', title: 'In progress', empty: 'No active task currently in motion.' },
  { key: 'blocked', title: 'Blocked', empty: 'Nothing blocked right now.' },
  { key: 'active', title: 'Other active tasks', empty: 'That is... suspiciously clean.' },
]

const VISIBLE_FRONTMATTER_KEYS = new Set(['type', 'status', 'updated', 'tags', 'project'])

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardHome />} />
        <Route path="/note/:slug" element={<NotePage />} />
      </Routes>
    </BrowserRouter>
  )
}

function DashboardHome() {
  const [tab, setTab] = useState<Tab>('tasks')
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const response = await fetch('/api/dashboard')
        if (!response.ok) throw new Error('Could not load dashboard data')
        const payload = (await response.json()) as DashboardPayload
        if (!cancelled) {
          setData(payload)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown dashboard failure')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const intervalId = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const activeProjects = useMemo(
    () => (data?.projects ?? []).filter((project) => project.status === 'active'),
    [data],
  )

  return (
    <main className="app-shell">
      <AppHeader title="LifeOS" subtitle={data?.generatedAt ? `Updated ${formatDateTime(data.generatedAt)}` : undefined} />

      {loading && !data ? <StateCard title="Loading dashboard" body="Pulling your Life OS notes into shape…" /> : null}
      {error ? <StateCard title="Dashboard faceplanted" body={error} tone="error" /> : null}

      {data ? (
        <>
          <section className="summary-grid">
            <SummaryCard label="Overdue" value={data.summary.overdue} accent="danger" />
            <SummaryCard label="Due soon" value={data.summary.dueSoon} accent="warn" />
            <SummaryCard label="In progress" value={data.summary.inProgress} accent="info" />
            <SummaryCard label="Projects" value={data.summary.activeProjects} accent="neutral" />
          </section>

          <nav className="tab-bar" aria-label="Dashboard tabs">
            <button className={tab === 'tasks' ? 'tab active' : 'tab'} onClick={() => setTab('tasks')}>
              Tasks
            </button>
            <button className={tab === 'projects' ? 'tab active' : 'tab'} onClick={() => setTab('projects')}>
              Projects
            </button>
          </nav>

          {tab === 'tasks' ? (
            <section className="content-stack">
              {taskSections.map((section) => {
                const tasks = data.tasks.filter((task) => task.section === section.key)
                return (
                  <SectionCard key={section.key} title={section.title} count={tasks.length}>
                    {tasks.length === 0 ? (
                      <EmptyMessage message={section.empty} />
                    ) : (
                      tasks.map((task) => <TaskCard key={task.id} task={task} />)
                    )}
                  </SectionCard>
                )
              })}
            </section>
          ) : (
            <section className="content-stack">
              <SectionCard title="Active projects" count={activeProjects.length}>
                {activeProjects.length === 0 ? (
                  <EmptyMessage message="No active projects found. Either you are perfectly serene or the metadata is lying." />
                ) : (
                  activeProjects.map((project) => <ProjectCard key={project.id} project={project} />)
                )}
              </SectionCard>
            </section>
          )}
        </>
      ) : null}
    </main>
  )
}

function NotePage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [note, setNote] = useState<NoteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        const response = await fetch(`/api/note/${encodeURIComponent(slug)}`)
        if (!response.ok) throw new Error(response.status === 404 ? 'Could not find that note.' : 'Could not load note view')
        const payload = (await response.json()) as NoteDetail
        if (!cancelled) {
          setNote(payload)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown note failure')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    window.scrollTo(0, 0)
    void load()
    return () => {
      cancelled = true
    }
  }, [slug])

  const visibleFrontmatter = useMemo(
    () => (note?.frontmatter ?? []).filter((entry) => !VISIBLE_FRONTMATTER_KEYS.has(entry.key)),
    [note],
  )

  return (
    <main className="app-shell detail-shell">
      <div className="note-topbar">
        <button className="icon-button" type="button" onClick={() => navigate(-1)} aria-label="Go back">
          ←
        </button>
        <div className="note-topbar-title">
          <h1>{note?.title ?? 'Loading…'}</h1>
          {note?.updated ? <p>Updated {note.updated}</p> : null}
        </div>
        <div className="note-topbar-actions">
          <Link className="link-button ghost-button compact-button" to="/">
            Dashboard
          </Link>
          {note ? (
            <a className="link-button compact-button" href={note.obsidianLink} target="_blank" rel="noreferrer">
              Obsidian
            </a>
          ) : null}
        </div>
      </div>

      {loading ? <StateCard title="Loading note" body="Hang on, grabbing the markdown..." /> : null}
      {error ? <StateCard title="Could not load note" body={error} tone="error" /> : null}

      {note ? (
        <section className="section-card detail-card">
          <div className="detail-header">
            <div className="chip-row">
              {note.type ? <Chip>{humanize(note.type)}</Chip> : null}
              {note.status ? <Badge>{note.status}</Badge> : null}
              {note.project ? <Chip>Project: {humanize(note.project)}</Chip> : null}
            </div>
            {note.tags.length > 0 ? (
              <div className="chip-row">
                {note.tags.map((tag) => (
                  <Chip key={tag}>#{tag}</Chip>
                ))}
              </div>
            ) : null}
          </div>

          {visibleFrontmatter.length > 0 ? <FrontmatterPanel entries={visibleFrontmatter} /> : null}

          <article className="markdown-card">
            <MarkdownBody markdown={note.markdown} />
          </article>
        </section>
      ) : null}
    </main>
  )
}

function FrontmatterPanel({ entries }: { entries: FrontmatterEntry[] }) {
  return (
    <details className="frontmatter-panel">
      <summary>
        <span>Frontmatter</span>
        <span>{entries.length} field{entries.length === 1 ? '' : 's'}</span>
      </summary>
      <dl className="frontmatter-list">
        {entries.map((entry) => (
          <div key={entry.key} className="frontmatter-row">
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function MarkdownBody({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href = '', children, ...props }) => {
          if (href.startsWith('/note/')) {
            return (
              <NavLink className="inline-link" to={href} {...props}>
                {children}
              </NavLink>
            )
          }

          return (
            <a className="inline-link" href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          )
        },
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
}

function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="app-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </header>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <article className={`summary-card ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

function StateCard({ title, body, tone = 'neutral' }: { title: string; body: string; tone?: 'neutral' | 'error' }) {
  return (
    <section className={`state-card ${tone}`}>
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  )
}

function SectionCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="section-card">
      <div className="section-header">
        <div>
          <h2>{title}</h2>
          <p>{count} item{count === 1 ? '' : 's'}</p>
        </div>
      </div>
      <div className="section-body">{children}</div>
    </section>
  )
}

function EmptyMessage({ message }: { message: string }) {
  return <p className="empty-message">{message}</p>
}

function TaskCard({ task }: { task: Task }) {
  return (
    <article className="item-card">
      <div className="item-topline">
        <div>
          <h3>{task.title}</h3>
          <p className="subtle-text">{task.project ? `Project: ${humanize(task.project)}` : 'Standalone task'}</p>
        </div>
        <Badge>{task.status}</Badge>
      </div>

      <div className="chip-row">
        {task.priority ? <Chip>{task.priority.toUpperCase()}</Chip> : null}
        {task.area ? <Chip>{task.area}</Chip> : null}
        {task.energyRequired ? <Chip>{task.energyRequired} energy</Chip> : null}
        {task.timeRequired ? <Chip>{task.timeRequired}</Chip> : null}
        {task.recurrence ? <Chip>{task.recurrence}</Chip> : null}
      </div>

      <dl className="meta-list">
        <div>
          <dt>Due</dt>
          <dd>{task.dueDate || task.nextReminderTime || 'No due date'}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{task.updated || 'Unknown'}</dd>
        </div>
      </dl>

      <div className="action-row">
        <Link className="link-button" to={`/note/${task.slug}`}>
          View in app
        </Link>
        <a className="link-button ghost-button" href={task.link} target="_blank" rel="noreferrer">
          Obsidian
        </a>
      </div>
    </article>
  )
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="item-card">
      <div className="item-topline">
        <div>
          <h3>{project.title}</h3>
          <p className="subtle-text">Updated {project.updated || 'unknown time ago'}</p>
        </div>
        <Badge>{project.status}</Badge>
      </div>

      <div className="project-stats">
        <StatBubble label="Open" value={project.openTaskCount} />
        <StatBubble label="Overdue" value={project.overdueTaskCount} danger={project.overdueTaskCount > 0} />
        <StatBubble label="Due soon" value={project.dueSoonTaskCount} />
        <StatBubble label="Moving" value={project.inProgressTaskCount} />
      </div>

      <div className="next-action-card">
        <span className="next-action-label">Next likely action</span>
        {project.nextAction ? (
          <>
            <strong>{project.nextAction.title}</strong>
            <p>
              {project.nextAction.dueDate || project.nextAction.nextReminderTime || 'No due date'} ·{' '}
              {project.nextAction.priority ? project.nextAction.priority.toUpperCase() : 'No priority'}
            </p>
          </>
        ) : (
          <p>No linked active task yet.</p>
        )}
      </div>

      {project.tasks.length > 0 ? (
        <div className="compact-list">
          {project.tasks.slice(0, 3).map((task) => (
            <div className="compact-list-row" key={task.id}>
              <span>{task.title}</span>
              <span>{task.status}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="action-row">
        <Link className="link-button" to={`/note/${project.slug}`}>
          View in app
        </Link>
        <a className="link-button ghost-button" href={project.link} target="_blank" rel="noreferrer">
          Obsidian
        </a>
      </div>
    </article>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>
}

function StatBubble({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={danger ? 'stat-bubble danger' : 'stat-bubble'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function humanize(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export default App
