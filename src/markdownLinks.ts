const OBSIDIAN_APPLET_HOST = 'ilangurudev.github.io'
const OBSIDIAN_APPLET_PATH = '/obsidian-links/'
const CANONICAL_NOTE_FOLDERS = new Set(['tasks', 'projects', 'notes', 'people', 'goals', 'check-ins', 'journal'])
const DASHBOARD_HOST_PATTERNS = [/^localhost(?::\d+)?$/i, /^127\.0\.0\.1(?::\d+)?$/i, /\.ts\.net(?::\d+)?$/i]

function slugFromMarkdownPath(relativePath: string) {
  const normalized = relativePath.replace(/^\/+/, '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 2 && CANONICAL_NOTE_FOLDERS.has(parts[0]) && parts[1].endsWith('.md')) {
    return parts[1].replace(/\.md$/i, '')
  }
  return null
}

function isKnownDashboardHost(host: string, currentHost?: string) {
  if (currentHost && host === currentHost) return true
  return DASHBOARD_HOST_PATTERNS.some((pattern) => pattern.test(host))
}

export function internalNotePathFromHref(href: string, currentOrigin?: string) {
  const trimmed = href.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/note/') || trimmed.startsWith('/note-path')) return trimmed

  try {
    const current = currentOrigin ? new URL(currentOrigin) : null
    const parsed = new URL(trimmed, current ?? 'http://localhost')

    if (parsed.hostname === OBSIDIAN_APPLET_HOST && parsed.pathname === OBSIDIAN_APPLET_PATH) {
      const file = parsed.searchParams.get('file')
      if (!file) return null

      const slug = slugFromMarkdownPath(file)
      if (slug) return `/note/${encodeURIComponent(slug)}${parsed.hash}`

      return `/note-path?path=${encodeURIComponent(file)}${parsed.hash}`
    }

    if (isKnownDashboardHost(parsed.host, current?.host) && (parsed.pathname.startsWith('/note/') || parsed.pathname === '/note-path')) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`
    }
  } catch {
    return null
  }

  return null
}
