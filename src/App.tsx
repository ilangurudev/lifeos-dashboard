import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatDashboardDate } from './dateFormat'
import { internalNotePathFromHref } from './markdownLinks'
import './index.css'

type TaskSection = 'overdue' | 'dueSoon' | 'blocked' | 'active' | 'done'
type CalendarBucket = 'today' | 'tomorrow' | 'upcomingWeek' | 'oneToThreeWeeks' | 'moreThanMonth' | 'unscheduled'
type DateBasis = 'reminder' | 'due' | 'none'
type TaskFilter = 'calendar' | 'overdue' | 'dueSoon' | 'recurring' | 'allActive'
type DashboardView = 'home' | 'tasks' | 'projects' | 'notes' | 'people' | 'goals' | 'checkIns' | 'journal' | 'agentNotes'
type DashboardCollection = 'tasks' | 'projects' | 'notes' | 'people' | 'goals' | 'checkIns' | 'journal' | 'agentNotes'

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
  reminderAt: string | null
  completedAt: string | null
  nextActionAt: string | null
  dateBasis: DateBasis
  calendarBucket: CalendarBucket
  nextReminderTime: string
  completedTime: string
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
  nextActionAt: string | null
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
  folder: string
  type: string
  status: string
  updated: string
  tags: string[]
  link: string
  relativePath: string
  appPath: string
}

type AgentNote = CollectionNote & {
  sectionId: string
  sectionLabel: string
}

type AgentNotesPayload = {
  enabled: boolean
  label: string
  count: number
  sections: Array<{ id: string; label: string; notes: AgentNote[] }>
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
  collections: Record<Exclude<DashboardCollection, 'tasks' | 'projects' | 'agentNotes'>, CollectionNote[]>
  agentNotes: AgentNotesPayload
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
  relativePath: string
}

type ChatSubject = {
  title: string
  slug?: string
  relativePath?: string
  isGeneral?: boolean
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

type SearchResult = {
  slug: string
  title: string
  folder: string
  relativePath: string
  appPath: string
  updated: string
}

const taskFilterOptions: Array<{ key: TaskFilter; label: string; empty: string }> = [
  { key: 'calendar', label: 'Calendar', empty: 'No scheduled tasks found.' },
  { key: 'overdue', label: 'Overdue', empty: 'No overdue tasks.' },
  { key: 'dueSoon', label: 'Due soon', empty: 'Nothing due soon.' },
  { key: 'recurring', label: 'Recurring', empty: 'No recurring tasks found.' },
  { key: 'allActive', label: 'All active', empty: 'No active tasks right now.' },
]

const dashboardViews: Array<{ key: DashboardView; label: string; collection?: DashboardCollection; system?: boolean }> = [
  { key: 'home', label: 'Home', collection: 'tasks' },
  { key: 'tasks', label: 'Tasks', collection: 'tasks' },
  { key: 'projects', label: 'Projects', collection: 'projects' },
  { key: 'notes', label: 'Notes', collection: 'notes' },
  { key: 'people', label: 'People', collection: 'people' },
  { key: 'goals', label: 'Goals', collection: 'goals' },
  { key: 'checkIns', label: 'Check-ins', collection: 'checkIns' },
  { key: 'journal', label: 'Journal', collection: 'journal' },
  { key: 'agentNotes', label: 'Agent Notes', collection: 'agentNotes', system: true },
]

const VISIBLE_FRONTMATTER_KEYS = new Set(['type', 'status', 'updated', 'tags', 'project'])
const CHAT_STORAGE_PREFIX = 'lifeos-chat:'
const THEME_STORAGE_KEY = 'lifeos-theme'

type ThemeMode = 'light' | 'dark'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardHome />} />
        <Route path="/chat" element={<GeneralChatPage />} />
        <Route path="/note/:slug" element={<NoteDetailPage />} />
        <Route path="/note-path" element={<NoteDetailPage />} />
      </Routes>
    </BrowserRouter>
  )
}

function chatStorageKey(slug: string) {
  return `${CHAT_STORAGE_PREFIX}${slug}`
}

function cleanDisplayUserMessage(content: string) {
  const marker = 'User message:'
  const markerIndex = content.lastIndexOf(marker)
  if (markerIndex === -1) return content
  return content.slice(markerIndex + marker.length).trim()
}

function normalizeStoredChatState(state: StoredChatState): StoredChatState {
  return {
    ...state,
    messages: (state.messages ?? []).map((message) => ({
      ...message,
      content: message.role === 'user' ? cleanDisplayUserMessage(message.content) : message.content,
    })),
    activity: state.activity ?? [],
    error: state.error ?? null,
    isSending: Boolean(state.isSending),
  }
}

function readStoredChatState(slug: string): StoredChatState | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(chatStorageKey(slug))
    if (!raw) return null
    return normalizeStoredChatState(JSON.parse(raw) as StoredChatState)
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

function composeChatFeed(chatMessages: ChatMessage[], activity: ActivityEntry[]): ChatFeedEntry[] {
  const activityEntries: ChatFeedEntry[] = activity.map((entry) => ({
    id: entry.id,
    role: 'activity',
    kind: entry.kind,
    content: entry.message,
  }))

  if (chatMessages.length === 0) return activityEntries

  const lastUserIndex = chatMessages.map((message) => message.role).lastIndexOf('user')
  if (lastUserIndex === -1) return [...activityEntries, ...chatMessages]

  const messagesBeforeAndIncludingUser = chatMessages.slice(0, lastUserIndex + 1)
  const messagesAfterUser = chatMessages.slice(lastUserIndex + 1)
  return [...messagesBeforeAndIncludingUser, ...activityEntries, ...messagesAfterUser]
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
        <Link className="brand-lockup" to="/" aria-label="LifeOS home">
          <LifeOsLogo className="site-logo" />
          <h1>LifeOS</h1>
        </Link>
        <div className="header-actions">
          <ThemeToggle />
          <HeaderSearch />
          <Link className="header-chat-link" to="/chat" aria-label="Start a fresh Hermes chat">
            <LifeOsLogo className="chat-logo-mark" />
            <span>Chat</span>
          </Link>
        </div>
      </header>

      <nav className="view-switcher" aria-label="LifeOS views">
        {dashboardViews.map((entry) => {
          const count = entry.collection && counts ? counts[entry.collection] : undefined
          const isActive = activeView === entry.key
          const className = ['view-chip', entry.system ? 'system-chip' : '', isActive ? 'active' : ''].filter(Boolean).join(' ')

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

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme)
  const isDark = theme === 'dark'

  useEffect(() => {
    applyTheme(theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="theme-toggle-icon">
        {isDark ? (
          <>
            <circle cx="12" cy="12" r="4.4" />
            <path d="M12 2.8v2.1M12 19.1v2.1M4.8 4.8l1.5 1.5M17.7 17.7l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.8 19.2l1.5-1.5M17.7 6.3l1.5-1.5" />
          </>
        ) : (
          <path d="M20.1 14.2A7.7 7.7 0 0 1 9.8 3.9 8.6 8.6 0 1 0 20.1 14.2Z" />
        )}
      </svg>
    </button>
  )
}

function HeaderSearch() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return undefined
    const focusId = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(focusId)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    const trimmed = query.trim()
    if (!isOpen || trimmed.length < 2) {
      return undefined
    }

    const abortController = new AbortController()
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSearching(true)
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=5`, { signal: abortController.signal })
        if (!response.ok) throw new Error('Search failed')
        const payload = (await response.json()) as { results?: SearchResult[] }
        setResults(payload.results ?? [])
        setError(null)
      } catch (err) {
        if (!abortController.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Search failed')
          setResults([])
        }
      } finally {
        if (!abortController.signal.aborted) setIsSearching(false)
      }
    }, 80)

    return () => {
      window.clearTimeout(timeoutId)
      abortController.abort()
    }
  }, [isOpen, query])

  const trimmedQuery = query.trim()
  const visibleResults = trimmedQuery.length >= 2 ? results : []
  const showSearching = trimmedQuery.length >= 2 && isSearching

  function handleSearchToggle() {
    if (isOpen) {
      setIsOpen(false)
      return
    }

    // Mobile Safari only opens the keyboard reliably when focus happens inside
    // the original tap/click stack. Flush the input into the DOM, then focus it.
    flushSync(() => setIsOpen(true))
    inputRef.current?.focus({ preventScroll: true })
  }

  return (
    <div className={isOpen ? 'header-search open' : 'header-search'} ref={containerRef}>
      <button
        className="header-search-toggle"
        type="button"
        aria-label={isOpen ? 'Close search' : 'Search notes'}
        aria-expanded={isOpen}
        onClick={handleSearchToggle}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="search-icon">
          <circle cx="10.75" cy="10.75" r="6.25" />
          <path d="M15.4 15.4 20 20" />
        </svg>
      </button>

      {isOpen ? (
        <div className="header-search-popover">
          <label className="sr-only" htmlFor="lifeos-search-input">
            Search notes
          </label>
          <input
            id="lifeos-search-input"
            ref={inputRef}
            className="header-search-input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search notes…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="search-suggestions" role="listbox" aria-label="Search suggestions">
            {trimmedQuery.length < 2 ? <p className="search-empty">Type at least 2 characters.</p> : null}
            {showSearching ? <p className="search-empty">Searching…</p> : null}
            {error && trimmedQuery.length >= 2 ? <p className="search-empty error">{error}</p> : null}
            {!showSearching && !error && trimmedQuery.length >= 2 && visibleResults.length === 0 ? <p className="search-empty">No matches.</p> : null}
            {visibleResults.map((result) => (
              <Link key={result.relativePath} className="search-result-row" to={result.appPath} role="option" onClick={() => setIsOpen(false)}>
                <span className="search-result-title">{result.title}</span>
                <span className="search-result-meta">{result.folder} · {result.relativePath}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function LifeOsLogo({ className = '' }: { className?: string }) {
  return <img className={className} src="/lifeos-logo.svg?v=3" alt="LifeOS logo" draggable="false" />
}

function DashboardHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseDashboardView(searchParams.get('view'))
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('calendar')
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

          {view === 'agentNotes' ? <AgentNotesView agentNotes={data.agentNotes} /> : null}

          {view !== 'home' && view !== 'tasks' && view !== 'projects' && view !== 'agentNotes' ? (
            <DefaultCollectionView view={view} count={data.contentCounts[viewToCollection(view)]} notes={data.collections[viewToCollectionCardsKey(view)]} />
          ) : null}
        </>
      ) : null}
    </main>
  )
}

function GeneralChatPage() {
  const navigate = useNavigate()
  const subject: ChatSubject = useMemo(() => ({ title: 'Fresh chat', isGeneral: true }), [])
  const initialStoredChat = useMemo(() => readStoredChatState('general'), [])
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialStoredChat?.messages ?? [])
  const [activity, setActivity] = useState<ActivityEntry[]>(initialStoredChat?.activity ?? [])
  const [chatSessionId, setChatSessionId] = useState<string | null>(initialStoredChat?.sessionId ?? null)
  const [isSending, setIsSending] = useState(initialStoredChat?.isSending ?? false)
  const [chatError, setChatError] = useState<string | null>(initialStoredChat?.error ?? null)
  const streamAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    writeStoredChatState('general', {
      sessionId: chatSessionId,
      messages: chatMessages,
      activity,
      error: chatError,
      isSending,
    })
  }, [activity, chatError, chatMessages, chatSessionId, isSending])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      streamAbortRef.current?.abort()
    }
  }, [])

  const recoverChatSession = useCallback(async (reason: 'startup' | 'wake' | 'poll' | 'stream-error' = 'poll', sessionOverride?: string | null) => {
    const sessionToRecover = sessionOverride ?? chatSessionId
    if (!sessionToRecover) return

    try {
      const response = await fetch(`/api/hermes/chat/session/${encodeURIComponent(sessionToRecover)}`)
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'Could not recover Hermes session')
      }

      const snapshot = (await response.json()) as HermesSessionSnapshot
      setChatSessionId(snapshot.sessionId)
      setChatMessages((current) => mergeRecoveredMessages(current, snapshot.messages))

      if (snapshot.status === 'running') {
        setIsSending(true)
        if (reason !== 'poll') {
          setActivity((current) => appendRecoveryActivity(current, 'Recovered the session. Hermes is still running in the background.'))
        }
        setChatError(null)
        return
      }

      if (snapshot.status === 'finished') {
        setIsSending(false)
        setChatError(null)
        if (reason === 'wake' || reason === 'stream-error') {
          setActivity((current) => appendRecoveryActivity(current, 'Reconnected cleanly and loaded the finished session.'))
        }
        return
      }

      if (snapshot.status === 'failed') {
        setIsSending(false)
        setChatError(snapshot.error || 'Hermes session failed.')
      }
    } catch (err) {
      if (reason !== 'poll') {
        setChatError(err instanceof Error ? err.message : 'Could not recover Hermes session')
      }
    }
  }, [chatSessionId])

  useEffect(() => {
    if (!chatSessionId) return undefined
    const timeoutId = window.setTimeout(() => {
      void recoverChatSession('startup')
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [chatSessionId, recoverChatSession])

  useEffect(() => {
    if (!chatSessionId || !isSending) return undefined

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
  }, [chatSessionId, isSending, recoverChatSession])

  const chatFeed = useMemo<ChatFeedEntry[]>(() => composeChatFeed(chatMessages, activity), [activity, chatMessages])

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const message = chatInput.trim()
    if (!message || isSending) return

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: message,
    }

    setChatMessages((current) => [...current, userMessage])
    setChatInput('')
    setChatError(null)
    setActivity([])
    setIsSending(true)

    const abortController = new AbortController()
    streamAbortRef.current?.abort()
    streamAbortRef.current = abortController
    let activeSession = chatSessionId

    try {
      const response = await fetch('/api/hermes/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId: chatSessionId }),
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
            setActivity((current) => current.filter((entry) => entry.message !== 'Wrapping up reply…'))
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

  function clearChat() {
    streamAbortRef.current?.abort()
    setChatInput('')
    setChatMessages([])
    setActivity([])
    setChatSessionId(null)
    setChatError(null)
    setIsSending(false)
    if (typeof window !== 'undefined') window.localStorage.removeItem(chatStorageKey('general'))
  }

  return (
    <main className="app-shell detail-shell">
      <LifeOsChrome />
      <ChatModal
        subject={subject}
        input={chatInput}
        feed={chatFeed}
        isSending={isSending}
        sessionId={chatSessionId}
        error={chatError}
        onClose={() => navigate('/')}
        onClear={clearChat}
        onInputChange={setChatInput}
        onSubmit={handleChatSubmit}
      />
    </main>
  )
}

function NoteDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const relativePathParam = searchParams.get('path')
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
      if (!slug && !relativePathParam) {
        if (!cancelled) {
          setNote(null)
          setError('Could not find that note.')
          setLoading(false)
        }
        return
      }

      try {
        setLoading(true)
        const noteUrl = relativePathParam
          ? `/api/note-path?path=${encodeURIComponent(relativePathParam)}`
          : `/api/note/${encodeURIComponent(slug ?? '')}`
        const response = await fetch(noteUrl)
        if (!response.ok) throw new Error(response.status === 404 ? 'Could not find that note.' : 'Could not load note view')
        const payload = (await response.json()) as NoteDetail
        if (!cancelled) {
          const restored = readStoredChatState(payload.relativePath || payload.slug)
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
  }, [relativePathParam, slug])

  useEffect(() => {
    if (!isChatOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isChatOpen])

  useEffect(() => {
    const storageSlug = note?.relativePath || slug
    if (!storageSlug) return
    writeStoredChatState(storageSlug, {
      sessionId: chatSessionId,
      messages: chatMessages,
      activity,
      error: chatError,
      isSending,
    })
  }, [activity, chatError, chatMessages, chatSessionId, isSending, note?.relativePath, slug])

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
        if (reason === 'wake' || reason === 'stream-error') {
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
    if (!note || !chatSessionId) return undefined
    const timeoutId = window.setTimeout(() => {
      void recoverChatSession('startup')
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [chatSessionId, note, recoverChatSession])

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

  const chatFeed = useMemo<ChatFeedEntry[]>(() => composeChatFeed(chatMessages, activity), [activity, chatMessages])

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
    setActivity([])
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
          notePath: note.relativePath,
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
            setActivity((current) => current.filter((entry) => entry.message !== 'Wrapping up reply…'))
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

  function clearChat() {
    streamAbortRef.current?.abort()
    const storageSlug = note?.relativePath || slug
    setChatInput('')
    setChatMessages([])
    setActivity([])
    setChatSessionId(null)
    setChatError(null)
    setIsSending(false)
    if (storageSlug && typeof window !== 'undefined') window.localStorage.removeItem(chatStorageKey(storageSlug))
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
              {note.updated ? <p>Updated {formatDashboardDate(note.updated)}</p> : null}
            </div>
            <div className="note-topbar-actions">
              <button
                className={isChatOpen ? 'link-button compact-button note-action-button' : 'link-button ghost-button compact-button note-action-button'}
                type="button"
                onClick={() => (isChatOpen ? closeChatModal() : openChatModal())}
                aria-label={isChatOpen ? 'Hide Hermes chat' : 'Open Hermes chat'}
              >
                <LifeOsLogo className="button-icon logo-button-icon" />
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
          subject={{ title: note.title, slug: note.slug, relativePath: note.relativePath }}
          input={chatInput}
          feed={chatFeed}
          isSending={isSending}
          sessionId={chatSessionId}
          error={chatError}
          onClose={closeChatModal}
          onClear={clearChat}
          onInputChange={setChatInput}
          onSubmit={handleChatSubmit}
        />
      ) : null}
    </main>
  )
}

function ChatModal({
  subject,
  input,
  feed,
  isSending,
  sessionId,
  error,
  onClose,
  onClear,
  onInputChange,
  onSubmit,
}: {
  subject: ChatSubject
  input: string
  feed: ChatFeedEntry[]
  isSending: boolean
  sessionId: string | null
  error: string | null
  onClose: () => void
  onClear: () => void
  onInputChange: (value: string) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)

  const updateTranscriptStickiness = useCallback(() => {
    const node = transcriptRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom < 72
  }, [])

  useEffect(() => {
    const node = transcriptRef.current
    if (!node || !shouldStickToBottomRef.current) return
    node.scrollTop = node.scrollHeight
  }, [feed])

  const isGeneralChat = Boolean(subject.isGeneral)
  const headerCopy = isGeneralChat ? 'Fresh chat. No note is attached — say if this is LifeOS-related and what context Hermes should use.' : `Working against ${subject.title}. Note context is attached automatically.`
  const emptyCopy = isGeneralChat ? 'Ask anything. If it belongs in LifeOS, include the note/task/project/person context so Hermes can route it cleanly.' : 'Ask Hermes to summarize, plan, draft, or update this note.'
  const placeholder = isGeneralChat ? 'Message Hermes…' : 'Message Hermes about this note...'

  return (
    <div className="chat-modal-overlay" onClick={onClose} role="presentation">
      <section
        className="chat-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isGeneralChat ? 'Fresh Hermes chat' : `Hermes chat for ${subject.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="chat-modal-header">
          <div className="chat-modal-heading">
            <h2>Chat with Hermes</h2>
            <p>
              {isGeneralChat ? headerCopy : <>Working against <strong>{subject.title}</strong>. Note context is attached automatically.</>}
            </p>
          </div>
          <div className="chat-modal-header-actions">
            {sessionId ? <span className="chat-session-pill">Session {sessionId}</span> : null}
            {feed.length > 0 || sessionId || input ? (
              <button className="chat-reset-button" type="button" onClick={onClear} disabled={isSending}>
                New chat
              </button>
            ) : null}
            <button className="icon-button" type="button" onClick={onClose} aria-label="Close chat">
              ✕
            </button>
          </div>
        </div>

        <div className="chat-transcript single-pane" ref={transcriptRef} onScroll={updateTranscriptStickiness}>
          {feed.length === 0 ? (
            <p className="empty-message">{emptyCopy}</p>
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
            placeholder={placeholder}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
          />
          <div className="chat-form-footer">
            <button className="link-button chat-submit-button" type="submit" disabled={isSending || !input.trim()}>
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
          const internalPath = internalNotePathFromHref(href, typeof window === 'undefined' ? undefined : window.location.origin)
          if (internalPath) {
            return (
              <NavLink className="inline-link" to={internalPath} {...props}>
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

function isActiveTask(task: Task) {
  return task.section !== 'done' && task.section !== 'blocked'
}

function filterTasks(tasks: Task[], recurringTasks: Task[], filter: TaskFilter) {
  const activeTasks = tasks.filter(isActiveTask)

  switch (filter) {
    case 'calendar':
      return activeTasks.filter((task) => task.calendarBucket !== 'unscheduled')
    case 'overdue':
      return activeTasks.filter((task) => task.section === 'overdue')
    case 'dueSoon':
      return activeTasks.filter((task) => task.section === 'dueSoon')
    case 'recurring':
      return recurringTasks.filter(isActiveTask)
    case 'allActive':
      return activeTasks
  }
}

function taskFilterCount(data: DashboardPayload, filter: TaskFilter) {
  switch (filter) {
    case 'calendar':
      return data.tasks.filter((task) => isActiveTask(task) && task.calendarBucket !== 'unscheduled').length
    case 'overdue':
      return data.summary.overdue
    case 'dueSoon':
      return data.summary.dueSoon
    case 'recurring':
      return data.summary.recurring
    case 'allActive':
      return data.summary.active
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
    case 'agentNotes':
      return 'agentNotes'
  }
}

function viewToCollectionCardsKey(view: Exclude<DashboardView, 'home' | 'tasks' | 'projects' | 'agentNotes'>): Exclude<DashboardCollection, 'tasks' | 'projects' | 'agentNotes'> {
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

function collectionLabel(view: Exclude<DashboardView, 'home' | 'tasks' | 'projects' | 'agentNotes'>) {
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
  const sectionLabel = currentView === 'home' ? 'Home task lens' : 'Tasks lens'

  return (
    <section className="content-stack">
      <SectionCard title={sectionLabel} count={tasks.length} showHeader={false}>
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

        {tasks.length === 0 ? <EmptyMessage message={emptyMessage} /> : renderTaskList(tasks, filter)}
      </SectionCard>
    </section>
  )
}

function renderTaskList(tasks: Task[], filter: TaskFilter) {
  if (filter !== 'calendar') return tasks.map((task) => <TaskCard key={task.id} task={task} />)

  const bucketOptions: Array<{ key: CalendarBucket; label: string; defaultOpen?: boolean }> = [
    { key: 'today', label: 'Today', defaultOpen: true },
    { key: 'tomorrow', label: 'Tomorrow', defaultOpen: true },
    { key: 'upcomingWeek', label: 'Upcoming week', defaultOpen: true },
    { key: 'oneToThreeWeeks', label: '1–3 weeks', defaultOpen: true },
    { key: 'moreThanMonth', label: 'More than a month' },
  ]

  return bucketOptions.map((bucket) => {
    const bucketTasks = tasks.filter((task) => task.calendarBucket === bucket.key)
    if (bucketTasks.length === 0) return null

    return (
      <details key={bucket.key} className="calendar-bucket" open={bucket.defaultOpen}>
        <summary>
          <span>{bucket.label}</span>
          <span className="calendar-bucket-summary-actions">
            <strong>{bucketTasks.length}</strong>
            <span className="collapse-indicator" aria-hidden="true" />
          </span>
        </summary>
        <div className="calendar-bucket-list">
          {bucketTasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>
      </details>
    )
  })
}

function ProjectsView({ projects }: { projects: Project[] }) {
  return (
    <section className="content-stack">
      <SectionCard title="Projects" count={projects.length} showHeader={false}>
        {projects.length === 0 ? (
          <EmptyMessage message="No active projects found." />
        ) : (
          projects.map((project) => <ProjectCard key={project.id} project={project} />)
        )}
      </SectionCard>
    </section>
  )
}


function AgentNotesView({ agentNotes }: { agentNotes: AgentNotesPayload }) {
  if (!agentNotes.enabled) {
    return (
      <section className="content-stack">
        <SectionCard title={agentNotes.label} count={0} showHeader={false}>
          <EmptyMessage message="Agent Notes is disabled in dashboard config." />
        </SectionCard>
      </section>
    )
  }

  return (
    <section className="content-stack agent-notes-stack">
      <SectionCard title={agentNotes.label} count={agentNotes.count} showHeader={false}>
        {agentNotes.sections.length === 0 ? <EmptyMessage message="No agent note sections configured." /> : null}
        {agentNotes.sections.map((section, index) => (
          <details key={section.id} className="agent-note-section calendar-bucket" open={index === 0}>
            <summary>
              <span>{section.label}</span>
              <span className="calendar-bucket-summary-actions">
                <strong>{section.notes.length}</strong>
                <span className="collapse-indicator" aria-hidden="true" />
              </span>
            </summary>
            <div className="calendar-bucket-list">
              {section.notes.length === 0 ? <EmptyMessage message="No files matched this config section." /> : section.notes.map((note) => <CollectionNoteCard key={note.id} note={note} />)}
            </div>
          </details>
        ))}
      </SectionCard>
    </section>
  )
}

function DefaultCollectionView({
  view,
  count,
  notes,
}: {
  view: Exclude<DashboardView, 'home' | 'tasks' | 'projects' | 'agentNotes'>
  count: number
  notes: CollectionNote[]
}) {
  const label = collectionLabel(view)

  return (
    <section className="content-stack">
      <SectionCard title={label} count={count} showHeader={false}>
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

const SectionCard = forwardRef<HTMLElement, { title: string; count: number; children: React.ReactNode; highlighted?: boolean; subtitle?: string; showHeader?: boolean }>(
  function SectionCard({ title, count, children, highlighted = false, subtitle, showHeader = true }, ref) {
    return (
      <section className={highlighted ? 'section-card highlighted-section' : 'section-card'} ref={ref} aria-label={title}>
        {showHeader ? (
          <div className="section-header">
            <div>
              <h2>{title}</h2>
              <p>{count} item{count === 1 ? '' : 's'}</p>
            </div>
            {subtitle ? <p className="section-subtitle">{subtitle}</p> : null}
          </div>
        ) : null}
        <div className="section-body">{children}</div>
      </section>
    )
  },
)

function EmptyMessage({ message }: { message: string }) {
  return <p className="empty-message">{message}</p>
}

function CollectionNoteCard({ note }: { note: CollectionNote }) {
  const notePath = note.appPath || `/note/${note.slug}`

  return (
    <article className="item-card with-card-chat-action">
      <div className="item-topline">
        <div className="item-heading-group">
          <div className="item-title-row">
            <Link className="item-title-link" to={notePath}>
              <h3>{note.title}</h3>
            </Link>
          </div>
          <p className="subtle-text">{note.relativePath || humanize(note.folder)}</p>
        </div>
        {note.status ? <Badge>{note.status}</Badge> : null}
      </div>

      <div className="chip-row">
        <Chip>{humanize(note.type)}</Chip>
        {note.tags.slice(0, 4).map((tag) => (
          <Chip key={tag}>{tag}</Chip>
        ))}
      </div>

      <div className="card-footer-row">
        <dl className="meta-list">
          <div>
            <dt>Updated</dt>
            <dd>{formatDashboardDate(note.updated) || 'Unknown'}</dd>
          </div>
        </dl>
        <CardChatLink to={withChatParam(notePath)} title={note.title} />
      </div>
    </article>
  )
}

function TaskCard({ task }: { task: Task }) {
  const timingLabel = taskTimingLabel(task)

  return (
    <article className="item-card with-card-chat-action">
      <div className="item-topline">
        <div className="item-heading-group">
          <div className="item-title-row">
            <Link className="item-title-link" to={`/note/${task.slug}`}>
              <h3>{task.title}</h3>
            </Link>
          </div>
          <p className="subtle-text">{task.project ? `Project: ${humanize(task.project)}` : 'Standalone task'}</p>
        </div>
        <Badge>{task.status}</Badge>
      </div>

      <div className="chip-row">
        {task.priority ? <Chip>{task.priority.toUpperCase()}</Chip> : null}
        {task.status === 'in-progress' ? <Chip>In progress</Chip> : null}
        {task.section === 'overdue' ? <Chip>Overdue</Chip> : null}
        {task.area ? <Chip>{task.area}</Chip> : null}
        {task.energyRequired ? <Chip>{task.energyRequired} energy</Chip> : null}
        {task.timeRequired ? <Chip>{task.timeRequired}</Chip> : null}
        {task.recurrence ? <Chip>{task.recurrence}</Chip> : null}
      </div>

      <div className="card-footer-row">
        <dl className="meta-list">
          <div>
            <dt>Next action</dt>
            <dd>{timingLabel}</dd>
          </div>
          {task.dueDate && task.dateBasis !== 'due' ? (
            <div>
              <dt>Due</dt>
              <dd>{formatDashboardDate(task.dueDate)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Updated</dt>
            <dd>{formatDashboardDate(task.updated) || 'Unknown'}</dd>
          </div>
        </dl>
        <CardChatLink to={`/note/${task.slug}?chat=1`} title={task.title} />
      </div>
    </article>
  )
}

function taskTimingLabel(task: Task) {
  const formatted = task.nextActionAt ? formatDashboardDate(task.nextActionAt) : ''
  if (!formatted) return 'No scheduled action'
  if (task.section === 'overdue') return `Overdue · ${formatted}`
  if (task.dateBasis === 'due') return `Due · ${formatted}`
  if (task.dateBasis === 'reminder') return `Reminder · ${formatted}`
  return formatted
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="item-card project-card with-card-chat-action">
      <div className="item-topline">
        <div className="item-heading-group">
          <div className="item-title-row">
            <Link className="item-title-link" to={`/note/${project.slug}`}>
              <h3>{project.title}</h3>
            </Link>
          </div>
          <p className="subtle-text">{project.updated ? `Updated ${formatDashboardDate(project.updated)}` : 'Active project'}</p>
        </div>
        <Badge>{project.status || 'active'}</Badge>
      </div>

      <div className="chip-row">
        {project.priority ? <Chip>{project.priority.toUpperCase()}</Chip> : null}
        {project.area ? <Chip>{project.area}</Chip> : null}
        {project.targetDate ? <Chip>Target {formatDashboardDate(project.targetDate)}</Chip> : null}
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

      <div className="card-footer-row">
        <div className="card-footer-content">
          <div className="next-action-card">
            <span className="next-action-label">Next likely action</span>
            {project.nextAction ? (
              <div className="next-action-body">
                <Link className="inline-link" to={`/note/${project.nextAction.slug}`}>
                  {project.nextAction.title}
                </Link>
                <p className="subtle-text">{formatDashboardDate(project.nextAction.nextActionAt || project.nextAction.dueDate) || humanize(project.nextAction.section)}</p>
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
                  <span>{formatDashboardDate(task.nextActionAt || task.dueDate) || humanize(task.section)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <CardChatLink to={`/note/${project.slug}?chat=1`} title={project.title} />
      </div>
    </article>
  )
}

function CardChatLink({ to, title }: { to: string; title: string }) {
  return (
    <Link className="mini-icon-button card-chat-action" to={to} aria-label={`Chat about ${title}`} title="Chat about this note">
      <LifeOsLogo className="mini-logo-mark" />
    </Link>
  )
}

function withChatParam(path: string) {
  return path.includes('?') ? `${path}&chat=1` : `${path}?chat=1`
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
