const relativeDivisions: [ms: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [1000 * 60 * 60 * 24 * 365, 'year'],
  [1000 * 60 * 60 * 24 * 30, 'month'],
  [1000 * 60 * 60 * 24 * 7, 'week'],
  [1000 * 60 * 60 * 24, 'day'],
  [1000 * 60 * 60, 'hour'],
  [1000 * 60, 'minute'],
  [1000, 'second'],
]
const relativeTimeFormat = new Intl.RelativeTimeFormat('en-US', {
  numeric: 'auto',
})

export function formatRelativeTime(at: number, now = Date.now()): string {
  const diffMs = at - now
  const abs = Math.abs(diffMs)
  for (const [ms, unit] of relativeDivisions) {
    if (abs >= ms || unit === 'second') {
      return relativeTimeFormat.format(Math.round(diffMs / ms), unit)
    }
  }
  return relativeTimeFormat.format(0, 'second')
}
