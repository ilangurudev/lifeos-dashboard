import { formatDashboardDate } from './dateFormat'

const cases: Array<[string, string]> = [
  ['2026-04-23 08:00 PM EDT', '2026-04-23 08:00 PM EDT'],
  ['2026-04-22 07:01 AM EDT', '2026-04-22 07:01 AM EDT'],
  ['2026-04-14T00:00:00.000Z', '2026-04-13 08:00 PM EDT'],
  ['2026-04-25T00:00:00.000Z', '2026-04-24 08:00 PM EDT'],
  ['none scheduled', 'none scheduled'],
  ['', ''],
]

for (const [input, expected] of cases) {
  const actual = formatDashboardDate(input)
  if (actual !== expected) {
    throw new Error(`formatDashboardDate(${JSON.stringify(input)}) expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

console.log('formatDashboardDate tests passed')
