import { expect, test } from 'bun:test'
import { agentInk, agentMarkClass, isAgentMentionId } from './agent-color'

test('known agents map to distinct Colony mark tokens', () => {
  expect(agentMarkClass('software-engineer')).toBe(
    'text-agent-software-engineer',
  )
  expect(agentMarkClass('antboy')).toBe('text-agent-antboy')
})

test('unknown agent ids hash stably into fallback mark tokens', () => {
  expect(agentMarkClass('other')).toBe(agentMarkClass('other'))
  expect(agentMarkClass('other').startsWith('text-')).toBe(true)
})

test('named agent ids are mention agents even before definitions load', () => {
  expect(isAgentMentionId('antboy')).toBe(true)
  expect(isAgentMentionId('software-engineer')).toBe(true)
  expect(isAgentMentionId('ada')).toBe(false)
  expect(isAgentMentionId('ada', ['ada-bot'])).toBe(false)
  expect(isAgentMentionId('ada-bot', ['ada-bot'])).toBe(true)
})

test('a stored hex color wins over the hashed mark token', () => {
  expect(agentMarkClass('other', '#1d4ed8')).toBe('')
  expect(agentInk('#1D4ED8')).toBe('#1d4ed8')
  expect(agentInk(undefined)).toBeUndefined()
})
