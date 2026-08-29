import {
  createRunExecutor,
  type RunExecutor,
  type StartRunRequest,
  type PreparedWorkspace,
  type PreviewConfiguration,
} from "../runs";
import {
  type AgentDefinition,
  type AgentRuntimeKind,
  type CursorRuntimeConfig,
} from "./definition";
import type { AgentGrantContext } from "./grant-context";
import {
  createRepositoryWorkspaceProvisioner,
  type AttachmentInput,
  type AttachmentSource,
  type RepositoryCheckoutSource,
  type RepositoryInput,
  type SkillSource,
  type WorkspaceInput,
} from "../inputs/repository";
import { createRoutingAgentRuntime } from "../providers/routing-agent-runtime";
import type { AgentRole } from "../roles/role";
import { instructionsForInvocation } from "../roles/invocation";
import type { OpenAICompatibleModel } from "../runtime/openai-agents";
import { createCapabilitySessionFactory } from "../mcp/session";
import {
  createMcpGateway,
  type McpGrant,
  type McpUpstream,
} from "../mcp/gateway";
import type { Sandbox, SandboxProvider } from "../sandboxes";
import {
  SOFTWARE_ENGINEER_ID,
  WORKSPACE_ROSTER,
  capabilityToolLabel,
  rosterNotConfiguredMessage,
} from "./roster-meta";
import type { SelectGrantedTools } from "./grant-tools";

export * from "./roster-meta";

const defaultLimits = {
  maxDurationMs: 30 * 60 * 1000,
  maxOutputBytes: 1024 * 1024,
  maxSteps: 500,
};

export interface AgentCapabilityContext {
  workspace?: PreparedWorkspace;
  sandbox?: Pick<Sandbox, "exec" | "hostGateway">;
  grantContext?: AgentGrantContext;
}

/**
 * Eligibility is decided before a workspace or sandbox exists, so `applies`
 * sees only the grant context. Gate on prepared inputs in `createUpstream`.
 */
export type AgentEligibilityContext = Pick<AgentCapabilityContext, "grantContext">;

export interface WorkspaceAgentAdapter {
  repository?: {
    input: RepositoryInput;
    source: RepositoryCheckoutSource;
  };
  capability?: {
    id: string;
    /** Tool names when this capability is not role-requested (Connection links). */
    tools?: readonly string[];
    resources?: McpGrant["resources"];
    applies?(context: AgentEligibilityContext): boolean;
    createUpstream(context: AgentCapabilityContext): McpUpstream;
  };
}

export type WorkspaceAgentStartRunRequest = Omit<
  StartRunRequest<WorkspaceInput>,
  "agentDefinitionId" | "definitionId" | "inputs" | "capabilityGrant"
> & {
  attachments?: readonly AttachmentInput[];
  agentDefinitionId?: string;
};

export type WorkspaceAgentExecutor = Omit<
  RunExecutor<WorkspaceInput>,
  "startRun"
> & {
  startRun(request: WorkspaceAgentStartRunRequest): string;
};

function personCapabilities(role: AgentRole): Map<string, readonly string[]> {
  return new Map(
    role.requestedCapabilities.map((capability) => [
      capability.id,
      capability.tools,
    ]),
  );
}

/**
 * Workspace roster executor: software-engineer (cursor + repo) and antboy
 * (openai-agents, no repo).
 */
export function createWorkspaceAgentsExecutor(options: {
  model?: () => OpenAICompatibleModel;
  cursor?: () => CursorRuntimeConfig;
  /** Explicit Bun/OpenAI Agents image for antboy. */
  image?: string;
  /** Explicit Cursor agent image for software-engineer. */
  cursorImage?: string;
  adapters?: readonly WorkspaceAgentAdapter[];
  /** Configured + linked Connection adapters for one agent, resolved at grant time. */
  connectionAdapters?: (
    agentDefinitionId: string,
  ) => readonly WorkspaceAgentAdapter[];
  createCapabilityEndpoint?: (
    gateway: ReturnType<typeof createMcpGateway>,
    context: AgentCapabilityContext,
  ) => {
    url: string;
    close(): Promise<void>;
  };
  sandboxProvider: SandboxProvider;
  getPreviewConfig?: () => PreviewConfiguration | undefined;
  attachmentSource?: AttachmentSource;
  skillSource?: SkillSource;
  /** Host-side grant narrowing. Must not use a sandbox or tools. */
  selectTools?: SelectGrantedTools;
}): WorkspaceAgentExecutor {
  const adapters = options.adapters ?? [];
  const repositories = adapters.flatMap((adapter) =>
    adapter.repository ? [adapter.repository] : [],
  );
  if (repositories.length > 1) {
    throw new Error("A workspace roster currently supports one repository adapter");
  }
  const capabilityAdapters = adapters.flatMap((adapter) =>
    adapter.capability ? [adapter.capability] : [],
  );
  type CapabilityAdapter = NonNullable<WorkspaceAgentAdapter["capability"]>;

  const openaiImage =
    options.image ?? Bun.env.SWEAT_AGENT_IMAGE ?? "sweat-agent:latest";
  const cursorImage =
    options.cursorImage ??
    Bun.env.SWEAT_CURSOR_AGENT_IMAGE ??
    "sweat-agent-cursor:latest";

  const imagesByKind: Record<AgentRuntimeKind, string> = {
    cursor: cursorImage,
    "openai-agents": openaiImage,
  };

  const byId = new Map(
    WORKSPACE_ROSTER.map((person) => [person.id, person] as const),
  );
  const allRequested = new Map(
    WORKSPACE_ROSTER.map((person) => [
      person.id,
      personCapabilities(person.role),
    ] as const),
  );
  const unionRequested = new Map<string, readonly string[]>();
  for (const requested of allRequested.values()) {
    for (const [id, tools] of requested) {
      if (!unionRequested.has(id)) unionRequested.set(id, tools);
    }
  }

  const capabilityIds = new Set<string>();
  capabilityAdapters.forEach((adapter) => {
    if (capabilityIds.has(adapter.id)) {
      throw new Error(`Duplicate workspace agent capability adapter: ${adapter.id}`);
    }
    capabilityIds.add(adapter.id);
    if (!unionRequested.has(adapter.id)) {
      throw new Error(`No roster person requested capability: ${adapter.id}`);
    }
  });
  for (const capability of capabilityAdapters) {
    for (const resource of capability.resources ?? []) {
      const repository = repositories[0]?.input;
      if (
        !repository ||
        repository.provider !== resource.provider ||
        repository.repository !== resource.repository
      ) {
        throw new Error(
          `Workspace agent capability ${capability.id} requires its repository adapter`,
        );
      }
    }
  }
  if (!options.model && !options.cursor) {
    throw new Error(
      "Workspace agents executor requires an OpenAI model and/or Cursor runtime config",
    );
  }

  const connectionCapabilityAdapters = (
    agentDefinitionId: string,
  ): CapabilityAdapter[] =>
    (options.connectionAdapters?.(agentDefinitionId) ?? []).flatMap((adapter) =>
      adapter.capability ? [adapter.capability] : [],
    );

  const eligibleAdapters = (
    agentDefinitionId: string,
    grantContext: AgentGrantContext | undefined,
  ): CapabilityAdapter[] => {
    const requested = allRequested.get(agentDefinitionId);
    if (!requested) return [];
    const fromRole = capabilityAdapters.filter((adapter) => {
      if (!requested.has(adapter.id)) return false;
      return adapter.applies ? adapter.applies({ grantContext }) : true;
    });
    const fromConnections = connectionCapabilityAdapters(
      agentDefinitionId,
    ).filter((adapter) =>
      adapter.applies ? adapter.applies({ grantContext }) : true,
    );
    const seen = new Set(fromRole.map((adapter) => adapter.id));
    const merged = [...fromRole];
    for (const adapter of fromConnections) {
      if (seen.has(adapter.id)) continue;
      seen.add(adapter.id);
      merged.push(adapter);
    }
    return merged;
  };

  const needsCapabilityEndpoint =
    capabilityAdapters.length > 0 || Boolean(options.connectionAdapters);
  if (needsCapabilityEndpoint && !options.createCapabilityEndpoint) {
    throw new Error("A capability endpoint is required for workspace agent adapters");
  }

  const capabilities = needsCapabilityEndpoint
    ? createCapabilitySessionFactory({
        // Same eligibility decision as startRun, from the same function, so the
        // gateway can never expose an upstream the person did not request or link.
        createGateway: (context) => {
          const eligible = eligibleAdapters(
            context.grantContext?.agentDefinitionId ?? SOFTWARE_ENGINEER_ID,
            context.grantContext,
          );
          return createMcpGateway({
            upstreams: eligible.map((adapter) =>
              adapter.createUpstream({
                workspace: context.workspace,
                sandbox: context.sandbox,
                grantContext: context.grantContext,
              }),
            ),
          });
        },
        createEndpoint: options.createCapabilityEndpoint!,
      })
    : undefined;

  const selectTools = options.selectTools;
  const executor = createRunExecutor<WorkspaceInput>({
    definitions: {
      resolve(id, grantContext) {
        const person = byId.get(id);
        if (!person) return undefined;
        const image = imagesByKind[person.kind];
        const linkedCapabilities = connectionCapabilityAdapters(id).map(
          (adapter) => ({
            id: adapter.id,
            tools: adapter.tools ?? [],
          }),
        );
        const requestedCapabilities = [
          ...person.role.requestedCapabilities,
          ...linkedCapabilities,
        ];
        if (person.kind === "cursor") {
          if (!options.cursor) return undefined;
          return {
            id: person.id,
            instructions: instructionsForInvocation(
              person.role.instructions,
              grantContext,
            ),
            requestedCapabilities,
            runtime: {
              kind: "cursor",
              image,
              cursor: options.cursor(),
            },
            executionPolicy: defaultLimits,
          } satisfies AgentDefinition;
        }
        if (!options.model) return undefined;
        return {
          id: person.id,
          instructions: instructionsForInvocation(
            person.role.instructions,
            grantContext,
          ),
          requestedCapabilities,
          runtime: {
            kind: "openai-agents",
            image,
            model: options.model(),
          },
          executionPolicy: defaultLimits,
        } satisfies AgentDefinition;
      },
    },
    sandboxes: options.sandboxProvider,
    runtime: createRoutingAgentRuntime({}),
    capabilities,
    ...(selectTools
      ? {
          narrowCapabilityGrant: async ({ task, tools, grantContext }) => {
            const agentDefinitionId =
              grantContext?.agentDefinitionId ?? SOFTWARE_ENGINEER_ID;
            const eligible = eligibleAdapters(agentDefinitionId, grantContext);
            const requested = allRequested.get(agentDefinitionId);
            const bundles = Object.fromEntries(
              eligible.map((adapter) => [
                adapter.id,
                requested?.get(adapter.id) ?? adapter.tools ?? [],
              ]),
            );
            const descriptions: Record<string, string> = {};
            for (const name of tools) {
              const label = capabilityToolLabel(name);
              if (label) descriptions[name] = label;
            }
            return selectTools({
              task,
              eligibleTools: tools,
              bundles,
              descriptions,
            });
          },
        }
      : {}),
    getPreviewConfig: options.getPreviewConfig,
    inputs: createRepositoryWorkspaceProvisioner({
      sources: repositories.map((repository) => repository.source),
      attachmentSource: options.attachmentSource,
      skillSource: options.skillSource,
    }),
  });

  return {
    ...executor,
    startRun(request) {
      const {
        attachments = [],
        task,
        agentDefinitionId = SOFTWARE_ENGINEER_ID,
        ...runRequest
      } = request;
      const person = byId.get(agentDefinitionId);
      if (!person) {
        throw new Error(`Unknown agent definition: ${agentDefinitionId}`);
      }
      if (person.kind === "cursor" && !options.cursor) {
        throw new Error(rosterNotConfiguredMessage("cursor"));
      }
      if (person.kind === "openai-agents" && !options.model) {
        throw new Error(rosterNotConfiguredMessage("openai-agents"));
      }

      const grantContext: AgentGrantContext = {
        ...(runRequest.grantContext ?? {}),
        agentDefinitionId,
      };
      const eligible = eligibleAdapters(agentDefinitionId, grantContext);

      const requested = allRequested.get(agentDefinitionId)!;
      const eligibleTools = eligible.flatMap(
        (adapter) => requested.get(adapter.id) ?? adapter.tools ?? [],
      );
      const attachmentNote = attachments.length
        ? `\n\nAttachments (inspect these paths before acting):\n${attachments
            .map(
              (attachment) =>
                `- ${attachment.filename}: /work/.sweat/attachments/${attachment.id}/${attachment.filename}`,
            )
            .join("\n")}`
        : "";
      const repoInputs = person.includeRepository
        ? repositories.map((repository) => {
            const input = grantContext.repositoryBase
              ? {
                  ...repository.input,
                  revision: grantContext.repositoryBase,
                }
              : repository.input;
            return grantContext.mergeRevisions?.length
              ? { ...input, mergeRevisions: grantContext.mergeRevisions }
              : input;
          })
        : [];
      return executor.startRun({
        ...runRequest,
        grantContext,
        task: `${task}${attachmentNote}`,
        agentDefinitionId,
        inputs: [...repoInputs, ...attachments],
        ...(eligible.length
          ? {
              capabilityGrant: {
                tools: eligibleTools,
                resources: eligible.flatMap(
                  (adapter) => adapter.resources ?? [],
                ),
                expiresAt: new Date(Date.now() + defaultLimits.maxDurationMs),
              },
            }
          : {}),
      });
    },
  };
}
