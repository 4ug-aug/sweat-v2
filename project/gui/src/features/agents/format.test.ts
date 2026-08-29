import { expect, test } from 'bun:test'
import { formatRelativeTime } from './format'

const now = Date.parse('2026-08-29T13:00:00Z')

test('formatRelativeTime names the largest elapsed unit', () => {
  expect(formatRelativeTime(now - 30_000, now)).toBe('30 seconds ago')
  expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago')
  expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe('2 hours ago')
  expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toBe('yesterday')
  expect(formatRelativeTime(now, now)).toBe('now')
})
