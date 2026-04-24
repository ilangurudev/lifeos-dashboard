import { bucketTasksForFilter, resolveTaskTiming, sortTasksByUrgency, type TaskTimingInput } from './taskTiming.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function task(overrides: Partial<TaskTimingInput> = {}): TaskTimingInput {
  return {
    id: 'task',
    title: 'Task',
    status: 'todo',
    priority: 'p2',
    recurrence: 'one-off',
    dueDate: '',
    nextReminderTime: '',
    completedTime: '',
    tags: [],
    ...overrides,
  }
}

const now = new Date('2026-04-23T20:32:00-04:00')

{
  const timing = resolveTaskTiming(
    task({
      dueDate: '2026-05-01 05:00 PM EDT',
      nextReminderTime: '2026-04-24 09:00 AM EDT',
    }),
    now,
  )

  assert(timing.nextActionAt === '2026-04-24T13:00:00.000Z', `expected reminder-first nextActionAt, got ${timing.nextActionAt}`)
  assert(timing.dateBasis === 'reminder', `expected reminder basis, got ${timing.dateBasis}`)
  assert(timing.calendarBucket === 'tomorrow', `expected tomorrow bucket, got ${timing.calendarBucket}`)
}

{
  const timing = resolveTaskTiming(
    task({
      dueDate: '2026-04-24 12:00 AM EDT',
      nextReminderTime: '2026-04-24 09:00 AM EDT',
    }),
    now,
  )

  assert(timing.nextActionAt === '2026-04-24T13:00:00.000Z', `expected same-day midnight due date to be treated as calendar metadata, got ${timing.nextActionAt}`)
  assert(timing.dateBasis === 'reminder', `expected reminder basis for same-day midnight due, got ${timing.dateBasis}`)
}

{
  const timing = resolveTaskTiming(
    task({
      dueDate: '2026-04-24 08:00 AM EDT',
      nextReminderTime: '2026-04-24 09:00 AM EDT',
    }),
    now,
  )

  assert(timing.nextActionAt === '2026-04-24T12:00:00.000Z', `expected earlier due date to win, got ${timing.nextActionAt}`)
  assert(timing.dateBasis === 'due', `expected due basis, got ${timing.dateBasis}`)
}

{
  const timing = resolveTaskTiming(
    task({
      id: 'dad-birthday-reminder',
      title: "Remember Dad's birthday",
      recurrence: 'yearly',
      tags: ['birthday', 'family'],
      dueDate: '2026-04-14 12:00 AM EDT',
      nextReminderTime: '2027-03-31 09:00 AM EDT',
      completedTime: '2026-04-13 8:32 PM EDT',
    }),
    now,
  )

  assert(!timing.isOverdue, 'expected completed yearly birthday occurrence not to be overdue')
  assert(timing.nextActionAt === '2027-03-31T13:00:00.000Z', `expected next reminder cycle, got ${timing.nextActionAt}`)
  assert(timing.calendarBucket === 'moreThanMonth', `expected collapsed later bucket, got ${timing.calendarBucket}`)
}

{
  const tasks = [
    task({ id: 'later', title: 'Later', dueDate: '2026-05-20 09:00 AM EDT' }),
    task({ id: 'progress-tomorrow', title: 'Progress Tomorrow', status: 'in-progress', nextReminderTime: '2026-04-24 09:00 AM EDT' }),
    task({ id: 'overdue', title: 'Overdue', dueDate: '2026-04-22 09:00 AM EDT' }),
  ].map((input) => ({ ...input, timing: resolveTaskTiming(input, now) }))

  const sorted = sortTasksByUrgency(tasks).map((item) => item.id)
  assert(sorted.join(',') === 'overdue,progress-tomorrow,later', `expected urgency sort, got ${sorted.join(',')}`)

  const allActive = bucketTasksForFilter(tasks, 'allActive').map((item) => item.id)
  assert(allActive.includes('progress-tomorrow'), 'expected in-progress task under all active')

  const dueSoon = bucketTasksForFilter(tasks, 'dueSoon').map((item) => item.id)
  assert(dueSoon.includes('progress-tomorrow'), 'expected in-progress task under due soon')
}

console.log('taskTiming tests passed')
