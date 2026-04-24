import fs from 'node:fs/promises'
import path from 'node:path'

export type HermesSessionFile = {
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

export function looksLikeUselessReply(reply: string) {
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
    /^Link:\s*[a-z0-9][a-z0-9-]*(?:\s*)$/i.test(normalized),
  ].some(Boolean)
}

export function chooseHermesFinalReply(parsedReply: string, sessionReply: string) {
  const cleanSessionReply = sessionReply.trim()
  if (cleanSessionReply) return cleanSessionReply

  return parsedReply.trim()
}

export async function readHermesSessionReply(sessionId: string | null, homeDir = process.env.HOME || '', attempts = 5) {
  if (!sessionId) return ''

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const sessionPath = path.join(homeDir, '.hermes', 'sessions', `session_${sessionId}.json`)
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
      // Session files can lag behind process close very briefly; retry before falling back.
    }

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
  }

  return ''
}
