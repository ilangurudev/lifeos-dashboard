import express from 'express'
import fg from 'fast-glob'
import fs from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'
import * as chrono from 'chrono-node'

const app = express()
const port = Number(process.env.PORT || 3007)
const lifeOsRoot = process.env.LIFEOS_ROOT || '/home/ilangurudev/my-data'
const distDir = path.resolve(process.cwd(), 'dist')

const OBSIDIAN_BASE = 'https://ilangurudev.github.io/obsidian-links/?file='
const DONE_STATUSES = new Set(['done'])
const NOTE_FOLDERS = ['tasks', 'projects', 'notes', 'people', 'goals', 'check-ins', 'daily-logs'] as const

type NoteFolder = (typeof NOTE_FOLDERS)[number]

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
}

function readTitle(content: string, fallback: string) {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || humanizeSlug(fallback)
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

function parseLooseDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.toLowerCase() === 'none scheduled' || raw.toLowerCase() === 'never sent') return null
  const parsed = chrono.parseDate(raw)
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return parsed
}

function priorityRank(priority: string) {
  const match = priority.match(/p(\d+)/i)
  return match ? Number(match[1]) : 99
}

function taskSection(task: Task) {
  if (DONE_STATUSES.has(task.status)) return 'done' as const
  if (task.status === 'blocked') return 'blocked' as const
  if (task.dueAt) {
    const due = new Date(task.dueAt)
    const now = new Date()
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    if (due < now) return 'overdue' as const
    if (due <= soon) return 'dueSoon' as const
  }
  if (task.status === 'in-progress') return 'inProgress' as const
  return 'active' as const
}

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const sectionOrder = ['overdue', 'dueSoon', 'inProgress', 'blocked', 'active', 'done']
    const sectionDiff = sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section)
    if (sectionDiff !== 0) return sectionDiff

    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    if (a.dueAt) return -1
    if (b.dueAt) return 1

    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority)
    if (priorityDiff !== 0) return priorityDiff

    return a.title.localeCompare(b.title)
  })
}

function pickNextAction(tasks: Task[]) {
  const candidates = tasks.filter((task) => !DONE_STATUSES.has(task.status))
  if (candidates.length === 0) return null

  const inProgress = candidates.find((task) => task.status === 'in-progress')
  if (inProgress) return inProgress

  const dueSoon = sortTasks(candidates.filter((task) => task.dueAt))
  if (dueSoon[0]) return dueSoon[0]

  return [...candidates].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))[0] || null
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

async function loadTasks() {
  const files = await fg('tasks/*.md', {
    cwd: lifeOsRoot,
    absolute: true,
    ignore: ['**/_template.md'],
  })

  const tasks = await Promise.all(
    files.map(async (filePath) => {
      const note = await readMarkdownFile(filePath)
      const dueDate = String(note.data.due_date ?? '').trim()
      const nextReminderTime = String(note.data.next_reminder_time ?? '').trim()
      const dueAt = parseLooseDate(dueDate) || parseLooseDate(nextReminderTime)

      const task: Task = {
        id: note.slug,
        slug: note.slug,
        title: note.title,
        status: String(note.data.status ?? 'todo').trim().toLowerCase(),
        priority: String(note.data.priority ?? '').trim().toLowerCase(),
        area: String(note.data.area ?? '').trim(),
        energyRequired: String(note.data.energy_required ?? '').trim(),
        timeRequired: String(note.data.time_required ?? '').trim(),
        recurrence: String(note.data.recurrence ?? '').trim(),
        project: cleanProjectRef(note.data.project),
        dueDate,
        dueAt: dueAt ? dueAt.toISOString() : null,
        nextReminderTime,
        updated: String(note.data.updated ?? '').trim(),
        tags: toArray(note.data.tags),
        link: `${OBSIDIAN_BASE}${note.relativePath}`,
        section: 'active',
      }

      task.section = taskSection(task)
      return task
    }),
  )

  return sortTasks(tasks)
}

async function loadProjects(tasks: Task[]) {
  const files = await fg('projects/*.md', {
    cwd: lifeOsRoot,
    absolute: true,
    ignore: ['**/_template.md'],
  })

  const projects = await Promise.all(
    files.map(async (filePath) => {
      const note = await readMarkdownFile(filePath)
      const linkedTasks = sortTasks(tasks.filter((task) => task.project === note.slug))

      const project: Project = {
        id: note.slug,
        slug: note.slug,
        title: note.title,
        status: String(note.data.status ?? 'active').trim().toLowerCase(),
        targetDate: String(note.data.target_date ?? '').trim(),
        updated: String(note.data.updated ?? '').trim(),
        tags: toArray(note.data.tags),
        link: `${OBSIDIAN_BASE}${note.relativePath}`,
        openTaskCount: linkedTasks.filter((task) => !DONE_STATUSES.has(task.status)).length,
        overdueTaskCount: linkedTasks.filter((task) => task.section === 'overdue').length,
        dueSoonTaskCount: linkedTasks.filter((task) => task.section === 'dueSoon').length,
        inProgressTaskCount: linkedTasks.filter((task) => task.status === 'in-progress').length,
        tasks: linkedTasks,
        nextAction: pickNextAction(linkedTasks),
      }

      return project
    }),
  )

  return projects.sort((a, b) => {
    const statusScore = Number(b.status === 'active') - Number(a.status === 'active')
    if (statusScore !== 0) return statusScore
    if (a.overdueTaskCount !== b.overdueTaskCount) return b.overdueTaskCount - a.overdueTaskCount
    if (a.dueSoonTaskCount !== b.dueSoonTaskCount) return b.dueSoonTaskCount - a.dueSoonTaskCount
    return a.title.localeCompare(b.title)
  })
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
    obsidianLink: `${OBSIDIAN_BASE}${note.relativePath}`,
    appLink: `/note/${encodeURIComponent(note.slug)}`,
    frontmatter: buildFrontmatter(note.data as Record<string, unknown>),
    markdown: resolveWikiLinks(note.content.trim()),
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, lifeOsRoot })
})

app.get('/api/dashboard', async (_req, res) => {
  try {
    const tasks = await loadTasks()
    const projects = await loadProjects(tasks)
    const summary = {
      tasks: tasks.length,
      overdue: tasks.filter((task) => task.section === 'overdue').length,
      dueSoon: tasks.filter((task) => task.section === 'dueSoon').length,
      inProgress: tasks.filter((task) => task.status === 'in-progress').length,
      blocked: tasks.filter((task) => task.status === 'blocked').length,
      activeProjects: projects.filter((project) => project.status === 'active').length,
    }

    res.json({
      generatedAt: new Date().toISOString(),
      lifeOsRoot,
      summary,
      tasks,
      projects,
    })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'Failed to build dashboard payload.' })
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

app.use(express.static(distDir))

app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next()
  }

  try {
    await fs.access(path.join(distDir, 'index.html'))
    res.sendFile(path.join(distDir, 'index.html'))
  } catch {
    res.status(404).send('Frontend not built yet. Run npm run build or use npm run dev.')
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`LifeOS dashboard running on http://0.0.0.0:${port}`)
  console.log(`Using vault at ${lifeOsRoot}`)
})
