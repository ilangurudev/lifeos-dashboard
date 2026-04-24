// eslint-disable-next-line no-control-regex
const ANSI_REGEX = new RegExp('\\u001B\\[[0-9;?]*[ -/]*[@-~]', 'g')

export type HermesActivityKind = 'status' | 'thinking' | 'tool_call' | 'tool_result' | 'log'

const HERMES_LOG_PATTERNS: Array<{ kind: HermesActivityKind; test: (line: string) => boolean }> = [
  { kind: 'tool_call', test: (line) => line.includes('Tool call:') || line.includes('📞 Tool') },
  { kind: 'tool_result', test: (line) => /Tool .* completed/.test(line) || line.includes('✅ Tool') || line.includes('Result:') },
]

export function stripAnsi(value: string) {
  return value.replace(ANSI_REGEX, '').replace(/\r/g, '')
}

export function cleanHermesLine(value: string) {
  return stripAnsi(value)
    .replace(/[\u2800-\u28FF]/g, '')
    .replace(/^\s*│\s?/, '')
    .trimEnd()
}

export function shouldShowHermesLine(line: string) {
  if (!line.trim()) return false

  return [
    line.includes('Tool call:'),
    /Tool .* completed/.test(line),
  ].some(Boolean)
}

export function classifyHermesLine(line: string): HermesActivityKind {
  for (const pattern of HERMES_LOG_PATTERNS) {
    if (pattern.test(line)) return pattern.kind
  }
  return 'log'
}

export function truncateActivityMessage(line: string, maxLength = 220) {
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

export function parseToolCall(line: string): { tool: string; args: Record<string, unknown> } | null {
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

export function summarizeToolCall(tool: string, args: Record<string, unknown>) {
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

export function formatHermesActivityLine(line: string, recentToolLabels: Map<string, string>): string | null {
  if (line.startsWith('Initializing agent')) return null
  if (line.includes('API Request') || line.includes('API Response') || line.includes('API call #')) return null
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

  if (line.includes('Turn ended:')) return null

  return null
}
