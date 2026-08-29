import { rosterMentionHandles } from '#project/agents/roster-meta'
import type { RoomUser } from './room-store'

export const AGENT_MENTION_HANDLES = rosterMentionHandles()

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function mentionedAccounts(
  text: string,
  accounts: RoomUser[],
  agentHandles: ReadonlySet<string> = rosterMentionHandles(),
): RoomUser[] {
  return accounts.filter((account) => {
    const username = account.username ?? account.name
    if (agentHandles.has(username)) return false
    return new RegExp(
      `(^|[\\s([{])@${escaped(username)}(?=$|[\\s.,!?;:\\)\\]}])`,
    ).test(text)
  })
}
