import { parseAccountColor } from '#/lib/account-color'

/** Mark fill / mention label. */
const TONES: Record<string, string> = {
  'software-engineer': 'text-agent-software-engineer',
  antboy: 'text-agent-antboy',
}

const MARK_FALLBACK = [
  TONES['software-engineer']!,
  TONES.antboy!,
  'text-green-700 dark:text-green-400',
  'text-yellow-500',
] as const

function toneSlot(agentId: string): number {
  let hash = 2166136261
  for (let i = 0; i < agentId.length; i++) {
    hash ^= agentId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % MARK_FALLBACK.length
}

export function agentInk(color?: string | null): string | undefined {
  return color ? parseAccountColor(color) : undefined
}

export function agentMarkClass(
  agentId: string,
  color?: string | null,
): string {
  if (agentInk(color)) return ''
  return TONES[agentId] ?? MARK_FALLBACK[toneSlot(agentId)]!
}

export function isAgentMentionId(
  id: string,
  definedIds: Iterable<string> = [],
): boolean {
  if (Object.hasOwn(TONES, id)) return true
  for (const defined of definedIds) {
    if (defined === id) return true
  }
  return false
}
