import { expect, test } from 'bun:test'
import { canManageAgentAccess } from './agent-access'

test('only a workspace administrator may attach Connection links or GitHub access', () => {
  expect(canManageAgentAccess({ role: 'admin' })).toBe(true)
  expect(canManageAgentAccess({ role: 'user' })).toBe(false)
  expect(canManageAgentAccess({})).toBe(false)
})
