import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './index.css'

type TaskSection = 'overdue' | 'dueSoon' | 'inProgress' | 'blocked' | 'active' | 'done'
type TaskFilter = 'all' | 'overdue' | 'dueSoon' | 'recurring' | 'inProgress' | 'active'
type DashboardView = 'home' | 'tasks' | 'projects' | 'notes' | 'people' | 'goals' | 'checkIns' | 'journal'
type DashboardCollection = 'tasks' | 'projects' | 'notes' | 'people' | 'goals' | 'checkIns' | 'journal'

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
  section: TaskSection
}

type ProjectTaskPreview = {
  id: string
  slug: string
  title: string
  status: string
  priority: string
  dueDate: string
  dueAt: string | null
  section: TaskSection
}

type Project = {
  id: string
  slug: string
  title: string
  status: string
  area: string
  priority: string
  targetDate: string
  updated: string
  tags: string[]
  link: string
  openTaskCount: number
  overdueTaskCount: number
  dueSoonTaskCount: number
  inProgressTaskCount: number
  nextAction: ProjectTaskPreview | null
  taskPreview: ProjectTaskPreview[]
}

type CollectionNote = {
  id: string
  slug: string
  title: string
  folder: Exclude<DashboardCollection, 'tasks' | 'projects'>
  type: string
  status: string
  updated: string
  tags: string[]
  link: string
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
    recurring: number
    active: number
    projects: number
  }
  contentCounts: Record<DashboardCollection, number>
  tasks: Task[]
  recurringTasks: Task[]
  projects: Project[]
  collections: Record<Exclude<DashboardCollection, 'tasks' | 'projects'>, CollectionNote[]>
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

type HermesActivityKind = 'status' | 'thinking' | 'tool_call' | 'tool_result' | 'log'

type HermesStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'session'; sessionId: string }
  | { type: 'activity'; kind: HermesActivityKind; message: string }
  | { type: 'result'; sessionId: string | null; reply: string }
  | { type: 'error'; message: string }

type HermesSessionStatus = 'running' | 'finished' | 'failed' | 'unknown'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type ActivityEntry = {
  id: string
  kind: HermesActivityKind
  message: string
}

type ChatFeedEntry =
  | ChatMessage
  | {
      id: string
      role: 'activity'
      kind: HermesActivityKind
      content: string
    }

type HermesSessionSnapshot = {
  sessionId: string
  noteSlug: string | null
  status: HermesSessionStatus
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>
  reply: string
  error: string | null
  updatedAt: string
}

type StoredChatState = {
  sessionId: string | null
  messages: ChatMessage[]
  activity: ActivityEntry[]
  error: string | null
  isSending: boolean
}

const taskFilterOptions: Array<{ key: TaskFilter; label: string; empty: string }> = [
  { key: 'all', label: 'All active', empty: 'No active tasks right now.' },
  { key: 'overdue', label: 'Overdue', empty: 'No overdue tasks.' },
  { key: 'dueSoon', label: 'Due soon', empty: 'Nothing due soon.' },
  { key: 'recurring', label: 'Recurring', empty: 'No recurring tasks found.' },
  { key: 'inProgress', label: 'In progress', empty: 'No tasks are in progress.' },
  { key: 'active', label: 'Other active', empty: 'No other active tasks.' },
]

const dashboardViews: Array<{ key: DashboardView; label: string; collection?: DashboardCollection }> = [
  { key: 'home', label: 'Home', collection: 'tasks' },
  { key: 'tasks', label: 'Tasks', collection: 'tasks' },
  { key: 'projects', label: 'Projects', collection: 'projects' },
  { key: 'notes', label: 'Notes', collection: 'notes' },
  { key: 'people', label: 'People', collection: 'people' },
  { key: 'goals', label: 'Goals', collection: 'goals' },
  { key: 'checkIns', label: 'Check-ins', collection: 'checkIns' },
  { key: 'journal', label: 'Journal', collection: 'journal' },
]

const VISIBLE_FRONTMATTER_KEYS = new Set(['type', 'status', 'updated', 'tags', 'project'])
const CHAT_STORAGE_PREFIX = 'lifeos-chat:'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardHome />} />
        <Route path="/note/:slug" element={<NoteDetailPage />} />
      </Routes>
    </BrowserRouter>
  )
}

function chatStorageKey(slug: string) {
  return `${CHAT_STORAGE_PREFIX}${slug}`
}

function readStoredChatState(slug: string): StoredChatState | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(chatStorageKey(slug))
    if (!raw) return null
    return JSON.parse(raw) as StoredChatState
  } catch {
    return null
  }
}

function writeStoredChatState(slug: string, state: StoredChatState) {
  if (typeof window === 'undefined') return

  const isEmpty = !state.sessionId && state.messages.length === 0 && state.activity.length === 0 && !state.error && !state.isSending
  if (isEmpty) {
    window.localStorage.removeItem(chatStorageKey(slug))
    return
  }

  window.localStorage.setItem(chatStorageKey(slug), JSON.stringify(state))
}

function hydrateSessionMessages(messages: Array<Pick<ChatMessage, 'role' | 'content'>>) {
  return messages.map((message, index) => ({
    id: `session-message-${index}`,
    role: message.role,
    content: message.content,
  }))
}

function createActivityEntry(kind: HermesActivityKind, message: string): ActivityEntry {
  return {
    id: `${Date.now()}-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    message,
  }
}

function mergeRecoveredMessages(current: ChatMessage[], recovered: Array<Pick<ChatMessage, 'role' | 'content'>>) {
  if (recovered.length === 0) return current
  return hydrateSessionMessages(recovered)
}

function hasActivityMessage(activity: ActivityEntry[], text: string) {
  return activity.some((entry) => entry.message === text)
}

function appendRecoveryActivity(current: ActivityEntry[], message: string) {
  if (hasActivityMessage(current, message)) return current
  return [...current, createActivityEntry('status', message)]
}

function parseDashboardView(value: string | null): DashboardView {
  return dashboardViews.some((entry) => entry.key === value) ? (value as DashboardView) : 'home'
}

function dashboardViewHref(view: DashboardView) {
  return view === 'home' ? '/' : `/?view=${view}`
}

function LifeOsChrome({
  activeView,
  counts,
  onViewChange,
}: {
  activeView?: DashboardView | null
  counts?: Partial<Record<DashboardCollection, number>>
  onViewChange?: (view: DashboardView) => void
}) {
  return (
    <div className="lifeos-chrome">
      <header className="dashboard-header">
        <Link to="/" aria-label="LifeOS home">
          <h1>LifeOS</h1>
        </Link>
      </header>

      <nav className="view-switcher" aria-label="LifeOS views">
        {dashboardViews.map((entry) => {
          const count = entry.collection && counts ? counts[entry.collection] : undefined
          const isActive = activeView === entry.key
          const className = isActive ? 'view-chip active' : 'view-chip'

          if (onViewChange) {
            return (
              <button key={entry.key} className={className} type="button" onClick={() => onViewChange(entry.key)}>
                <span>{entry.label}</span>
                {typeof count === 'number' ? <small>{count}</small> : null}
              </button>
            )
          }

          return (
            <Link key={entry.key} className={className} to={dashboardViewHref(entry.key)}>
              <span>{entry.label}</span>
              {typeof count === 'number' ? <small>{count}</small> : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

function DashboardHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseDashboardView(searchParams.get('view'))
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')
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

  const handleViewChange = useCallback(
    (nextView: DashboardView) => {
      const next = new URLSearchParams(searchParams)
      if (nextView === 'home') {
        next.delete('view')
      } else {
        next.set('view', nextView)
      }
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const selectedTaskFilter = taskFilterOptions.find((option) => option.key === taskFilter) ?? taskFilterOptions[0]
  const filteredTasks = useMemo(() => {
    if (!data) return []
    return filterTasks(data.tasks, data.recurringTasks, taskFilter)
  }, [data, taskFilter])

  return (
    <main className="app-shell dashboard-shell">
      <LifeOsChrome activeView={view} counts={data?.contentCounts} onViewChange={handleViewChange} />

      {loading && !data ? <StateCard title="Loading dashboard" body="Loading your notes…" /> : null}
      {error ? <StateCard title="Dashboard error" body={error} tone="error" /> : null}

      {data ? (
        <>
          {view === 'home' || view === 'tasks' ? (
            <TaskLens data={data} currentView={view} filter={taskFilter} onFilterChange={setTaskFilter} tasks={filteredTasks} emptyMessage={selectedTaskFilter.empty} />
          ) : null}

          {view === 'projects' ? <ProjectsView projects={data.projects} /> : null}

          {view !== 'home' && view !== 'tasks' && view !== 'projects' ? (
            <DefaultCollectionView view={view} count={data.contentCounts[viewToCollection(view)]} notes={data.collections[viewToCollectionCardsKey(view)]} />
          ) : null}
        </>
      ) : null}
    </main>
  )
}

function NoteDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [note, setNote] = useState<NoteDetail | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [chatError, setChatError] = useState<string | null>(null)
  const [chatSessionId, setChatSessionId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const [isChatManuallyOpen, setIsChatManuallyOpen] = useState(false)
  const streamAbortRef = useRef<AbortController | null>(null)

  const isChatOpen = isChatManuallyOpen || searchParams.get('chat') === '1'

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!slug) {
        if (!cancelled) {
          setNote(null)
          setError('Could not find that note.')
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        const response = await fetch(`/api/note/${encodeURIComponent(slug)}`)
        if (!response.ok) throw new Error(response.status === 404 ? 'Could not find that note.' : 'Could not load note view')
        const payload = (await response.json()) as NoteDetail
        if (!cancelled) {
          const restored = readStoredChatState(slug)
          setNote(payload)
          setError(null)
          setChatMessages(restored?.messages ?? [])
          setActivity(restored?.activity ?? [])
          setChatError(restored?.error ?? null)
          setChatSessionId(restored?.sessionId ?? null)
          setChatInput('')
          setIsSending(restored?.isSending ?? false)
          setIsChatManuallyOpen(Boolean(restored?.isSending))
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
      streamAbortRef.current?.abort()
    }
  }, [slug])

  useEffect(() => {
    if (!isChatOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isChatOpen])

  useEffect(() => {
    if (!slug) return
    writeStoredChatState(slug, {
      sessionId: chatSessionId,
      messages: chatMessages,
      activity,
      error: chatError,
      isSending,
    })
  }, [activity, chatError, chatMessages, chatSessionId, isSending, slug])

  const recoverChatSession = useCallback(async (reason: 'startup' | 'wake' | 'poll' | 'stream-error' = 'poll', sessionOverride?: string | null) => {
    const sessionToRecover = sessionOverride ?? chatSessionId
    if (!note || !sessionToRecover) return

    try {
      const response = await fetch(`/api/hermes/chat/session/${encodeURIComponent(sessionToRecover)}?noteSlug=${encodeURIComponent(note.slug)}`)
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Could not recover Hermes session')
      }

      const snapshot = (await response.json()) as HermesSessionSnapshot
      setChatSessionId(snapshot.sessionId)
      setChatMessages((current) => mergeRecoveredMessages(current, snapshot.messages))

      if (snapshot.status === 'running') {
        setIsSending(true)
        if (reason === 'wake' || reason === 'stream-error' || reason === 'startup') {
          setActivity((current) => appendRecoveryActivity(current, 'Recovered the session. Hermes is still running in the background.'))
        }
        setChatError(null)
        return
      }

      if (snapshot.status === 'finished') {
        setIsSending(false)
        setChatError(null)
        if (reason === 'wake' || reason === 'stream-error' || reason === 'startup') {
          setActivity((current) => appendRecoveryActivity(current, 'Reconnected cleanly and loaded the finished session.'))
        }
        return
      }

      if (snapshot.status === 'failed') {
        setIsSending(false)
        setChatError(snapshot.error || 'Hermes session failed.')
        return
      }

      if (reason !== 'poll') {
        setChatError('I kept the session id, but I could not tell yet whether Hermes finished or is still running.')
      }
    } catch (err) {
      if (reason !== 'poll') {
        setChatError(err instanceof Error ? err.message : 'Could not recover Hermes session')
      }
    }
  }, [chatSessionId, note])

  useEffect(() => {
    if (!note || !chatSessionId || !isSending) return undefined

    const maybeRecover = () => {
      if (document.visibilityState === 'visible') {
        void recoverChatSession('wake')
      }
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void recoverChatSession('poll')
      }
    }, 5000)

    window.addEventListener('focus', maybeRecover)
    document.addEventListener('visibilitychange', maybeRecover)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', maybeRecover)
      document.removeEventListener('visibilitychange', maybeRecover)
    }
  }, [chatSessionId, isSending, note, recoverChatSession])

  const visibleFrontmatter = (note?.frontmatter ?? []).filter((entry) => !VISIBLE_FRONTMATTER_KEYS.has(entry.key))

  const chatFeed = useMemo<ChatFeedEntry[]>(() => {
    const activityEntries: ChatFeedEntry[] = activity.map((entry) => ({
      id: entry.id,
      role: 'activity',
      kind: entry.kind,
      content: entry.message,
    }))

    return [...chatMessages, ...activityEntries].sort((a, b) => a.id.localeCompare(b.id))
  }, [activity, chatMessages])

  function openChatModal() {
    setIsChatManuallyOpen(true)
  }

  function closeChatModal() {
    setIsChatManuallyOpen(false)
    if (searchParams.get('chat') === '1') {
      const next = new URLSearchParams(searchParams)
      next.delete('chat')
      setSearchParams(next, { replace: true })
    }
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = chatInput.trim()
    if (!message || !note || isSending) return

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: message,
    }

    setChatMessages((current) => [...current, userMessage])
    setChatInput('')
    setChatError(null)
    setActivity([createActivityEntry('status', 'Queued your request. Booting Hermes…')])
    setIsSending(true)
    openChatModal()

    const abortController = new AbortController()
    streamAbortRef.current?.abort()
    streamAbortRef.current = abortController
    let activeSession = chatSessionId

    try {
      const response = await fetch('/api/hermes/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteSlug: note.slug,
          message,
          sessionId: chatSessionId,
        }),
        signal: abortController.signal,
      })

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Hermes did not answer')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          const eventPayload = JSON.parse(line) as HermesStreamEvent

          if (eventPayload.type === 'session') {
            activeSession = eventPayload.sessionId
            setChatSessionId(eventPayload.sessionId)
            continue
          }

          if (eventPayload.type === 'activity') {
            setActivity((current) => [...current, createActivityEntry(eventPayload.kind, eventPayload.message)])
            continue
          }

          if (eventPayload.type === 'status') {
            setActivity((current) => [...current, createActivityEntry('status', eventPayload.message)])
            continue
          }

          if (eventPayload.type === 'result') {
            if (eventPayload.sessionId) {
              activeSession = eventPayload.sessionId
              setChatSessionId(eventPayload.sessionId)
            }
            setChatMessages((current) => [
              ...current,
              {
                id: `${Date.now()}-assistant`,
                role: 'assistant',
                content: eventPayload.reply || 'Hermes finished but came back with no text. Amazing work, king.',
              },
            ])
            continue
          }

          if (eventPayload.type === 'error') {
            throw new Error(eventPayload.message)
          }
        }
      }
      setChatError(null)
      setIsSending(false)
    } catch (err) {
      if (abortController.signal.aborted) return

      if (activeSession) {
        setChatSessionId(activeSession)
        setIsSending(true)
        setChatError(null)
        setActivity((current) => appendRecoveryActivity(current, 'Live feed dropped. Recovering from the saved session…'))
        await recoverChatSession('stream-error', activeSession)
      } else {
        setChatError(err instanceof Error ? err.message : 'Hermes blew a fuse')
        setIsSending(false)
      }
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null
      }
    }
  }

  return (
    <main className="app-shell detail-shell">
      <LifeOsChrome />

      {loading ? <StateCard title="Loading note" body="Hang on, grabbing the markdown..." /> : null}
      {error ? <StateCard title="Could not load note" body={error} tone="error" /> : null}

      {note ? (
        <section className="section-card detail-card note-detail-card">
          <header className="note-detail-header">
            <div className="note-topbar-title">
              <h1>{note.title}</h1>
              {note.updated ? <p>Updated {note.updated}</p> : null}
            </div>
            <div className="note-topbar-actions">
              <button
                className={isChatOpen ? 'link-button compact-button note-action-button' : 'link-button ghost-button compact-button note-action-button'}
                type="button"
                onClick={() => (isChatOpen ? closeChatModal() : openChatModal())}
                aria-label={isChatOpen ? 'Hide Hermes chat' : 'Open Hermes chat'}
              >
                <span className="button-icon" aria-hidden="true">
                  💬
                </span>
                <span>Chat</span>
              </button>
              <a className="link-button compact-button note-action-button" href={note.obsidianLink} target="_blank" rel="noreferrer" aria-label={`Open ${note.title} in Obsidian`}>
                <span className="button-icon" aria-hidden="true">
                  ⬡
                </span>
                <span>Obsidian</span>
              </a>
            </div>
          </header>

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

          <article className="markdown-card inline-markdown-card">
            <MarkdownBody markdown={stripDuplicateTitleHeading(note.markdown, note.title)} />
          </article>
        </section>
      ) : null}

      {note && isChatOpen ? (
        <ChatModal
          note={note}
          input={chatInput}
          feed={chatFeed}
          isSending={isSending}
          sessionId={chatSessionId}
          error={chatError}
          onClose={closeChatModal}
          onInputChange={setChatInput}
          onSubmit={handleChatSubmit}
        />
      ) : null}
    </main>
  )
}

function ChatModal({
  note,
  input,
  feed,
  isSending,
  sessionId,
  error,
  onClose,
  onInputChange,
  onSubmit,
}: {
  note: NoteDetail
  input: string
  feed: ChatFeedEntry[]
  isSending: boolean
  sessionId: string | null
  error: string | null
  onClose: () => void
  onInputChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = transcriptRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [feed, isSending])

  return (
    <div className="chat-modal-overlay" onClick={onClose} role="presentation">
      <section
        className="chat-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Hermes chat for ${note.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="chat-modal-header">
          <div>
            <h2>Chat with Hermes</h2>
            <p>
              Working against <strong>{note.title}</strong>. Note context is attached automatically.
            </p>
          </div>
          <div className="chat-modal-header-actions">
            {sessionId ? <span className="chat-session-pill">Session {sessionId}</span> : null}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close chat">
              ✕
            </button>
          </div>
        </div>

        <div className="chat-transcript single-pane" ref={transcriptRef}>
          {feed.length === 0 ? (
            <p className="empty-message">Ask Hermes to summarize, plan, draft, or update this note.</p>
          ) : (
            feed.map((entry) => {
              if (entry.role === 'activity') {
                return (
                  <article key={entry.id} className={`activity-entry ${entry.kind}`}>
                    <span className="activity-pill">{labelForActivity(entry.kind)}</span>
                    <p>{entry.content}</p>
                  </article>
                )
              }

              return (
                <article key={entry.id} className={entry.role === 'assistant' ? 'chat-bubble assistant' : 'chat-bubble user'}>
                  <span className="chat-role">{entry.role === 'assistant' ? 'Hermes' : 'You'}</span>
                  <MarkdownBody markdown={entry.content} />
                </article>
              )
            })
          )}
          {isSending ? <p className="chat-status">Hermes is working…</p> : null}
        </div>

        {error ? <p className="chat-error">{error}</p> : null}

        <form className="chat-form chat-modal-form" onSubmit={onSubmit}>
          <textarea
            className="chat-input"
            rows={4}
            placeholder="Message Hermes about this note..."
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
          />
          <div className="chat-form-footer">
            <button className="link-button" type="submit" disabled={isSending || !input.trim()}>
              {isSending ? 'Running…' : 'Send to Hermes'}
            </button>
          </div>
        </form>
      </section>
    </div>
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

function filterTasks(tasks: Task[], recurringTasks: Task[], filter: TaskFilter) {
  const activeTasks = tasks.filter((task) => task.section !== 'done' && task.section !== 'blocked')

  switch (filter) {
    case 'overdue':
      return tasks.filter((task) => task.section === 'overdue')
    case 'dueSoon':
      return tasks.filter((task) => task.section === 'dueSoon')
    case 'recurring':
      return recurringTasks.filter((task) => task.section !== 'done')
    case 'inProgress':
      return tasks.filter((task) => task.section === 'inProgress')
    case 'active':
      return tasks.filter((task) => task.section === 'active')
    default:
      return activeTasks
  }
}

function taskFilterCount(data: DashboardPayload, filter: TaskFilter) {
  switch (filter) {
    case 'overdue':
      return data.summary.overdue
    case 'dueSoon':
      return data.summary.dueSoon
    case 'recurring':
      return data.summary.recurring
    case 'inProgress':
      return data.summary.inProgress
    case 'active':
      return data.summary.active
    default:
      return data.tasks.filter((task) => task.section !== 'done' && task.section !== 'blocked').length
  }
}

function taskFilterHeading(filter: TaskFilter) {
  switch (filter) {
    case 'overdue':
      return 'Overdue'
    case 'dueSoon':
      return 'Due soon'
    case 'recurring':
      return 'Recurring'
    case 'inProgress':
      return 'In progress'
    case 'active':
      return 'Other active'
    default:
      return 'Active tasks'
  }
}

function viewToCollection(view: DashboardView): DashboardCollection {
  switch (view) {
    case 'home':
      return 'tasks'
    case 'tasks':
      return 'tasks'
    case 'projects':
      return 'projects'
    case 'checkIns':
      return 'checkIns'
    case 'journal':
      return 'journal'
    case 'notes':
      return 'notes'
    case 'people':
      return 'people'
    case 'goals':
      return 'goals'
  }
}

function viewToCollectionCardsKey(view: Exclude<DashboardView, 'home' | 'tasks' | 'projects'>): Exclude<DashboardCollection, 'tasks' | 'projects'> {
  switch (view) {
    case 'checkIns':
      return 'checkIns'
    case 'journal':
      return 'journal'
    case 'notes':
      return 'notes'
    case 'people':
      return 'people'
    case 'goals':
      return 'goals'
  }
}

function collectionLabel(view: Exclude<DashboardView, 'home' | 'tasks' | 'projects'>) {
  return dashboardViews.find((entry) => entry.key === view)?.label ?? humanize(view)
}

function TaskLens({
  data,
  currentView,
  filter,
  onFilterChange,
  tasks,
  emptyMessage,
}: {
  data: DashboardPayload
  currentView: 'home' | 'tasks'
  filter: TaskFilter
  onFilterChange: (filter: TaskFilter) => void
  tasks: Task[]
  emptyMessage: string
}) {
  const heading = currentView === 'home' ? 'Home' : 'Tasks'

  return (
    <section className="content-stack">
      <SectionCard title={heading} count={tasks.length}>
        <div className="filter-chip-row" role="tablist" aria-label="Task filters">
          {taskFilterOptions.map((option) => (
            <button
              key={option.key}
              className={filter === option.key ? 'filter-chip active' : 'filter-chip'}
              type="button"
              onClick={() => onFilterChange(option.key)}
            >
              <span>{option.label}</span>
              <strong>{taskFilterCount(data, option.key)}</strong>
            </button>
          ))}
        </div>

        <div className="inline-section-head">
          <h3>{taskFilterHeading(filter)}</h3>
          <p>{tasks.length} item{tasks.length === 1 ? '' : 's'}</p>
        </div>

        {tasks.length === 0 ? <EmptyMessage message={emptyMessage} /> : tasks.map((task) => <TaskCard key={task.id} task={task} />)}
      </SectionCard>
    </section>
  )
}

function ProjectsView({ projects }: { projects: Project[] }) {
  return (
    <section className="content-stack">
      <SectionCard title="Projects" count={projects.length}>
        {projects.length === 0 ? (
          <EmptyMessage message="No active projects found." />
        ) : (
          projects.map((project) => <ProjectCard key={project.id} project={project} />)
        )}
      </SectionCard>
    </section>
  )
}

function DefaultCollectionView({
  view,
  count,
  notes,
}: {
  view: Exclude<DashboardView, 'home' | 'tasks' | 'projects'>
  count: number
  notes: CollectionNote[]
}) {
  const label = collectionLabel(view)

  return (
    <section className="content-stack">
      <SectionCard title={label} count={count}>
        {notes.length === 0 ? <EmptyMessage message={`No ${label.toLowerCase()} found.`} /> : notes.map((note) => <CollectionNoteCard key={note.id} note={note} />)}
      </SectionCard>
    </section>
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

const SectionCard = forwardRef<HTMLElement, { title: string; count: number; children: React.ReactNode; highlighted?: boolean; subtitle?: string }>(
  function SectionCard({ title, count, children, highlighted = false, subtitle }, ref) {
    return (
      <section className={highlighted ? 'section-card highlighted-section' : 'section-card'} ref={ref}>
        <div className="section-header">
          <div>
            <h2>{title}</h2>
            <p>{count} item{count === 1 ? '' : 's'}</p>
          </div>
          {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
        </div>
        <div className="section-body">{children}</div>
      </section>
    )
  },
)

function EmptyMessage({ message }: { message: string }) {
  return <p className="empty-message">{message}</p>
}

function CollectionNoteCard({ note }: { note: CollectionNote }) {
  return (
    <article className="item-card">
      <div className="item-topline">
        <div className="item-heading-group">
          <div className="item-title-row">
            <Link className="item-title-link" to={`/note/${note.slug}`}>
              <h3>{note.title}</h3>
            </Link>
          </div>
          <p className="subtle-text">{humanize(note.folder)}</p>
        </div>
        {note.status ? <Badge>{note.status}</Badge> : null}
      </div>

      <div className="chip-row">
        <Chip>{humanize(note.type)}</Chip>
        {note.tags.slice(0, 4).map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>

      <dl className="meta-list">
        <div>
          <dt>Updated</dt>
          <dd>{note.updated || 'Unknown'}</dd>
        </div>
      </dl>
    </article>
  )
}

function TaskCard({ task }: { task: Task }) {
  return (
    <article className="item-card">
      <div className="item-topline">
        <div className="item-heading-group">
          <div className="item-title-row">
            <Link className="item-title-link" to={`/note/${task.slug}`}>
              <h3>{task.title}</h3>
            </Link>
            <Link className="mini-icon-button" to={`/note/${task.slug}?chat=1`} aria-label={`Chat about ${task.title}`} title="Chat about this note">
              💬
            </Link>
          </div>
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
    </article>
  )
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="item-card project-card">
      <div className="item-topline">
        <div className="item-heading-group">
          <div className="item-title-row">
            <Link className="item-title-link" to={`/note/${project.slug}`}>
              <h3>{project.title}</h3>
            </Link>
            <Link className="mini-icon-button" to={`/note/${project.slug}?chat=1`} aria-label={`Chat about ${project.title}`} title="Chat about this note">
              💬
            </Link>
          </div>
          <p className="subtle-text">{project.updated ? `Updated ${project.updated}` : 'Active project'}</p>
        </div>
        <Badge>{project.status || 'active'}</Badge>
      </div>

      <div className="chip-row">
        {project.priority ? <Chip>{project.priority.toUpperCase()}</Chip> : null}
        {project.area ? <Chip>{project.area}</Chip> : null}
        {project.targetDate ? <Chip>Target {project.targetDate}</Chip> : null}
        {project.tags.slice(0, 3).map((tag) => (
          <Chip key={tag}>#{tag}</Chip>
        ))}
      </div>

      <div className="project-stats">
        <StatBubble label="Open" value={project.openTaskCount} />
        <StatBubble label="Overdue" value={project.overdueTaskCount} accent="danger" />
        <StatBubble label="Due soon" value={project.dueSoonTaskCount} accent="warn" />
        <StatBubble label="In progress" value={project.inProgressTaskCount} accent="info" />
      </div>

      <div className="next-action-card">
        <span className="next-action-label">Next likely action</span>
        {project.nextAction ? (
          <div className="next-action-body">
            <Link className="inline-link" to={`/note/${project.nextAction.slug}`}>
              {project.nextAction.title}
            </Link>
            <p className="subtle-text">{project.nextAction.dueDate || humanize(project.nextAction.section)}</p>
          </div>
        ) : (
          <p>No clear next action yet. Which usually means the project note needs some love.</p>
        )}
      </div>

      {project.taskPreview.length > 0 ? (
        <div className="compact-list">
          {project.taskPreview.map((task) => (
            <div key={task.id} className="compact-list-row">
              <Link className="inline-link compact-link" to={`/note/${task.slug}`}>
                {task.title}
              </Link>
              <span>{task.dueDate || humanize(task.section)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function StatBubble({
  label,
  value,
  accent = 'neutral',
}: {
  label: string
  value: number
  accent?: 'neutral' | 'danger' | 'warn' | 'info'
}) {
  return (
    <div className={`stat-bubble ${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="badge">{children}</span>
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip">{children}</span>
}

function humanize(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function stripDuplicateTitleHeading(markdown: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const duplicateTitlePattern = new RegExp(`^\\s*#\\s+${escapedTitle}\\s*(?:\\n|$)`, 'i')
  return markdown.replace(duplicateTitlePattern, '').trimStart()
}

function labelForActivity(kind: HermesActivityKind) {
  switch (kind) {
    case 'status':
      return 'Status'
    case 'thinking':
      return 'Thinking'
    case 'tool_call':
      return 'Tool call'
    case 'tool_result':
      return 'Tool result'
    default:
      return 'Log'
  }
}

export default App
