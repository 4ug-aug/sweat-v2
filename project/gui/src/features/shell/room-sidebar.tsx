import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '#/components/ui/hover-card'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from '#/components/ui/sidebar'
import { toast } from '#/components/ui/toast'
import { GitHubIcon } from '#/components/github-icon'
import { AgentMark } from '#/features/agents/agent-mark'
import { useAgentDefinitions } from '#/features/agents/use-agent-definitions'
import { canDeleteRoom } from '#/features/rooms/permissions'
import type { RoomNotification } from '#/features/rooms/room-notifications'
import type { Author, Room } from '#/features/rooms/types'
import { authClient } from '#/lib/auth-client'
import { isTauriRuntime } from '#/lib/server-config'
import { cn } from '#/lib/utils'
import { AccountFace } from '#/components/avatar'
import { Avatar, AvatarBadge } from '#/components/ui/avatar'
import {
  CalendarClock,
  ChevronRight,
  Cuboid,
  LogOut,
  MessageSquare,
  StickyNote,
  ScrollText,
  Settings,
  Bot,
  Box,
} from 'lucide-react'
import { useState } from 'react'
import { CollapsibleGroup } from './collapsible-group'
import { CreateRoomPopover } from './create-room-popover'
import type { DashboardView } from './dashboard-navigation'
import { RoomMenuItem } from './room-menu-item'

const capabilityIcons: Record<
  string,
  { icon?: string; invertOnDark?: boolean; github?: boolean }
> = {
  'linear.issues': { icon: '/icons/linear.svg' },
  'github.pull-requests': { github: true },
  'asana.tasks': { icon: '/icons/asana.svg' },
  'outline.documents': { icon: '/icons/outline.svg', invertOnDark: true },
  'grafana.observability': { icon: '/icons/grafana.svg' },
}

const isSweatNativeCapability = (capability: { id: string }) =>
  capability.id.startsWith('workspace.')

export function RoomSidebar({
  rooms,
  selectedRoomId,
  onSelect,
  onCreate,
  onDelete,
  createError,
  notificationByRoom,
  onMentionAgent,
  view,
  onOpenAccount,
  onOpenWorkspace,
  onOpenSchedules,
  onOpenAgents,
  onOpenIssues,
  onOpenBulletins,
  onOpenChat,
  onOpenVms,
  user,
}: {
  rooms: Room[]
  selectedRoomId: string | undefined
  onSelect: (roomId: string) => void
  onCreate: (name: string, visibility: 'public' | 'private') => Promise<unknown>
  onDelete: (roomId: string) => Promise<unknown>
  createError: string | undefined
  notificationByRoom: Partial<Record<string, RoomNotification>>
  onMentionAgent: (agentId: string) => void
  view: DashboardView
  onOpenAccount: () => void
  onOpenWorkspace: () => void
  onOpenSchedules: () => void
  onOpenAgents: () => void
  onOpenIssues: () => void
  onOpenBulletins: () => void
  onOpenChat: () => void
  onOpenVms: () => void
  user: Author
}) {
  const { data: agents = [] } = useAgentDefinitions()
  const [roomToDelete, setRoomToDelete] = useState<Room>()

  const roomsByVisibility = (visibility: 'public' | 'private') =>
    rooms.filter((room) => room.visibility === visibility)

  const roomGroup = (visibility: 'public' | 'private') => (
    <CollapsibleGroup
      storageKey={`${visibility}-rooms`}
      label={visibility === 'private' ? 'Private rooms' : 'Public rooms'}
      action={
        <CreateRoomPopover
          group={visibility}
          onCreate={onCreate}
          createError={createError}
        />
      }
    >
      <SidebarMenu>
        {roomsByVisibility(visibility).map((room) => (
          <RoomMenuItem
            key={room.id}
            room={room}
            isActive={view === 'room' && room.id === selectedRoomId}
            notification={notificationByRoom[room.id]}
            canDelete={canDeleteRoom(user, room)}
            onSelect={() => onSelect(room.id)}
            onRequestDelete={() => setRoomToDelete(room)}
          />
        ))}
      </SidebarMenu>
    </CollapsibleGroup>
  )

  return [
    !isTauriRuntime() && (
      <SidebarTrigger
        key="mobile-trigger"
        className="fixed top-3 left-3 z-30 md:hidden"
        title="Open navigation"
      />
    ),
    <Sidebar key="sidebar" variant="inset" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === 'issues'}
                  onClick={onOpenIssues}
                  tooltip="Issues"
                >
                  <Cuboid />
                  <span>Issues</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === 'bulletins'}
                  onClick={onOpenBulletins}
                  tooltip="Bulletin board"
                >
                  <StickyNote />
                  <span>Bulletin board</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === 'chat'}
                  onClick={onOpenChat}
                  tooltip="Chat"
                >
                  <MessageSquare />
                  <span>Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <CollapsibleGroup storageKey="agents" label="Agents">
          <SidebarMenu>
            {agents.map((agent) => (
              <SidebarMenuItem key={agent.id}>
                <HoverCard>
                  <HoverCardTrigger
                    delay={150}
                    closeDelay={200}
                    render={
                      <SidebarMenuButton
                        aria-label={`${agent.name}. View capabilities.`}
                        onClick={() => onMentionAgent(agent.id)}
                      />
                    }
                  >
                    <AgentMark agentId={agent.id} />
                    <span>{agent.name}</span>
                  </HoverCardTrigger>
                  <HoverCardContent side="right" align="start" className="w-80">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-sm font-semibold">{agent.name}</h2>
                      <p className="text-xs text-muted-foreground">
                        {agent.description}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-col gap-3">
                      {agent.capabilities.some(isSweatNativeCapability) && (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <img
                              src="/app-icon.png"
                              alt=""
                              className="size-4 shrink-0 dark:invert"
                            />
                            <p className="text-xs font-medium">Colony Native</p>
                          </div>
                          <div className="ml-6 flex flex-col gap-2">
                            {agent.capabilities
                              .filter(isSweatNativeCapability)
                              .map((capability) => (
                                <div
                                  key={capability.id}
                                  className="flex flex-col gap-1"
                                >
                                  <p className="text-xs font-medium">
                                    {capability.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {capability.tools.join(' · ')}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </div>
                      )}
                      {agent.capabilities
                        .filter(
                          (capability) => !isSweatNativeCapability(capability),
                        )
                        .map((capability) => {
                          const presentation =
                            capabilityIcons[capability.id] ?? {}
                          return (
                            <div
                              key={capability.id}
                              className="flex flex-col gap-1"
                            >
                              <div className="flex items-center gap-2">
                                {presentation.github ? (
                                  <GitHubIcon className="size-4 shrink-0 text-muted-foreground" />
                                ) : presentation.icon ? (
                                  <img
                                    src={presentation.icon}
                                    alt=""
                                    className={cn(
                                      'size-4 shrink-0',
                                      presentation.invertOnDark &&
                                        'dark:invert',
                                    )}
                                  />
                                ) : null}
                                <p className="text-xs font-medium">
                                  {capability.name}
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {capability.tools.join(' · ')}
                              </p>
                            </div>
                          )
                        })}
                      {agent.skills.length > 0 && (
                        <div className="flex flex-col gap-1.5 border-t pt-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            Skills
                          </p>
                          <ul className="flex flex-col gap-1">
                            {agent.skills.map((skill) => (
                              <li key={skill.id}>
                                <HoverCard>
                                  <HoverCardTrigger
                                    delay={100}
                                    closeDelay={100}
                                    render={
                                      <button
                                        type="button"
                                        className="group/skill flex w-full items-start gap-2 rounded-md border border-transparent bg-muted/40 px-2 py-1.5 text-left outline-none transition-colors hover:border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                                      />
                                    }
                                  >
                                    <ScrollText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-medium">
                                        {skill.name.replace(/-/g, ' ')}
                                      </span>
                                      <span className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground">
                                        {skill.description}
                                      </span>
                                    </span>
                                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/skill:opacity-100 group-data-[popup-open]/skill:opacity-100" />
                                  </HoverCardTrigger>
                                  <HoverCardContent
                                    side="right"
                                    align="start"
                                    sideOffset={8}
                                    className="w-72"
                                  >
                                    <div className="flex items-start gap-2">
                                      <ScrollText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                      <div className="min-w-0">
                                        <p className="text-sm font-semibold">
                                          {skill.name.replace(/-/g, ' ')}
                                        </p>
                                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                          {skill.description}
                                        </p>
                                      </div>
                                    </div>
                                  </HoverCardContent>
                                </HoverCard>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </CollapsibleGroup>
        {roomGroup('public')}
        {roomGroup('private')}
      </SidebarContent>
      <SidebarFooter>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === 'schedules'}
                  onClick={onOpenSchedules}
                >
                  <CalendarClock />
                  <span>Schedules</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === 'agents'}
                  onClick={onOpenAgents}
                >
                  <Bot />
                  <span>Agents</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {user.role === 'admin' && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Running machines"
                    isActive={view === 'vms'}
                    onClick={onOpenVms}
                  >
                    <Box />
                    <span>Machines</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {user.role === 'admin' && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Workspace settings"
                    isActive={view === 'workspace'}
                    onClick={onOpenWorkspace}
                  >
                    <Settings />
                    <span>Workspace</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <div className="flex min-w-0 items-center justify-center gap-2 group-data-[collapsible=icon]:justify-center">
          <SidebarMenu className="min-w-0 flex-1 group-data-[collapsible=icon]:flex-none">
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                tooltip="User settings"
                isActive={view === 'account'}
                onClick={onOpenAccount}
              >
                <Avatar>
                  <AccountFace
                    name={user.name}
                    image={user.image}
                    color={user.color}
                    className="size-8 text-xs"
                  />
                  <AvatarBadge className="bg-green-600 dark:bg-green-800" />
                </Avatar>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {user.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    User settings
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Button
            aria-label="Sign out"
            variant="ghost"
            size="icon-sm"
            className="group-data-[collapsible=icon]:hidden"
            onClick={() => void authClient.signOut()}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
      <AlertDialog
        open={roomToDelete !== undefined}
        onOpenChange={(open) => {
          if (!open) setRoomToDelete(undefined)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {roomToDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the room and all of its messages.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const room = roomToDelete
                if (!room) return
                void onDelete(room.id).then((result) => {
                  if (!result) return
                  setRoomToDelete(undefined)
                  toast.add({
                    type: 'success',
                    title: 'Room deleted',
                    description: `${room.name} and its messages were permanently deleted.`,
                  })
                })
              }}
            >
              Delete room
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>,
  ]
}
