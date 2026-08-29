import { describe, expect, test } from 'bun:test'
import { toolIconId } from './run-tool-icon'

describe('tool icons', () => {
  test('maps brand prefixes, known tools, and a wrench fallback', () => {
    expect(toolIconId('github.create_pull_request')).toBe('github')
    expect(toolIconId('github_create_pull_request')).toBe('github')
    expect(toolIconId('linear.get_issue')).toBe('linear')
    expect(toolIconId('asana.list_tasks')).toBe('asana')
    expect(toolIconId('grafana.query_prometheus')).toBe('grafana')
    expect(toolIconId('outline.fetch')).toBe('outline')
    expect(toolIconId('postgres.query')).toBe('postgres')
    expect(toolIconId('shell')).toBe('shell')
    expect(toolIconId('shell.exec')).toBe('shell')
    expect(toolIconId('workspace.read_messages')).toBe('workspace')
    expect(toolIconId('workspace_read_messages')).toBe('workspace')
    expect(toolIconId('workspace.post_message')).toBe('workspace')
    expect(toolIconId('workspace.list_issues')).toBe('workspace')
    expect(toolIconId('web.search')).toBe('web')
    expect(toolIconId('web.fetch')).toBe('web')
    expect(toolIconId('future_tool')).toBe('wrench')
    expect(toolIconId()).toBe('wrench')
  })
})
