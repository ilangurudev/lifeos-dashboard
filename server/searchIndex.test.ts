import assert from 'node:assert/strict'
import { buildSearchIndex, searchNotes } from './searchIndex.ts'

const notes = [
  {
    slug: 'alpha-note',
    title: 'Alpha Note',
    folder: 'notes',
    relativePath: 'notes/alpha-note.md',
    body: 'This body mentions newborn passport paperwork and pediatrician forms.',
    updated: '2026-04-22 09:00 AM EDT',
  },
  {
    slug: 'beta-project',
    title: 'Beta Project',
    folder: 'projects',
    relativePath: 'projects/beta-project.md',
    body: 'Dashboard styling work only.',
    updated: '2026-04-23 10:00 PM EDT',
  },
  {
    slug: 'passport-check',
    title: 'Passport Check',
    folder: 'tasks',
    relativePath: 'tasks/passport-check.md',
    body: 'Follow up on mail delivery.',
    updated: '2026-04-24 06:00 AM EDT',
  },
]

const index = buildSearchIndex(notes)

{
  const results = searchNotes(index, 'newborn paperwork', 5)
  assert.equal(results[0]?.slug, 'alpha-note', 'search should match terms from the whole markdown body, not only note titles')
  assert.equal(results[0]?.title, 'Alpha Note')
  assert.equal(results[0]?.appPath, '/note/alpha-note')
}

{
  const results = searchNotes(index, 'passport', 5)
  assert.equal(results[0]?.slug, 'passport-check', 'title matches should outrank body-only matches')
  assert.equal(results[1]?.slug, 'alpha-note')
}

{
  const manyMatches = searchNotes(
    buildSearchIndex(
      Array.from({ length: 8 }, (_, indexNumber) => ({
        slug: `note-${indexNumber}`,
        title: `Note ${indexNumber}`,
        folder: 'notes',
        relativePath: `notes/note-${indexNumber}.md`,
        body: 'shared needle term',
        updated: '',
      })),
    ),
    'needle',
    5,
  )
  assert.equal(manyMatches.length, 5, 'search suggestions must be capped to the requested top count')
}

{
  const emptyResults = searchNotes(index, '   ', 5)
  assert.deepEqual(emptyResults, [], 'blank queries should not return suggestions')
}

console.log('searchIndex tests passed')
