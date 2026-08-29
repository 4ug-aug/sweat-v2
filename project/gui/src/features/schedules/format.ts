export function formatScheduleWhen(
  value?: number,
  timezone?: string,
): string {
  if (value === undefined) return 'Not scheduled'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(value)
}
