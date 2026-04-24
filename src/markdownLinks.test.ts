import { internalNotePathFromHref } from './markdownLinks.ts'

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`)
  }
}

assertEqual(internalNotePathFromHref('/note/laya'), '/note/laya')
assertEqual(internalNotePathFromHref('/note-path?path=.agents-log%2Flatest.md'), '/note-path?path=.agents-log%2Flatest.md')
assertEqual(
  internalNotePathFromHref('http://impetus.tail168188.ts.net:3007/note/prep-for-laya-passport-appointment', 'http://impetus.tail168188.ts.net:3007'),
  '/note/prep-for-laya-passport-appointment',
)
assertEqual(
  internalNotePathFromHref('http://127.0.0.1:3007/note/prep-for-laya-passport-appointment', 'http://impetus.tail168188.ts.net:3007'),
  '/note/prep-for-laya-passport-appointment',
)
assertEqual(
  internalNotePathFromHref('https://ilangurudev.github.io/obsidian-links/?file=tasks/prep-for-laya-passport-appointment.md'),
  '/note/prep-for-laya-passport-appointment',
)
assertEqual(
  internalNotePathFromHref('https://ilangurudev.github.io/obsidian-links/?file=.agents-log/lint-reports/latest.md'),
  '/note-path?path=.agents-log%2Flint-reports%2Flatest.md',
)
assertEqual(internalNotePathFromHref('https://example.com/note/nope'), null)

console.log('markdownLinks tests passed')
