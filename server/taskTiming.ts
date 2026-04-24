import * as chrono from 'chrono-node'

export type TaskSection = 'overdue' | 'dueSoon' | 'blocked' | 'active' | 'done'
export type CalendarBucket = 'today' | 'tomorrow' | 'upcomingWeek' | 'oneToThreeWeeks' | 'moreThanMonth' | 'unscheduled'
export type DateBasis = 'reminder' | 'due' | 'none'
export type TaskFilterKey = 'calendar' | 'overdue' | 'dueSoon' | 'recurring' | 'allActive'

export type TaskTimingInput = {
  id: string
  title: string
  status: string
  priority: string
  recurrence: string
  dueDate: string
  nextReminderTime: string
  completedTime: string
  tags: string[]
}

export type TaskTiming = {
  dueAt: string | null
  reminderAt: string | null
  completedAt: string | null
  nextActionAt: string | null
  dateBasis: DateBasis
  calendarBucket: CalendarBucket
  isOverdue: boolean
  isDueSoon: boolean
  section: TaskSection
}

export type TimedTask<T extends TaskTimingInput = TaskTimingInput> = T & { timing: TaskTiming }

const DONE_STATUSES = new Set(['done'])
const DAY_MS = 24 * 60 * 60 * 1000

export function parseLooseDate(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.toLowerCase() === 'none scheduled' || raw.toLowerCase() === 'never sent') return null
  const parsed = chrono.parseDate(raw)
  if (!parsed || Number.isNaN(parsed.getTime())) return null
  return parsed
}

export function isRecurringTaskLike(task: Pick<TaskTimingInput, 'recurrence'>) {
  const recurrence = task.recurrence.trim().toLowerCase()
  return Boolean(recurrence && recurrence !== 'one-off' && recurrence !== 'none')
}

export function priorityRank(priority: string) {
  const match = priority.match(/p(\d+)/i)
  return match ? Number(match[1]) : 99
}

export function resolveTaskTiming(task: TaskTimingInput, now = new Date()): TaskTiming {
  const status = task.status.trim().toLowerCase()
  const due = parseLooseDate(task.dueDate)
  const reminder = parseLooseDate(task.nextReminderTime)
  const completed = parseLooseDate(task.completedTime)
  const isDone = DONE_STATUSES.has(status)
  const isBlocked = status === 'blocked'
  const recurrenceSatisfied = isRecurringOccurrenceSatisfied(task, due, reminder, completed, now)

  let nextAction: Date | null = null
  let dateBasis: DateBasis = 'none'

  if (reminder) {
    nextAction = reminder
    dateBasis = 'reminder'
  }

  if (due && (!nextAction || shouldDueOverrideReminder(due, reminder)) && !recurrenceSatisfied) {
    nextAction = due
    dateBasis = 'due'
  }

  if (!nextAction && due && !recurrenceSatisfied) {
    nextAction = due
    dateBasis = 'due'
  }

  const isOverdue = Boolean(!isDone && !isBlocked && !recurrenceSatisfied && nextAction && nextAction.getTime() < now.getTime())
  const soonLimit = new Date(now.getTime() + 7 * DAY_MS)
  const isDueSoon = Boolean(!isDone && !isBlocked && !isOverdue && nextAction && nextAction.getTime() <= soonLimit.getTime())

  let section: TaskSection = 'active'
  if (isDone) section = 'done'
  else if (isBlocked) section = 'blocked'
  else if (isOverdue) section = 'overdue'
  else if (isDueSoon) section = 'dueSoon'

  return {
    dueAt: due ? due.toISOString() : null,
    reminderAt: reminder ? reminder.toISOString() : null,
    completedAt: completed ? completed.toISOString() : null,
    nextActionAt: nextAction ? nextAction.toISOString() : null,
    dateBasis,
    calendarBucket: calendarBucketFor(nextAction, now),
    isOverdue,
    isDueSoon,
    section,
  }
}

function shouldDueOverrideReminder(due: Date, reminder: Date | null) {
  if (!reminder) return true
  if (due.getTime() >= reminder.getTime()) return false
  if (isSameLocalDay(due, reminder) && isLocalMidnight(due)) return false
  return true
}

function isRecurringOccurrenceSatisfied(task: TaskTimingInput, due: Date | null, reminder: Date | null, completed: Date | null, now: Date) {
  if (!isRecurringTaskLike(task) || !due || !completed) return false
  if (due.getTime() > now.getTime()) return false

  const hasFutureReminder = Boolean(reminder && reminder.getTime() > now.getTime())
  const completionWindowStart = new Date(due.getTime() - DAY_MS)
  const completedThisOccurrence = completed.getTime() >= completionWindowStart.getTime()

  return completedThisOccurrence && hasFutureReminder
}

function calendarBucketFor(date: Date | null, now: Date): CalendarBucket {
  if (!date) return 'unscheduled'

  const diffDays = dayDiff(date, now)
  if (diffDays <= 0) return 'today'
  if (diffDays === 1) return 'tomorrow'
  if (diffDays <= 7) return 'upcomingWeek'
  if (diffDays <= 21) return 'oneToThreeWeeks'
  return 'moreThanMonth'
}

function dayDiff(date: Date, now: Date) {
  const dateDay = localDateKey(date)
  const nowDay = localDateKey(now)
  const dateUtc = Date.UTC(dateDay.year, dateDay.month - 1, dateDay.day)
  const nowUtc = Date.UTC(nowDay.year, nowDay.month - 1, nowDay.day)
  return Math.floor((dateUtc - nowUtc) / DAY_MS)
}

function isSameLocalDay(left: Date, right: Date) {
  const leftKey = localDateKey(left)
  const rightKey = localDateKey(right)
  return leftKey.year === rightKey.year && leftKey.month === rightKey.month && leftKey.day === rightKey.day
}

function isLocalMidnight(date: Date) {
  const time = localTimeKey(date)
  return time.hour === 0 && time.minute === 0
}

function localTimeKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}

function localDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  }
}

export function sortTasksByUrgency<T extends TimedTask>(tasks: T[]) {
  return [...tasks].sort((a, b) => {
    const sectionOrder: TaskSection[] = ['overdue', 'dueSoon', 'active', 'blocked', 'done']
    const sectionDiff = sectionOrder.indexOf(a.timing.section) - sectionOrder.indexOf(b.timing.section)
    if (sectionDiff !== 0) return sectionDiff

    const aTime = a.timing.nextActionAt ? new Date(a.timing.nextActionAt).getTime() : Number.POSITIVE_INFINITY
    const bTime = b.timing.nextActionAt ? new Date(b.timing.nextActionAt).getTime() : Number.POSITIVE_INFINITY
    if (aTime !== bTime) return aTime - bTime

    const aInProgress = a.status === 'in-progress' ? 0 : 1
    const bInProgress = b.status === 'in-progress' ? 0 : 1
    if (aInProgress !== bInProgress) return aInProgress - bInProgress

    const priorityDiff = priorityRank(a.priority) - priorityRank(b.priority)
    if (priorityDiff !== 0) return priorityDiff

    return a.title.localeCompare(b.title)
  })
}

export function bucketTasksForFilter<T extends TimedTask>(tasks: T[], filter: TaskFilterKey) {
  const activeTasks = tasks.filter((task) => task.timing.section !== 'done' && task.timing.section !== 'blocked')

  switch (filter) {
    case 'calendar':
      return activeTasks.filter((task) => task.timing.calendarBucket !== 'unscheduled')
    case 'overdue':
      return activeTasks.filter((task) => task.timing.section === 'overdue')
    case 'dueSoon':
      return activeTasks.filter((task) => task.timing.section === 'dueSoon')
    case 'recurring':
      return activeTasks.filter((task) => isRecurringTaskLike(task))
    case 'allActive':
      return activeTasks
  }
}
