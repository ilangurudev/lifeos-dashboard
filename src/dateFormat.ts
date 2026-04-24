const EDT_FORMAT_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} [AP]M E[DS]T$/
const DASHBOARD_TIME_ZONE = 'America/New_York'

const datePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: DASHBOARD_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short',
})

export function formatDashboardDate(value: string | null | undefined) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (EDT_FORMAT_PATTERN.test(raw)) return raw

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw

  const parts = Object.fromEntries(datePartsFormatter.formatToParts(parsed).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.dayPeriod} ${parts.timeZoneName}`
}
