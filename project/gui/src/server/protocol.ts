import type {
  RoomMessage,
  RoomMessageMarker,
  RoomRun,
  RoomSummary,
  StoredStep,
} from './features/rooms/room-store'
import type {
  Schedule,
  ScheduleRun,
  ScheduleRunStep,
} from './features/schedules/schedule-store'
import type {
  Issue,
  IssueRun,
  IssueRunStep,
} from './features/issues/issue-store'
import type { Bulletin } from './features/bulletins/bulletin-store'

export type RoomServerMessage =
  | {
      type: 'room.snapshot'
      room: WorkspaceRoom
      messages: RoomMessage[]
      runs: RoomRun[]
      nextCursor?: string
      latestSteps: StoredStep[]
    }
  | { type: 'message.created'; message: RoomMessage }
  | { type: 'message.updated'; message: RoomMessage }
  | { type: 'run.changed'; run: RoomRun }
  | { type: 'run.step'; runId: string; step: StoredStep }
  | { type: 'room.members.changed'; roomId: string }
export type WorkspaceRoom = RoomSummary & {
  attentionCount: number
  mentionCount: number
  latestOtherMessage?: RoomMessageMarker
  /** Unacked Thread Attention roots for the current Account. */
  threadAttentionRootIds?: string[]
}
export type WorkspaceServerMessage =
  | { type: 'workspace.snapshot'; rooms: WorkspaceRoom[] }
  | { type: 'room.created'; room: WorkspaceRoom }
  | { type: 'room.removed'; roomId: string }
  | {
      type: 'attention.changed'
      roomId: string
      roomName: string
      attentionCount: number
      mentionCount: number
      kind?: 'mention' | 'run_terminal' | 'thread_reply'
      /** Root message id, present when kind is 'thread_reply' or a run_terminal fired from a thread. */
      rootId?: string
    }
  | {
      type: 'message.created'
      roomId: string
      messageId: string
      createdAt: number
      authorId: string
    }
  | { type: 'schedule.created'; schedule: Schedule }
  | { type: 'schedule.changed'; schedule: Schedule }
  | { type: 'schedule_run.created'; run: ScheduleRun }
  | { type: 'schedule_run.changed'; run: ScheduleRun }
  | { type: 'schedule_run.step'; runId: string; step: ScheduleRunStep }
  | { type: 'issue.created'; issue: Issue }
  | { type: 'issue.changed'; issue: Issue }
  | { type: 'issue.deleted'; issueId: string }
  | { type: 'issue_run.created'; run: IssueRun }
  | { type: 'issue_run.changed'; run: IssueRun }
  | { type: 'issue_run.step'; runId: string; step: IssueRunStep }
  | { type: 'bulletin.created'; bulletin: Bulletin }
  | { type: 'bulletin.changed'; bulletin: Bulletin }
  | { type: 'bulletin.moved'; bulletin: Bulletin }
  | { type: 'bulletin.deleted'; bulletinId: string }
export type ServerMessage =
  | RoomServerMessage
  | WorkspaceServerMessage

export type AgentDefinitionSummary = {
  id: string
  name: string
  description: string
  kind?: 'cursor' | 'openai-agents'
  includeRepository: boolean
  visibility?: 'private' | 'workspace'
  creatorAccountId?: string
  creatingAgentId?: string
  updaterAccountId?: string
  updatedAt?: number
  archivedAt?: number
  instructions?: string
  capabilities: { id: string; name: string; tools: string[] }[]
  skills: { id: string; name: string; description: string }[]
  color?: string
}
