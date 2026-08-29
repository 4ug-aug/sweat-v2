import type { AgentGrantContext } from "../agents/grant-context";

const invocationRoles = [
  {
    id: "oneshot",
    applies: (context: AgentGrantContext | undefined) =>
      Boolean(context?.oneshotId),
    instructions: `You are running a Oneshot: a single bounded Task with one final output and no follow-up turns. Deliver the complete answer in your final response. Do not ask clarifying questions and wait; if information is missing, state assumptions and finish. You are not in a Room — workspace.room tools are unavailable.`,
  },
  {
    id: "chat",
    applies: (context: AgentGrantContext | undefined) =>
      Boolean(context?.chatId),
    instructions: `You are in a Chat: a private multi-turn conversation with one Account. Answer in your assistant text. Ask clarifying questions when they help. Follow-up turns will arrive in this same conversation. You are not in a Room — workspace.room tools are unavailable.`,
  },
  {
    id: "room",
    applies: (context: AgentGrantContext | undefined) =>
      Boolean(context?.roomId),
    instructions: `You are working from a Room. Use workspace.room tools to understand the shared discussion before acting. Use workspace.post_message only for useful progress updates or clarifying questions; deliver the final result in your final response. A Room task may be conversational and may not involve a code repository or failing test.`,
  },
] as const;

export function instructionsForInvocation(
  base: string,
  context?: AgentGrantContext,
): string {
  const role = invocationRoles.find((candidate) => candidate.applies(context));
  return role ? `${base}\n\n${role.instructions}` : base;
}
