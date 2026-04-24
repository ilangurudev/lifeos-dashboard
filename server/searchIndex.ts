export type SearchIndexSourceNote = {
  slug: string
  title: string
  folder: string
  relativePath: string
  body: string
  updated: string
}

export type SearchResult = {
  slug: string
  title: string
  folder: string
  relativePath: string
  appPath: string
  updated: string
  score: number
}

type SearchIndexEntry = SearchIndexSourceNote & {
  normalizedTitle: string
  normalizedSlug: string
  normalizedBody: string
  normalizedPath: string
}

export type SearchIndex = {
  entries: SearchIndexEntry[]
  builtAt: string
}

const NORMAL_FOLDER_APP_PATHS = new Set(['tasks', 'projects', 'notes', 'people', 'goals', 'check-ins', 'journal'])

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenizeQuery(query: string) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function appPathFor(note: SearchIndexSourceNote) {
  if (NORMAL_FOLDER_APP_PATHS.has(note.folder)) return `/note/${encodeURIComponent(note.slug)}`
  return `/note-path?path=${encodeURIComponent(note.relativePath)}`
}

function scoreEntry(entry: SearchIndexEntry, tokens: string[], normalizedQuery: string) {
  let score = 0

  if (entry.normalizedTitle === normalizedQuery) score += 1200
  if (entry.normalizedTitle.startsWith(normalizedQuery)) score += 800
  if (entry.normalizedTitle.includes(normalizedQuery)) score += 500
  if (entry.normalizedSlug.includes(normalizedQuery)) score += 250
  if (entry.normalizedPath.includes(normalizedQuery)) score += 100

  for (const token of tokens) {
    if (entry.normalizedTitle.split(' ').includes(token)) score += 180
    else if (entry.normalizedTitle.includes(token)) score += 120

    if (entry.normalizedSlug.includes(token)) score += 60
    if (entry.normalizedPath.includes(token)) score += 30

    const bodyIndex = entry.normalizedBody.indexOf(token)
    if (bodyIndex !== -1) {
      score += 35
      if (bodyIndex < 500) score += 10
    }
  }

  if (tokens.length > 1 && entry.normalizedBody.includes(tokens.join(' '))) score += 80

  return score
}

export function buildSearchIndex(notes: SearchIndexSourceNote[]): SearchIndex {
  return {
    builtAt: new Date().toISOString(),
    entries: notes.map((note) => ({
      ...note,
      normalizedTitle: normalizeSearchText(note.title),
      normalizedSlug: normalizeSearchText(note.slug),
      normalizedBody: normalizeSearchText(note.body),
      normalizedPath: normalizeSearchText(note.relativePath),
    })),
  }
}

export function searchNotes(index: SearchIndex, query: string, limit = 5): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  const tokens = tokenizeQuery(query)
  if (!normalizedQuery || tokens.length === 0 || limit <= 0) return []

  return index.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens, normalizedQuery) }))
    .filter((result) => result.score > 0)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      return left.entry.title.localeCompare(right.entry.title)
    })
    .slice(0, limit)
    .map(({ entry, score }) => ({
      slug: entry.slug,
      title: entry.title,
      folder: entry.folder,
      relativePath: entry.relativePath,
      appPath: appPathFor(entry),
      updated: entry.updated,
      score,
    }))
}
