import express from 'express'
import fg from 'fast-glob'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import matter from 'gray-matter'
import {
  bucketTasksForFilter,
  isRecurringTaskLike,
  resolveTaskTiming,
  sortTasksByUrgency,
  type CalendarBucket,
  type DateBasis,
  type TaskSection,
  type TaskTiming,
} from './taskTiming.ts'

const app = express()
const port = Number(process.env.PORT || 3007)
const lifeOsRoot = process.env.LIFEOS_ROOT || '/home/ilangurudev/my-data'
const distDir = path.resolve(process.cwd(), 'dist')
const dashboardConfigPath = process.env.LIFEOS_DASHBOARD_CONFIG || path.join(process.cwd(), 'config', 'lifeos-dashboard.config.json')

const OBSIDIAN_APPLET_BASE = 'https://ilangurudev.github.io/obsidian-links/?file='
const EXTERNAL_NOTE_BASE = normalizeExternalBaseUrl(process.env.LIFEOS_EXTERNAL_BASE_URL ?? '')
const ACTIVE_PROJECT_STATUSES = new Set(['active'])
const COLLECTION_GLOBS = {
  tasks: 'tasks/*.md',
  projects: 'projects/*.md',
  notes: 'notes/*.md',
  people: 'people/*.md',
  goals: 'goals/*.md',
  checkIns: 'check-ins/*.md',
  journal: 'journal/*.md',
} as const
const NOTE_FOLDERS = ['tasks', 'projects', 'notes', 'people', 'goals', 'check-ins', 'journal'] as const
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = new RegExp('\\u001B\\[[0-9;?]*[ -/]*[@-~]', 'g')
const HERMES_SESSION_REGEX = /(\d{8}_\d{6}_[a-z0-9]+)/i

const HERMES_LOG_PATTERNS: Array<{ kind: HermesActivityKind; test: (line: string) => boolean }> = [
  { kind: 'tool_call', test: (line) => line.includes('Tool call:') || line.includes('📞 Tool') },
  { kind: 'tool_result', test: (line) => /Tool .* completed/.test(line) || line.includes('✅ Tool') || line.includes('Result:') },
  { kind: 'thinking', test: (line) => line.includes('API Request') || line.includes('API Response') || line.includes('API call #') },
  { kind: 'status', test: (line) => line.includes('Starting conversation') || line.includes('Initializing agent') || line.includes('conversation turn:') || line.includes('Turn ended:') },
]

type NoteFolder = (typeof NOTE_FOLDERS)[number] | string
type HermesActivityKind = 'status' | 'thinking' | 'tool_call' | 'tool_result' | 'log'
type CollectionKey = keyof typeof COLLECTION_GLOBS

type AgentNotesConfigSection = {
  id: string
  label: string
  paths: string[]
}

type AgentNotesConfig = {
  enabled: boolean
  label: string
  sections: AgentNotesConfigSection[]
}

type DashboardConfig = {
  agentNotes?: Partial<AgentNotesConfig> & { sections?: Array<Partial<AgentNotesConfigSection>> }
}

type FrontmatterEntry = {
  key: string
  label: string
  value: string
}

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
  timing: TaskTiming
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
  folder: NoteFolder
  type: string
  status: string
  created: string
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

type AgentNotesSection = {
  id: string
  label: string
  notes: AgentNote[]
}

type AgentNotesPayload = {
  enabled: boolean
  label: string
  count: number
  sections: AgentNotesSection[]
}

type NoteDetail = {
  id: string
  slug: string
  title: string
  folder: NoteFolder
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

type HermesChatResponse = {
  sessionId: string | null
  reply: string
}

type HermesSessionFile = {
  messages?: Array<{
    role?: string
    content?: string
    tool_calls?: Array<{
      id?: string
      call_id?: string
      function?: {
        name?: string
        arguments?: string
      }
    }>
  }>
}

type HermesChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type HermesSessionStatus = 'running' | 'finished' | 'failed' | 'unknown'

type HermesSessionSnapshot = {
  sessionId: string
  noteSlug: string | null
  status: HermesSessionStatus
  messages: HermesChatMessage[]
  reply: string
  error: string | null
  updatedAt: string
}

type HermesRuntimeSession = {
  sessionId: string
  noteSlug: string | null
  status: HermesSessionStatus
  reply: string
  error: string | null
  updatedAt: string
}

type HermesStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'session'; sessionId: string }
  | { type: 'activity'; kind: HermesActivityKind; message: string }
  | { type: 'result'; sessionId: string | null; reply: string }
  | { type: 'error'; message: string }

const hermesRuntimeSessions = new Map<string, HermesRuntimeSession>()

function readTitle(content: string, fallback: string) {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || humanizeSlug(fallback)
}

function normalizeExternalBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

function buildExternalNoteUrl(slug: string, relativePath: string) {
  if (EXTERNAL_NOTE_BASE) return `${EXTERNAL_NOTE_BASE}/note/${encodeURIComponent(slug)}`
  return `${OBSIDIAN_APPLET_BASE}${relativePath}`
}

function humanizeSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function slugifyNoteRef(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}

function labelizeKey(key: string) {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function stringifyFrontmatterValue(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim())
  return []
}

function cleanProjectRef(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.toLowerCase() === 'none') return null
  const wikilinkMatch = raw.match(/\[\[([^\]]+)\]\]/)
  return slugifyNoteRef((wikilinkMatch?.[1] || raw).trim())
}

function sortTasks(tasks: Task[]) {
  return sortTasksByUrgency(tasks)
}

function isRecurringTask(task: Task) {
  return isRecurringTaskLike(task)
}

function isOpenTask(task: Task) {
  return task.section !== 'done'
}

function projectTaskPreview(task: Task): ProjectTaskPreview {
  return {
    id: task.id,
    slug: task.slug,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.nextReminderTime || task.dueDate,
    dueAt: task.dueAt,
    nextActionAt: task.nextActionAt,
    section: task.section,
  }
}

function pickProjectNextAction(tasks: Task[]) {
  const openTasks = sortTasks(tasks.filter((task) => isOpenTask(task) && task.status !== 'blocked'))
  return openTasks[0] ? projectTaskPreview(openTasks[0]) : null
}

function sortProjects(projects: Project[]) {
  return [...projects].sort((a, b) => {
    if (a.inProgressTaskCount !== b.inProgressTaskCount) return b.inProgressTaskCount - a.inProgressTaskCount
    if (a.overdueTaskCount !== b.overdueTaskCount) return b.overdueTaskCount - a.overdueTaskCount
    if (a.dueSoonTaskCount !== b.dueSoonTaskCount) return b.dueSoonTaskCount - a.dueSoonTaskCount
    return a.title.localeCompare(b.title)
  })
}

function resolveWikiLinks(markdown: string) {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_match, target) => {
    const rawTarget = String(target).trim()
    const [targetAndHeading, alias] = rawTarget.split('|')
    const [noteTarget, heading] = targetAndHeading.split('#')
    const slug = slugifyNoteRef(noteTarget)
    const label = alias?.trim() || noteTarget.trim() || humanizeSlug(slug)
    const headingHash = heading?.trim() ? `#${encodeURIComponent(heading.trim().toLowerCase().replace(/\s+/g, '-'))}` : ''
    return `[${label}](/note/${encodeURIComponent(slug)}${headingHash})`
  })
}

function buildFrontmatter(data: Record<string, unknown>) {
  return Object.entries(data)
    .map(([key, value]) => ({
      key,
      label: labelizeKey(key),
      value: stringifyFrontmatterValue(value),
    }))
    .filter((entry) => entry.value)
}

function buildHermesPrompt(note: NoteDetail | null, message: string) {
  const noteContext = note
    ? [
        'The user is interacting from the LifeOS dashboard in the context of a specific LifeOS note.',
        '',
        'Primary note context:',
        `- folder: ${note.folder}`,
        `- slug: ${note.slug}`,
        `- title: ${note.title}`,
        `- path: ${path.join(lifeOsRoot, note.relativePath || path.join(note.folder, `${note.slug}.md`))}`,
        '',
      ]
    : [
        'The user opened the top-level LifeOS dashboard chat with no specific note attached.',
        '',
        'Conversation context:',
        '- No primary note is attached.',
        '- Do not assume this chat is about `notes/life-os.md` or any other specific note.',
        '- If the request is related to LifeOS, ask for or infer the relevant LifeOS context from the user message, then search/read the appropriate vault files before acting.',
        '',
      ]

  return [
    ...noteContext,
    'Instructions:',
    '- Load and follow the `life-os` skill.',
    note ? '- Treat the note above as the starting context, not the only context.' : '- Treat this as a fresh chat unless the user supplies LifeOS context.',
    note ? '- Read the referenced note directly from the LifeOS vault before acting.' : '- For LifeOS-related requests, use the LifeOS vault as the source of truth and read relevant files before acting.',
    '- Use the LifeOS vault as the source of truth.',
    '- Search other relevant existing LifeOS notes if needed before creating new ones.',
    '- If the user shared new durable information, record it in the appropriate LifeOS files.',
    '- If the request implies a task, reminder, project update, person update, or note update, make the corresponding file changes in the vault where appropriate.',
    '- Keep the vault canonical: avoid duplication, prefer wikilinks, and update existing notes instead of creating duplicates when possible.',
    '- If clarification is needed, record what is known first, then ask follow-up questions.',
    '',
    'User message:',
    message.trim(),
  ].join('\n')
}

function parseHermesOutput(output: string): HermesChatResponse {
  const normalized = stripAnsi(output).trim()
  const sessionMatch = normalized.match(/session_id:\s*(\S+)/) ?? normalized.match(HERMES_SESSION_REGEX)
  const sessionId = sessionMatch?.[1] ?? null
  const reply = parseHermesFinalReply(normalized)
  return { sessionId, reply }
}

function looksLikeUselessReply(reply: string) {
  const normalized = reply.trim()
  if (!normalized) return true

  return [
    normalized.includes('Turn ended:'),
    normalized.includes('API Request'),
    normalized.includes('API Response'),
    normalized.includes('API call #'),
    normalized.includes('last_msg_role='),
    normalized.includes('response_len='),
    normalized.startsWith('session='),
  ].some(Boolean)
}

function cleanHermesSessionUserMessage(content: string) {
  const marker = 'User message:'
  const markerIndex = content.lastIndexOf(marker)
  if (markerIndex === -1) return content.trim()

  return content.slice(markerIndex + marker.length).trim()
}

function stripAnsi(value: string) {
  return value.replace(ANSI_REGEX, '').replace(/\r/g, '')
}

function cleanHermesLine(value: string) {
  return stripAnsi(value)
    .replace(/[\u2800-\u28FF]/g, '')
    .replace(/^\s*│\s?/, '')
    .trimEnd()
}

function shouldShowHermesLine(line: string) {
  if (!line.trim()) return false

  return [
    line.startsWith('Initializing agent'),
    line.includes('API Request'),
    line.includes('Tool call:'),
    /Tool .* completed/.test(line),
    line.includes('Turn ended:'),
  ].some(Boolean)
}

function classifyHermesLine(line: string): HermesActivityKind {
  for (const pattern of HERMES_LOG_PATTERNS) {
    if (pattern.test(line)) return pattern.kind
  }
  return 'log'
}

function writeNdjson(res: express.Response, payload: HermesStreamEvent) {
  if (res.writableEnded || res.destroyed) return
  res.write(`${JSON.stringify(payload)}\n`)
}

function nowIso() {
  return new Date().toISOString()
}

function rememberHermesRuntimeSession(sessionId: string, updates: Partial<HermesRuntimeSession> = {}) {
  const current = hermesRuntimeSessions.get(sessionId)
  const next: HermesRuntimeSession = {
    sessionId,
    noteSlug: updates.noteSlug ?? current?.noteSlug ?? null,
    status: updates.status ?? current?.status ?? 'unknown',
    reply: updates.reply ?? current?.reply ?? '',
    error: updates.error ?? current?.error ?? null,
    updatedAt: updates.updatedAt ?? nowIso(),
  }

  hermesRuntimeSessions.set(sessionId, next)
  return next
}

function truncateActivityMessage(line: string, maxLength = 220) {
  if (line.length <= maxLength) return line
  return `${line.slice(0, maxLength - 1)}…`
}

function shortPath(value: string) {
  return value.replace(/^\/home\/ilangurudev\/my-data\//, '').replace(/^\/home\/ilangurudev\/projects\/lifeos-dashboard\//, '')
}

function compactJsonValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) return value.map(compactJsonValue).filter(Boolean).join(', ') || null
  if (value && typeof value === 'object') return JSON.stringify(value)
  if (value === null || typeof value === 'undefined') return null
  return String(value)
}

function parseToolCall(line: string): { tool: string; args: Record<string, unknown> } | null {
  const match = line.match(/Tool call:\s*([^\s]+)(?:\s+with args:\s*([\s\S]+))?/)
  if (!match?.[1]) return null

  const rawArgs = match[2]?.trim()
  if (!rawArgs) return { tool: match[1], args: {} }

  try {
    return { tool: match[1], args: JSON.parse(rawArgs) as Record<string, unknown> }
  } catch {
    return { tool: match[1], args: { raw: rawArgs } }
  }
}

function summarizeToolCall(tool: string, args: Record<string, unknown>) {
  const pathValue = compactJsonValue(args.path) || compactJsonValue(args.file_path) || compactJsonValue(args.target)
  const queryValue = compactJsonValue(args.query) || compactJsonValue(args.pattern)
  const commandValue = compactJsonValue(args.command)
  const urlValue = compactJsonValue(args.url) || compactJsonValue(args.urls)

  if (tool === 'read_file' && pathValue) return `Reading ${shortPath(pathValue)}…`
  if (tool === 'search_files') {
    const scope = pathValue ? ` in ${shortPath(pathValue)}` : ''
    return queryValue ? `Searching for “${truncateActivityMessage(queryValue, 80)}”${scope}…` : `Searching files${scope}…`
  }
  if (tool === 'terminal' && commandValue) return `Running ${truncateActivityMessage(commandValue, 110)}…`
  if (tool === 'web_search' && queryValue) return `Searching web for “${truncateActivityMessage(queryValue, 90)}”…`
  if (tool === 'web_extract' && urlValue) return `Reading ${truncateActivityMessage(urlValue, 110)}…`
  if (tool === 'browser_navigate' && urlValue) return `Opening ${truncateActivityMessage(urlValue, 110)}…`
  if (queryValue) return `Using ${tool} for “${truncateActivityMessage(queryValue, 90)}”…`
  if (pathValue) return `Using ${tool} on ${shortPath(pathValue)}…`
  return `Using ${tool}…`
}

function formatHermesActivityLine(line: string, recentToolLabels: Map<string, string>): string | null {
  if (line.startsWith('Initializing agent')) return 'Initializing Hermes…'
  if (line.includes('API Request')) return 'Asking the model…'
  if (line.includes('📞 Tool') || line.includes('✅ Tool')) return null

  const toolCall = parseToolCall(line)
  if (toolCall) {
    const label = summarizeToolCall(toolCall.tool, toolCall.args)
    recentToolLabels.set(toolCall.tool, label)
    return label
  }

  const toolDoneMatch = line.match(/Tool\s+([^\s]+)\s+completed\s+in\s+([0-9.]+s)/)
  if (toolDoneMatch?.[1]) {
    const previousLabel = recentToolLabels.get(toolDoneMatch[1])
    const target = previousLabel ? previousLabel.replace(/…$/, '').replace(/^(Reading|Searching|Running|Opening|Using)\s+/i, '') : toolDoneMatch[1]
    return `Finished ${target} in ${toolDoneMatch[2]}`
  }

  if (line.includes('Turn ended:')) return 'Wrapping up reply…'

  return null
}

function parseHermesFinalReply(output: string) {
  const cleaned = stripAnsi(output)
  const boxMatch = cleaned.match(/Turn ended:.*?\n([\s\S]*?)\n╰/)
  if (boxMatch?.[1]) {
    const lines = boxMatch[1]
      .split('\n')
      .map((line) => cleanHermesLine(line).trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('✅ Tool'))
      .filter((line) => !line.startsWith('Result:'))

    if (lines.length > 0) return lines.join('\n')
  }

  const fallback = cleaned
    .replace(/session_id:\s*\S+/g, '')
    .replace(/^↻\s+Resumed session .*$/gm, '')
    .split('\n')
    .map((line) => cleanHermesLine(line).trim())
    .filter(Boolean)
    .pop()

  return fallback || ''
}

async function readHermesSessionReply(sessionId: string | null) {
  if (!sessionId) return ''

  try {
    const sessionPath = path.join(process.env.HOME || '', '.hermes', 'sessions', `session_${sessionId}.json`)
    const raw = await fs.readFile(sessionPath, 'utf8')
    const session = JSON.parse(raw) as HermesSessionFile
    const messages = session.messages ?? []

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message.role === 'assistant' && typeof message.content === 'string' && message.content.trim()) {
        return message.content.trim()
      }
    }
  } catch {
    return ''
  }

  return ''
}

async function readHermesSessionToolLabel(sessionId: string | null, toolName: string, seenToolCallIds: Set<string>) {
  if (!sessionId) return null

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const sessionPath = path.join(process.env.HOME || '', '.hermes', 'sessions', `session_${sessionId}.json`)
      const raw = await fs.readFile(sessionPath, 'utf8')
      const session = JSON.parse(raw) as HermesSessionFile
      const messages = session.messages ?? []

      for (const message of messages) {
        for (const toolCall of message.tool_calls ?? []) {
          const name = toolCall.function?.name
          const callId = toolCall.call_id || toolCall.id || `${name}-${toolCall.function?.arguments ?? ''}`
          if (name !== toolName || seenToolCallIds.has(callId)) continue

          seenToolCallIds.add(callId)
          const rawArgs = toolCall.function?.arguments ?? '{}'
          const args = JSON.parse(rawArgs) as Record<string, unknown>
          return summarizeToolCall(name, args)
        }
      }
    } catch {
      // Session file may not exist yet or may still be mid-write; retry briefly.
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return null
}

async function readHermesSessionMessages(sessionId: string | null) {
  if (!sessionId) return [] as HermesChatMessage[]

  try {
    const sessionPath = path.join(process.env.HOME || '', '.hermes', 'sessions', `session_${sessionId}.json`)
    const raw = await fs.readFile(sessionPath, 'utf8')
    const session = JSON.parse(raw) as HermesSessionFile
    const messages = session.messages ?? []

    return messages
      .filter(
        (message): message is { role: 'user' | 'assistant'; content: string } =>
          (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content.trim().length > 0,
      )
      .map((message) => ({
        role: message.role,
        content: message.role === 'user' ? cleanHermesSessionUserMessage(message.content) : message.content.trim(),
      }))
  } catch {
    return []
  }
}

async function buildHermesSessionSnapshot(sessionId: string, noteSlug?: string | null): Promise<HermesSessionSnapshot> {
  const runtime = hermesRuntimeSessions.get(sessionId)
  const messages = await readHermesSessionMessages(sessionId)
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
  const reply = runtime?.reply || (lastMessage?.role === 'assistant' ? lastMessage.content : '')

  let status: HermesSessionStatus = runtime?.status ?? 'unknown'
  if (!runtime) {
    if (lastMessage?.role === 'assistant') status = 'finished'
    else if (messages.length > 0) status = 'unknown'
  }

  return {
    sessionId,
    noteSlug: runtime?.noteSlug ?? noteSlug ?? null,
    status,
    messages,
    reply,
    error: runtime?.error ?? null,
    updatedAt: runtime?.updatedAt ?? nowIso(),
  }
}


const DEFAULT_AGENT_NOTES_CONFIG: AgentNotesConfig = {
  enabled: true,
  label: 'Agent Notes',
  sections: [
    { id: 'agent-tasks', label: 'Agent Tasks', paths: ['tasks/run-nightly-life-os-lint.md', 'tasks/run-daily-reminder-safety-net.md', 'tasks/get-inspired.md'] },
    { id: 'agent-logs', label: 'Agent Logs', paths: ['.agents-log/**/*.md'] },
  ],
}

function sanitizeAgentNotesConfig(raw: DashboardConfig): AgentNotesConfig {
  const agentNotes = raw.agentNotes ?? {}
  const sections = (agentNotes.sections ?? DEFAULT_AGENT_NOTES_CONFIG.sections)
    .map((section) => ({
      id: String(section.id ?? '').trim(),
      label: String(section.label ?? '').trim(),
      paths: Array.isArray(section.paths) ? section.paths.map(String).map((item) => item.trim()).filter(Boolean) : [],
    }))
    .filter((section) => section.id && section.label && section.paths.length > 0)

  return {
    enabled: typeof agentNotes.enabled === 'boolean' ? agentNotes.enabled : DEFAULT_AGENT_NOTES_CONFIG.enabled,
    label: String(agentNotes.label ?? DEFAULT_AGENT_NOTES_CONFIG.label).trim() || DEFAULT_AGENT_NOTES_CONFIG.label,
    sections: sections.length > 0 ? sections : DEFAULT_AGENT_NOTES_CONFIG.sections,
  }
}

async function loadDashboardConfig(): Promise<{ agentNotes: AgentNotesConfig }> {
  try {
    const raw = await fs.readFile(dashboardConfigPath, 'utf8')
    return { agentNotes: sanitizeAgentNotesConfig(JSON.parse(raw) as DashboardConfig) }
  } catch (error) {
    console.warn(`Using default dashboard config; could not read ${dashboardConfigPath}:`, error)
    return { agentNotes: DEFAULT_AGENT_NOTES_CONFIG }
  }
}

function isSafeVaultRelativePath(relativePath: string) {
  const normalized = relativePath.replaceAll('\\', '/').trim()
  return Boolean(normalized) && !path.isAbsolute(normalized) && !normalized.split('/').includes('..')
}

function buildAppPathForRelativePath(relativePath: string) {
  return `/note-path?path=${encodeURIComponent(relativePath)}`
}

function parseSortDate(value: string) {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? null : timestamp
}

function compareNotesByCreatedDesc(left: CollectionNote, right: CollectionNote) {
  const leftCreated = parseSortDate(left.created)
  const rightCreated = parseSortDate(right.created)
  if (leftCreated !== null && rightCreated !== null && leftCreated !== rightCreated) return rightCreated - leftCreated
  if (leftCreated !== null && rightCreated === null) return -1
  if (leftCreated === null && rightCreated !== null) return 1

  const leftUpdated = parseSortDate(left.updated)
  const rightUpdated = parseSortDate(right.updated)
  if (leftUpdated !== null && rightUpdated !== null && leftUpdated !== rightUpdated) return rightUpdated - leftUpdated
  if (leftUpdated !== null && rightUpdated === null) return -1
  if (leftUpdated === null && rightUpdated !== null) return 1

  return left.title.localeCompare(right.title)
}

async function readMarkdownFile(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf8')
  const { data, content } = matter(raw)
  const slug = path.basename(filePath, '.md')
  const relativePath = path.relative(lifeOsRoot, filePath).replaceAll(path.sep, '/')
  const folder = relativePath.split('/')[0] as NoteFolder

  return {
    data,
    content,
    slug,
    folder,
    relativePath,
    title: readTitle(content, slug),
  }
}

async function resolveAgentTaskExclusionPaths(config: AgentNotesConfig) {
  const agentNotePatterns = config.sections.flatMap((section) => section.paths)
  if (agentNotePatterns.length === 0) return new Set<string>()

  const files = await fg(agentNotePatterns, {
    cwd: lifeOsRoot,
    absolute: true,
    onlyFiles: true,
    ignore: ['**/_template.md'],
  })

  return new Set(
    files
      .map((filePath) => path.relative(lifeOsRoot, filePath).replaceAll(path.sep, '/'))
      .filter((relativePath) => relativePath.startsWith('tasks/')),
  )
}

async function loadTasks(config: AgentNotesConfig) {
  const excludedTaskPaths = await resolveAgentTaskExclusionPaths(config)
  const files = await fg(COLLECTION_GLOBS.tasks, {
    cwd: lifeOsRoot,
    absolute: true,
    ignore: ['**/_template.md'],
  })

  const visibleTaskFiles = files.filter((filePath) => !excludedTaskPaths.has(path.relative(lifeOsRoot, filePath).replaceAll(path.sep, '/')))

  const tasks = await Promise.all(
    visibleTaskFiles.map(async (filePath) => {
      const note = await readMarkdownFile(filePath)
      const dueDate = String(note.data.due_date ?? '').trim()
      const nextReminderTime = String(note.data.next_reminder_time ?? '').trim()
      const completedTime = String(note.data.completed_time ?? '').trim()
      const status = String(note.data.status ?? 'todo').trim().toLowerCase()
      const priority = String(note.data.priority ?? '').trim().toLowerCase()
      const recurrence = String(note.data.recurrence ?? '').trim()
      const tags = toArray(note.data.tags)
      const timing = resolveTaskTiming(
        {
          id: note.slug,
          title: note.title,
          status,
          priority,
          recurrence,
          dueDate,
          nextReminderTime,
          completedTime,
          tags,
        },
        new Date(),
      )

      const task: Task = {
        id: note.slug,
        slug: note.slug,
        title: note.title,
        status,
        priority,
        area: String(note.data.area ?? '').trim(),
        energyRequired: String(note.data.energy_required ?? '').trim(),
        timeRequired: String(note.data.time_required ?? '').trim(),
        recurrence,
        project: cleanProjectRef(note.data.project),
        dueDate,
        dueAt: timing.dueAt,
        reminderAt: timing.reminderAt,
        completedAt: timing.completedAt,
        nextActionAt: timing.nextActionAt,
        dateBasis: timing.dateBasis,
        calendarBucket: timing.calendarBucket,
        nextReminderTime,
        completedTime,
        updated: String(note.data.updated ?? '').trim(),
        tags,
        link: buildExternalNoteUrl(note.slug, note.relativePath),
        section: timing.section,
        timing,
      }

      return task
    }),
  )

  return sortTasks(tasks)
}

async function loadCollectionCounts() {
  const entries = await Promise.all(
    (Object.keys(COLLECTION_GLOBS) as CollectionKey[]).map(async (collection) => {
      const files = await fg(COLLECTION_GLOBS[collection], {
        cwd: lifeOsRoot,
        absolute: true,
        ignore: ['**/_template.md'],
      })

      return [collection, files.length] as const
    }),
  )

  return Object.fromEntries(entries) as Record<CollectionKey, number>
}

async function loadCollectionCards(collection: Exclude<CollectionKey, 'tasks' | 'projects'>) {
  const files = await fg(COLLECTION_GLOBS[collection], {
    cwd: lifeOsRoot,
    absolute: true,
    ignore: ['**/_template.md'],
  })

  const notes = await Promise.all(
    files.map(async (filePath) => {
      const note = await readMarkdownFile(filePath)

      const entry: CollectionNote = {
        id: note.slug,
        slug: note.slug,
        title: note.title,
        folder: note.folder,
        type: String(note.data.type ?? note.folder).trim(),
        status: String(note.data.status ?? '').trim().toLowerCase(),
        created: String(note.data.created ?? '').trim(),
        updated: String(note.data.updated ?? '').trim(),
        tags: toArray(note.data.tags),
        link: buildExternalNoteUrl(note.slug, note.relativePath),
        relativePath: note.relativePath,
        appPath: `/note/${encodeURIComponent(note.slug)}`,
      }

      return entry
    }),
  )

  return notes.sort(compareNotesByCreatedDesc)
}


async function loadAgentNotes(config: AgentNotesConfig): Promise<AgentNotesPayload> {
  if (!config.enabled) {
    return { enabled: false, label: config.label, count: 0, sections: [] }
  }

  const seen = new Set<string>()
  const sections = await Promise.all(
    config.sections.map(async (section) => {
      const files = await fg(section.paths, {
        cwd: lifeOsRoot,
        absolute: true,
        onlyFiles: true,
        ignore: ['**/_template.md'],
      })

      const uniqueFiles = files.filter((filePath) => {
        const relativePath = path.relative(lifeOsRoot, filePath).replaceAll(path.sep, '/')
        if (!isSafeVaultRelativePath(relativePath) || seen.has(relativePath)) return false
        seen.add(relativePath)
        return true
      })

      const notes = await Promise.all(
        uniqueFiles.map(async (filePath) => {
          const [note, stats] = await Promise.all([readMarkdownFile(filePath), fs.stat(filePath)])
          const created = String(note.data.created ?? '').trim() || stats.birthtime.toISOString() || stats.mtime.toISOString()
          const entry: AgentNote = {
            id: `${section.id}:${note.relativePath}`,
            slug: note.slug,
            title: note.title,
            folder: note.folder,
            type: String(note.data.type ?? note.folder).trim(),
            status: String(note.data.status ?? '').trim().toLowerCase(),
            created,
            updated: String(note.data.updated ?? '').trim() || stats.mtime.toISOString(),
            tags: toArray(note.data.tags),
            link: buildExternalNoteUrl(note.slug, note.relativePath),
            relativePath: note.relativePath,
            appPath: buildAppPathForRelativePath(note.relativePath),
            sectionId: section.id,
            sectionLabel: section.label,
          }

          return entry
        }),
      )

      notes.sort(compareNotesByCreatedDesc)

      return { id: section.id, label: section.label, notes }
    }),
  )

  const count = sections.reduce((total, section) => total + section.notes.length, 0)
  return { enabled: true, label: config.label, count, sections }
}

async function loadProjects(tasks: Task[]) {
  const files = await fg(COLLECTION_GLOBS.projects, {
    cwd: lifeOsRoot,
    absolute: true,
    ignore: ['**/_template.md'],
  })

  const tasksByProject = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.project) continue
    const current = tasksByProject.get(task.project) ?? []
    current.push(task)
    tasksByProject.set(task.project, current)
  }

  const projects = await Promise.all(
    files.map(async (filePath) => {
      const note = await readMarkdownFile(filePath)
      const status = String(note.data.status ?? '').trim().toLowerCase()
      if (!ACTIVE_PROJECT_STATUSES.has(status)) return null

      const projectTasks = sortTasks(tasksByProject.get(note.slug) ?? [])
      const openTasks = projectTasks.filter((task) => isOpenTask(task))

      const project: Project = {
        id: note.slug,
        slug: note.slug,
        title: note.title,
        status,
        area: String(note.data.area ?? '').trim(),
        priority: String(note.data.priority ?? '').trim().toLowerCase(),
        targetDate: String(note.data.target_date ?? '').trim(),
        updated: String(note.data.updated ?? '').trim(),
        tags: toArray(note.data.tags),
        link: buildExternalNoteUrl(note.slug, note.relativePath),
        openTaskCount: openTasks.length,
        overdueTaskCount: openTasks.filter((task) => task.section === 'overdue').length,
        dueSoonTaskCount: openTasks.filter((task) => task.section === 'dueSoon').length,
        inProgressTaskCount: openTasks.filter((task) => task.status === 'in-progress').length,
        nextAction: pickProjectNextAction(projectTasks),
        taskPreview: openTasks.slice(0, 3).map(projectTaskPreview),
      }

      return project
    }),
  )

  return sortProjects(projects.filter((project): project is Project => project !== null))
}

async function findNoteFile(slug: string) {
  for (const folder of NOTE_FOLDERS) {
    const filePath = path.join(lifeOsRoot, folder, `${slug}.md`)
    try {
      await fs.access(filePath)
      return filePath
    } catch {
      // keep looking
    }
  }

  return null
}

async function loadNoteByRelativePath(relativePath: string): Promise<NoteDetail | null> {
  if (!isSafeVaultRelativePath(relativePath)) return null
  const filePath = path.join(lifeOsRoot, relativePath)
  try {
    await fs.access(filePath)
  } catch {
    return null
  }

  const note = await readMarkdownFile(filePath)

  return {
    id: note.slug,
    slug: note.slug,
    title: note.title,
    folder: note.folder,
    type: String(note.data.type ?? note.folder).trim(),
    status: String(note.data.status ?? '').trim().toLowerCase(),
    updated: String(note.data.updated ?? '').trim(),
    tags: toArray(note.data.tags),
    project: cleanProjectRef(note.data.project),
    obsidianLink: `${OBSIDIAN_APPLET_BASE}${note.relativePath}`,
    appLink: buildAppPathForRelativePath(note.relativePath),
    externalLink: buildExternalNoteUrl(note.slug, note.relativePath),
    frontmatter: buildFrontmatter(note.data as Record<string, unknown>),
    markdown: resolveWikiLinks(note.content.trim()),
    relativePath: note.relativePath,
  }
}

async function loadNote(slug: string): Promise<NoteDetail | null> {
  const safeSlug = slugifyNoteRef(slug)
  const filePath = await findNoteFile(safeSlug)
  if (!filePath) return null

  const note = await readMarkdownFile(filePath)

  return {
    id: note.slug,
    slug: note.slug,
    title: note.title,
    folder: note.folder,
    type: String(note.data.type ?? note.folder).trim(),
    status: String(note.data.status ?? '').trim().toLowerCase(),
    updated: String(note.data.updated ?? '').trim(),
    tags: toArray(note.data.tags),
    project: cleanProjectRef(note.data.project),
    obsidianLink: `${OBSIDIAN_APPLET_BASE}${note.relativePath}`,
    appLink: `/note/${encodeURIComponent(note.slug)}`,
    externalLink: buildExternalNoteUrl(note.slug, note.relativePath),
    frontmatter: buildFrontmatter(note.data as Record<string, unknown>),
    markdown: resolveWikiLinks(note.content.trim()),
    relativePath: note.relativePath,
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, lifeOsRoot })
})

app.use(express.json({ limit: '1mb' }))

app.get('/api/dashboard', async (_req, res) => {
  try {
    const config = await loadDashboardConfig()
    const [tasks, contentCounts, notes, people, goals, checkIns, journal, agentNotes] = await Promise.all([
      loadTasks(config.agentNotes),
      loadCollectionCounts(),
      loadCollectionCards('notes'),
      loadCollectionCards('people'),
      loadCollectionCards('goals'),
      loadCollectionCards('checkIns'),
      loadCollectionCards('journal'),
      loadAgentNotes(config.agentNotes),
    ])
    const recurringTasks = sortTasks(tasks.filter((task) => isRecurringTask(task)))
    const projects = await loadProjects(tasks)
    const summary = {
      tasks: tasks.length,
      overdue: tasks.filter((task) => task.section === 'overdue').length,
      dueSoon: tasks.filter((task) => task.section === 'dueSoon').length,
      inProgress: tasks.filter((task) => task.status === 'in-progress').length,
      blocked: tasks.filter((task) => task.status === 'blocked').length,
      recurring: recurringTasks.length,
      active: bucketTasksForFilter(tasks, 'allActive').length,
      projects: projects.length,
    }

    res.json({
      generatedAt: new Date().toISOString(),
      lifeOsRoot,
      summary,
      contentCounts: { ...contentCounts, tasks: tasks.length, agentNotes: agentNotes.count },
      tasks,
      recurringTasks,
      projects,
      collections: {
        notes,
        people,
        goals,
        checkIns,
        journal,
      },
      agentNotes,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to build dashboard payload.' })
  }
})

app.get('/api/note-path', async (req, res) => {
  try {
    const relativePath = String(req.query.path ?? '').trim()
    const note = await loadNoteByRelativePath(relativePath)
    if (!note) {
      return res.status(404).json({ error: 'Note not found.' })
    }

    res.json(note)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load note.' })
  }
})

app.get('/api/note/:slug', async (req, res) => {
  try {
    const note = await loadNote(req.params.slug)
    if (!note) {
      return res.status(404).json({ error: 'Note not found.' })
    }

    res.json(note)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to load note.' })
  }
})

app.get('/api/hermes/chat/session/:sessionId', async (req, res) => {
  const sessionId = String(req.params.sessionId ?? '').trim()
  const noteSlug = String(req.query.noteSlug ?? '').trim() || null

  if (!sessionId) {
    return res.status(400).json({ error: 'Session id is required.' })
  }

  try {
    const snapshot = await buildHermesSessionSnapshot(sessionId, noteSlug)
    res.json(snapshot)
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to recover Hermes session.' })
  }
})

app.post('/api/hermes/chat/stream', async (req, res) => {
  const message = String(req.body?.message ?? '').trim()
  const noteSlug = String(req.body?.noteSlug ?? '').trim()
  const notePath = String(req.body?.notePath ?? '').trim()
  const sessionId = String(req.body?.sessionId ?? '').trim()

  if (!message) {
    return res.status(400).json({ error: 'Message is required.' })
  }

  const note = notePath ? await loadNoteByRelativePath(notePath) : noteSlug ? await loadNote(noteSlug) : null
  if ((noteSlug || notePath) && !note) {
    return res.status(404).json({ error: 'Could not find that note for chat context.' })
  }

  const contextId = note?.relativePath || noteSlug || 'general'

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  writeNdjson(res, { type: 'status', message: sessionId ? 'Resuming Hermes session…' : 'Starting Hermes session…' })

  const args = ['chat', '-v', '--source', 'tool', '--pass-session-id', '-s', 'life-os']
  if (sessionId) {
    args.push('--resume', sessionId)
  }
  args.push('-q', buildHermesPrompt(note, message))

  const child = spawn('hermes', args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      TERM: 'dumb',
      COLUMNS: '120',
    },
  })

  let combinedOutput = ''
  let activeSessionId = sessionId || null
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let clientConnected = true
  const recentToolLabels = new Map<string, string>()
  const seenToolCallIds = new Set<string>()

  if (activeSessionId) {
    rememberHermesRuntimeSession(activeSessionId, { noteSlug: contextId, status: 'running', error: null })
  }

  const emitLine = async (rawLine: string) => {
    const line = cleanHermesLine(rawLine).trim()
    if (!line) return

    const sessionMatch = line.match(/session_id:\s*(\S+)/) ?? line.match(HERMES_SESSION_REGEX)
    if (sessionMatch?.[1] && sessionMatch[1] !== activeSessionId) {
      activeSessionId = sessionMatch[1]
      rememberHermesRuntimeSession(activeSessionId, { noteSlug: contextId, status: 'running', error: null })
      writeNdjson(res, { type: 'session', sessionId: activeSessionId })
    }

    if (!shouldShowHermesLine(line)) return

    const toolCall = parseToolCall(line)
    let formattedLine: string | null = null
    if (toolCall && (Object.keys(toolCall.args).length === 0 || typeof toolCall.args.raw === 'string')) {
      formattedLine = await readHermesSessionToolLabel(activeSessionId, toolCall.tool, seenToolCallIds)
      if (formattedLine) recentToolLabels.set(toolCall.tool, formattedLine)
      else return
    }

    const toolDoneMatch = line.match(/Tool\s+([^\s]+)\s+completed\s+in\s+([0-9.]+s)/)
    if (toolDoneMatch?.[1]) {
      const label = await readHermesSessionToolLabel(activeSessionId, toolDoneMatch[1], seenToolCallIds)
      if (label) recentToolLabels.set(toolDoneMatch[1], label)
    }

    formattedLine ??= formatHermesActivityLine(line, recentToolLabels)
    if (!formattedLine) return
    writeNdjson(res, { type: 'activity', kind: classifyHermesLine(line), message: truncateActivityMessage(formattedLine) })
  }

  const handleChunk = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
    const text = stripAnsi(chunk.toString('utf8'))
    combinedOutput += text

    const nextBuffer = `${stream === 'stdout' ? stdoutBuffer : stderrBuffer}${text}`
    const lines = nextBuffer.split('\n')
    const remainder = lines.pop() ?? ''

    for (const line of lines) void emitLine(line)

    if (stream === 'stdout') stdoutBuffer = remainder
    else stderrBuffer = remainder
  }

  child.stdout.on('data', (chunk) => handleChunk(chunk, 'stdout'))
  child.stderr.on('data', (chunk) => handleChunk(chunk, 'stderr'))

  req.on('close', () => {
    clientConnected = false
  })

  child.on('error', (error) => {
    if (activeSessionId) {
      rememberHermesRuntimeSession(activeSessionId, {
        noteSlug: contextId,
        status: 'failed',
        error: error.message || 'Hermes failed to start.',
      })
    }
    writeNdjson(res, { type: 'error', message: error.message || 'Hermes failed to start.' })
    if (clientConnected && !res.writableEnded) res.end()
  })

  child.on('close', async (code) => {
    if (stdoutBuffer.trim()) await emitLine(stdoutBuffer)
    if (stderrBuffer.trim()) await emitLine(stderrBuffer)

    const parsed = parseHermesOutput(combinedOutput)
    if (parsed.sessionId && parsed.sessionId !== activeSessionId) {
      activeSessionId = parsed.sessionId
      rememberHermesRuntimeSession(activeSessionId, { noteSlug: contextId, status: 'running', error: null })
      writeNdjson(res, { type: 'session', sessionId: parsed.sessionId })
    }

    if (code === 0) {
      let finalReply = parsed.reply
      if (looksLikeUselessReply(finalReply)) {
        const sessionReply = await readHermesSessionReply(parsed.sessionId ?? activeSessionId)
        if (sessionReply) finalReply = sessionReply
      }

      if (activeSessionId) {
        rememberHermesRuntimeSession(activeSessionId, {
          noteSlug: contextId,
          status: 'finished',
          reply: finalReply || '',
          error: null,
        })
      }

      writeNdjson(res, {
        type: 'result',
        sessionId: parsed.sessionId ?? activeSessionId,
        reply: finalReply || 'Hermes finished but came back with no final text. Slightly rude, but technically done.',
      })
    } else {
      if (activeSessionId) {
        rememberHermesRuntimeSession(activeSessionId, {
          noteSlug: contextId,
          status: 'failed',
          error: `Hermes exited with code ${code ?? 'unknown'}.`,
        })
      }

      writeNdjson(res, {
        type: 'error',
        message: `Hermes exited with code ${code ?? 'unknown'}.`,
      })
    }

    if (clientConnected && !res.writableEnded) res.end()
  })
})

app.use(
  express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store')
      }
    },
  }),
)

app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next()
  }

  try {
    await fs.access(path.join(distDir, 'index.html'))
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(path.join(distDir, 'index.html'))
  } catch {
    res.status(404).send('Frontend not built yet. Run npm run build or use npm run dev.')
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`LifeOS dashboard running on http://0.0.0.0:${port}`)
  console.log(`Using vault at ${lifeOsRoot}`)
})
