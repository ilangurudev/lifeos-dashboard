import { formatHermesActivityLine, shouldShowHermesLine } from './hermesActivity.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

{
  const line = 'API Request: POST https://api.openai.com/v1/responses'
  assert(!shouldShowHermesLine(line), 'expected generic model request lines to be hidden from chat bubbles')
  assert(formatHermesActivityLine(line, new Map()) === null, 'expected generic model request lines to have no activity bubble')
}

{
  const line = 'Turn ended: stop'
  assert(!shouldShowHermesLine(line), 'expected generic turn-ended lines to be hidden from chat bubbles')
  assert(formatHermesActivityLine(line, new Map()) === null, 'expected turn-ended lines to have no activity bubble')
}

{
  const line = 'Initializing agent with source tool'
  assert(!shouldShowHermesLine(line), 'expected generic initialization lines to be hidden from chat bubbles')
  assert(formatHermesActivityLine(line, new Map()) === null, 'expected initialization lines to have no activity bubble')
}

{
  const line = 'Tool call: read_file with args: {"path":"/home/ilangurudev/my-data/tasks/alfie-routine-care.md"}'
  assert(shouldShowHermesLine(line), 'expected concrete tool activity to still be visible')
  assert(
    formatHermesActivityLine(line, new Map()) === 'Reading tasks/alfie-routine-care.md…',
    'expected concrete tool activity to remain clean and relevant',
  )
}
