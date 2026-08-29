# Colony context

Colony is an agent orchestration platform that customers can run in their own
infrastructure. It creates on-demand, isolated agent workers for many roles;
software engineering is one possible role, not the platform's default shape.

## Language

**Colony server**: A self-hosted deployment authoritative for one workspace,
including its identity, rooms, history, and runs. A client connects to a Colony
server; it does not own the workspace.
_Avoid_: Backend, instance

**Account**: A person's server-local identity and credentials on one Colony
server. Accounts do not transfer between Colony servers.
_Avoid_: Global identity, identity key

**Username**: A workspace-unique handle associated with an account, used for
sign-in and as the person's primary visible name in the workspace.
_Avoid_: Global username, display name

**Display name**: An optional human-readable account profile label shown with
the account's email in secondary profile details. It does not identify message
authors or room members.
_Avoid_: Username, handle

**Account color**: An optional chosen accent for the account's avatar. When
unset, the avatar uses a color derived from the username.
_Avoid_: Profile color, theme color

**Account mention**: An exact `@username` reference in a room message that
directs another account's attention to that room. Agent identifiers share the
same visible `@` syntax but are not account mentions.
_Avoid_: Notification, assignment

**Attention**: A durable, account-directed reason to return to a Room or Room
thread because of a relevant mention, thread reply, or terminal run;
acknowledging it clears its badge without changing or deleting the shared
record.
_Avoid_: Unread message, notification

**Schedule**: A workspace-owned recurring delegation that starts bounded runs
at configured times. It references an agent definition and reusable task while
each run resolves the current definition and workspace policy. Its creator is
retained as attribution, while its configuration, run history, and results are
shared outside room conversation.
_Avoid_: Scheduled task, cron job, personal automation

**Schedule run**: A bounded run created from a schedule, either when it becomes
due or when a person chooses **Run now**. It is retained in the schedule's
shared history rather than a room timeline.
_Avoid_: Scheduled run, schedule occurrence, background task

**Oneshot run**: A bounded run started by an Account from anywhere in the
workspace without a Room, Issue, or Schedule link. It is private to the
dispatcher. Its Task, steps, and final output appear only in that Account's
Oneshot panel for the life of that dispatch; closing the panel cancels an
active run and discards the result. The agent is instructed that it has a
single final output and no follow-up. Capability grants resolve from the agent
definition with Oneshot grant context (no room tools). Repository preparation
follows the definition as usual; an optional revision may be chosen before
start when the definition includes a repository. It is not a Room, not a Chat,
and not a Schedule run.
_Avoid_: Chat, personal run, direct run, one-shot

**Workspace membership**: A Sweat server's authorization for an account to
participate in its workspace. Authentication proves control of the account;
membership determines whether that person may enter.
_Avoid_: Login, identity

**Server operator**: The person or organization that runs a Sweat server and
controls its deployment configuration. The operator need not participate in
the workspace.
_Avoid_: Workspace administrator, member

**Dedicated Sweat host**: A machine reserved for operating one Sweat server and
its disposable sandboxes. It is not a shared workstation or a general-purpose
agent execution host.
_Avoid_: Worker pool, shared server

**Workspace administrator**: An account authorized to manage workspace-wide
membership and settings. The first administrator is established through the
server's one-time setup flow.
_Avoid_: Server operator, room owner

**Workspace invitation**: A single-use authorization created by a workspace
administrator that lets one person create an account and join the workspace
before its chosen expiration. It is an unbound bearer credential: possession
authorizes its first successful redemption.
_Avoid_: Room invitation, open registration

**Account suspension**: Revocation of an account's workspace access and active
sessions while retaining its profile and authored history.
_Avoid_: Account deletion, member removal

**Workspace**: The customer-owned collaborative environment containing people,
agent definitions, rooms, Chats, Bulletins, and their shared work history.
_Avoid_: Community

**Bulletin**: A workspace-owned freeform markdown note with a position on the
shared Bulletin board. It is not a unit of work and not scoped to a Room.
_Avoid_: Sticky, note, post-it, card (as a domain noun)

**Bulletin board**: The workspace-scoped shared canvas where Bulletins are
positioned. It is not a separate persisted entity.
_Avoid_: Board, corkboard, whiteboard, kanban

**Room**: A durable context in a workspace where people coordinate work and
where related runs and their results remain visible.
_Avoid_: Channel, conversation

**Room thread**: A focused conversation that begins with the first reply to
exactly one root Room message; replies inherit the Room's access and retention,
stay out of its main timeline, and cannot form nested threads.
_Avoid_: Chat thread, reply rail, sub-Room

**Thread reply**: A visible contribution after the root of a Room thread,
including a Room message or a successful Room-linked run's final result but
excluding run activity and failed or cancelled runs.
_Avoid_: Run step, nested message

**Room thread participant**: An Account that authored the root or a reply in a
Room thread and therefore receives Attention for later replies by others.
_Avoid_: Follower, subscriber, Room member

**Thread Attention**: Attention created for the root author and prior Account
participants by a later reply from someone else; opening the Room thread
acknowledges it, while opening only the containing Room does not, and its badge
is aggregated onto the Room without marking the flat timeline unread.
_Avoid_: Room unread, thread notification

**Room-linked run**: A run invoked by an agent mention in a Room message;
top-level invocations retain Room-scoped message tools and write into a thread
rooted at the triggering message, while thread invocations receive
thread-scoped message tools and write into that existing thread, and every
mention starts a new bounded run without a retained provider conversation.
_Avoid_: Room agent, flat run

**Oneshot**: An ephemeral, bounded, single-turn run started from the workspace
launcher whose Task and result are not retained as workspace history.
_Avoid_: Quick run, one-shot prompt, temporary Room, Chat

**Chat**: An account-owned, private, multi-turn conversation with one agent
definition. Its transcript lasts; it is not shared as workspace history. Not a
Room and not a Oneshot.
_Avoid_: Room, DM, thread, personal Room

**Chat message**: One user or assistant turn in a Chat. An assistant turn may
include that turn's tool steps from its Chat-linked run.
_Avoid_: Room message, Oneshot step

**Chat-linked run**: A warm run bound to one Chat. Follow-up sends reuse the
provider session; idle TTL recycles it; the next send starts a new warm run
rehydrated from the persisted transcript.
_Avoid_: Room-linked run, Oneshot

**Room attachment**: Durable bytes and metadata attached to one room message.
When that message starts a run, the server verifies and copies the attachment
into that run's disposable `/work/.sweat/attachments/<id>/<filename>` input;
the room original remains outside the sandbox.
_Avoid_: Artifact, workspace file

**Task**: The plain-text assignment supplied by a run to an agent runtime.
_Avoid_: Prompt, Issue

**Issue**: A workspace-owned unit of work — not scoped to a Room — that people
and agents can create, update, and be assigned to. Issues are the agent-work
surface: people aim and review; agents execute via Issue-linked runs. An Issue
may have a parent Issue; a parent groups child Issues toward one outcome. An
Issue may name a single
**owner** and may link to one or more **runs** that execute work toward it.
Assigning an Agent definition as owner starts an Issue-linked run on that
Issue when none is already active; assigning an Account sets ownership only
and the starter later chooses which agent runs. It is not a run and not the
plain-text task a run supplies to an agent runtime.
_Avoid_: Task, ticket, work item, Objective (as a separate type), Epic, Project,
room Issue

**Issue id**: The human-visible identifier for an Issue, shaped like `SWE-123`
(fixed `SWE` prefix plus a monotonic workspace number). It is what people and
agents cite in prompts and UI, distinct from any internal storage key.
_Avoid_: UUID-as-display-id, ticket number, per-workspace prefix

**Issue owner**: The single Account or Agent definition responsible for an
Issue. Child Issues keep their own owners; assigning a parent does not cascade
ownership. Assigning an Agent definition starts that Issue's run even when a
parent Issue-linked run is active. Agent-to-agent hand-off is assigning (or
creating) Issues to other agent definitions, not a separate delegation type
and not an in-sandbox subagent.
_Avoid_: Assignee, owners (plural), worker, run participant, parent cover

**Issue creator**: The Account or Agent definition that created the Issue.
Retained as attribution; it is distinct from the Issue owner and does not
change when ownership is assigned.
_Avoid_: Author, reporter, opened by

**Issue time spent**: An ordered list of minute durations logged against an
Issue. Total spent is the sum of those numbers; v1 entries carry no actor or
timestamp.
_Avoid_: Estimate, timesheet, time entry (as a full audit record)

**Issue timing**: A client-side clock against one Issue. Stopping appends the
elapsed minutes to that Issue's time spent. Only one Issue may be timed at a
time.
_Avoid_: Timesheet, server-persisted timer, estimate

**Issue status**: Where an Issue sits in the workspace workflow. V1 statuses
are Backlog, Todo, In progress, In review, and Done, in that order. Starting
a run linked to an Issue moves it to In progress, including when it was In
review; run completion does not change status. Done is not moved by run start.
An Issue with a direct child that is not In review or Done cannot itself be
In review or Done.
_Avoid_: State, column, phase

**Issue-linked run**: A run started from an Issue to execute work toward it.
Assigning an Agent definition as owner starts one when no run is already
active; otherwise Start run remains explicit. Child Issues start this way even
while a parent run is active. V1 builds that run's Task from a fixed platform
delegation prompt that includes the Issue id, title, and description, plus
parent context when nested and direct child summaries (including Deliverable
when set) when the Issue has children. The prompt is not user-editable yet.
When the Issue has an Issue branch, prepare uses that branch as the Git
workspace revision. When the run succeeds, the platform copies its final
output onto the Issue Deliverable. Run success does not move Issue status; the
agent sets In review or Done when its work is ready.
_Avoid_: Issue task (ambiguous with Task), assignment run, parent cover

**Issue integrate run**: An Issue-linked run the platform starts on an
agent-owned parent when every direct child is In review or Done, the parent
itself is not, and no Issue-linked run is already active. It is not a distinct
run kind. The trigger is that settlement (or the parent run ending if children
already settled), not a standing retry while the parent stays agent-owned. A
failed child stays In progress and idle until someone assigns or Start run; it
blocks integrate. The parent may create further child Issues during the run;
it cannot settle until every direct child is In review or Done. Its Git
workspace is the parent Issue branch plus each direct child's published head;
if those heads do not merge cleanly, the run fails.
_Avoid_: Follow-up run, warm run, coordinator run, subagent run, parent cover

**Issue Deliverable**: The durable text on an Issue that holds the latest
successful Issue-linked run's final output. Each successful run overwrites it;
failed or cancelled runs leave it unchanged. It is distinct from the Issue
description and from per-run retained output history.
_Avoid_: Agent response, result message, run stdout (as the Issue-facing field)

**Issue priority**: How urgently an Issue should be handled relative to others.
V1 levels match Linear: No priority, Low, Medium, High, Urgent.
_Avoid_: Severity, rank

**Issue tag**: A free-form label on an Issue. An Issue may have many tags.
_Avoid_: Label (as a separate type), category, Objective

**Issue branch**: An optional repository branch bound to an Issue. When set,
an Issue-linked run prepares its Git workspace from that branch rather than
only the workspace default base. If unset, the Issue inherits the nearest
ancestor's Issue branch when one exists. Any Issue may carry an Issue branch.
When a non-root Issue-linked run starts and the
tree has no Issue branch, the platform binds `sweat/issue/COL-N` on the root
(N is the root's number) and creates that remote ref from the repository
default if it does not exist. Publish still uses a platform-assigned run branch;
the pull request's merge base is the Issue branch when bound (or inherited), so
child Issues can integrate into the parent's line before that line merges to the
repository default base. When an Issue-linked run successfully creates a pull
request and the Issue has no own Issue branch yet, the platform binds that run
branch onto the Issue so the work is discoverable from the Issue; an existing
binding (including the platform root line) is left unchanged. That own binding
is the Issue's published head. An Issue
integrate run prepares from the parent's Issue branch merged with each direct
child's published head, not from inherited effective branches.
_Avoid_: Run branch, sweat/<runId>, PR branch (as synonyms for this binding)

**Issue tools**: First-party agent tools for reading and writing Colony Issues.
They are granted as a workspace capability (`workspace.issues`) over the same
MCP session path as other capabilities (for example `workspace.room`), not as
Linear/Asana tools and not as a cross-provider tracker abstraction. A grant
covers the whole workspace's Issues, not a single Issue. V1 tools are
list/get/create/update plus assign (set the Issue owner to an Account or Agent
definition). Get/list expose related-work facts on each Issue (status, owner,
whether a run is active, Deliverable, parent, direct children) so agents
coordinate through the Issue tree rather than a messenger. They replace Linear
as the software-engineer work-item path; Asana remains an optional external
capability when configured.
_Avoid_: linear.issues, task tools (ambiguous), generic task-management API,
agent chat, agent messenger

**System instructions**: The role-owned instructions supplied by an agent
definition.
_Avoid_: Task prompt

**Skill**: A workspace-owned markdown instruction pack in the Agent Skills
shape — name, description, and procedural guidance — that an agent definition
may have attached. It is not a capability, not a tool, and not the role's
system instructions.
_Avoid_: Capability, tool, plugin, system instructions, prompt template

**Skill package**: The imported unit in the workspace skill catalog: a
`SKILL.md` file plus optional markdown reference files.
_Avoid_: Plugin, zip blob (as the domain concept)

**Skill attachment**: Durable workspace configuration that links one catalog
Skill to one agent definition. Attachments are not chosen when a run starts.
_Avoid_: Run input, per-invocation skill, capability grant

**Connection**: A workspace-owned external provider setup (credentials and
non-secret fields) for one registered Connection kind. It is not a capability
grant, not a first-party workspace tool, and not GitHub or other core
role-requested capabilities.
_Avoid_: Integration, tenant connection (as a synonym in product UI), OAuth
connection (unless that is the kind's auth), core capability

**Connection kind**: A code-registered provider shape — identity, display,
config fields, capability id, and adapter — from which Connection cards and
persistence are derived. Adding a kind is a code change, not admin-defined MCP.
_Avoid_: Plugin, user-defined integration, custom MCP catalog entry

**Connection link**: Durable workspace configuration that links one Configured
Connection to one agent definition. Links are not chosen when a run starts.
Clearing a Connection's credentials also clears its links.
_Avoid_: Connection attachment, capability grant, Skill attachment

**Postgres tools**: First-party agent tools for a workspace-configured Postgres
database, granted as the Connection capability `postgres.sql`. Credentials stay
in the platform gateway. Access is Read or Read+Write; neither allows DELETE or
schema changes. The workspace administrator is expected to create a matching
Postgres role.
_Avoid_: per-user database credentials, generic SQL dialect tools, sandbox
database URL

**Model endpoint**: The OpenAI-compatible provider URL selected by the
workspace and resolved into one run's model configuration when that run's
agent runtime kind is `openai-agents`. It may be a hosted service or a model
server operated elsewhere on the customer's network.
_Avoid_: Sandbox provider, agent runtime kind, Cursor runtime

**Agent runtime kind**: Which in-sandbox agent loop a person uses — currently
`cursor` (Cursor local SDK) or `openai-agents` (OpenAI Agents SDK against a
model endpoint). Declared on the agent definition with an explicit image;
credentials are resolved by composition from workspace settings, never
stored on the definition.
_Avoid_: Sandbox provider, model endpoint, LLM provider (UI label for model endpoint config)

**Step**: A single recorded event in a run's execution. A run produces an
ordered **step history**. V1 has three step kinds:

- `message` — assistant narration text the agent writes between tool calls
  (what the UI may friendlily call "reasoning"; it is not a provider-specific
  chain-of-thought token stream, which v1 deliberately does not capture).
- `tool_call` — the agent invokes a tool: tool name and arguments.
- `tool_result` — the tool returns: its outcome, i.e. "the resource the
  agent pulled".

A tool invocation is two steps (`tool_call` then `tool_result`), so the live
indicator can show a call the instant it starts and a tool that never returns
still leaves a visible record. The live activity indicator shows the latest
step; the audit view shows the whole history.
_Avoid_: Event (too generic), Trace, Log line

Step visibility inherits the room's existing shared-room trust boundary: every
member already sees the run's task and result, so they also see its steps. This
slice adds no per-user or private-step visibility model. Two hard invariants:
steps never carry technical credentials (the model API key or MCP session
token), and step payloads are bounded and truncated like retained output. See
[ADR 0003](docs/adr/0003-structured-step-stream-over-container-stdout.md).

**Preview**: A run-scoped HTTP surface for Accounts, forwarded from the
workspace-configured guest port on that run's sandbox. It is not a Step, not
an agent tool, and not the agent's narrative stream. It exists only while the
sandbox is up, including a grace interval after a succeeded or failed run;
cancellation disposes immediately. See
[ADR 0025](docs/adr/0025-git-workspace-preview.md).
_Avoid_: App stream, agent preview, live URL, startup script, entrypoint

**Preview configuration**: Workspace-owned administrator settings for Preview:
an optional finite init command, a Preview command, a guest port, and a grace
duration. Applied only when a run's entrypoints prepared a Git workspace and a
Preview command is set; otherwise the run skips Preview.
_Avoid_: Startup script, Smolfile, software-engineer settings, agent
definition config

**Preview command**: The long-running bring-up process started from Preview
configuration after entrypoints complete. The agent loop starts without
waiting for it to become reachable. If it exits, Preview is dead and the run
continues. The agent is told only via an auditable Task note that this command
was started — not a URL, port, or extra env.
_Avoid_: Entrypoint (entrypoints must complete), startup script, verify
command

**waiting on**: The current platform-managed work during `preparing` — workspace
prepare, sandbox create, optional Preview init, Preview start. It is not a
Step. The live activity indicator shows this string until the agent runtime
emits Steps. Cleared when the run becomes `running` or terminals.
_Avoid_: Step, phase, status, event

**preparation**: The ordered list of finished waiting-on work on a run
(workspace prepared, sandbox created, init ran, Preview started). Kept after
the run is `running` so activity can show that work above Steps. Not a Step
and not a Machine console.
_Avoid_: Step history, log, event

**Machine console**: Admin-only retained output from a live smolvm sandbox:
Preview init, the Preview command, and guest dockerd. It is not a Step, not
Preview, and not Account-facing Run activity. Used to diagnose a Preview that
is not yet reachable.
_Avoid_: Step, logs (generic), serial console, smolvm serve /logs

## Core boundaries

Keep these three concepts separate:

```text
Agent definition  -> what kind of worker is this?
Run/job            -> what should it do now?
Sandbox            -> where does it execute?
```

An **agent definition** is one person in the workspace (for example
`software-engineer` or `antboy`). It defines that person's system instructions,
requested capabilities, **agent runtime kind**, explicit image, and
execution limits. It does not hold provider credentials or choose run inputs.

**software-engineer**: The coding person. Runtime kind `cursor`, with GitHub
and repository checkout among its capabilities when granted.
_Avoid_: software-engineer-cursor, Cursor engineer

**antboy**: A non-GitHub collaborator person. Runtime kind `openai-agents`,
with room, task, wiki, shell, and attachment access when granted, but no GitHub
capability and no repository clone into `/work`.
_Avoid_: general-purpose agent, assistant

A **run/job** selects an agent definition and supplies its task plus optional
context.

A **sandbox** is a generic, disposable execution environment. It starts in
`/work`, which is empty unless a run deliberately prepares inputs there. It
must not assume a repository or GitHub. When a Preview is started, the sandbox
stays up through Preview grace after the run succeeds or fails; a cancelled
run disposes immediately.

**Sandbox provider**: The explicitly deployment-selected adapter that creates,
executes within, and disposes of a sandbox. It fulfils the same sandbox launch
contract regardless of the technology underneath (microVM or container). The
operator selects among `smolvm` (the default), `apple-container`, and
`docker`. Preview — bring-up, port forward, grace — is part of that contract.
Docker-in-VM is how the smolvm adapter lets a Git-workspace person's image run
the project's own containers. See
[ADR 0007](docs/adr/0007-compose-sandbox-provider-explicitly.md) and
[ADR 0024](docs/adr/0024-smolvm-default-sandbox-provider.md).
_Avoid_: Runtime, agent provider, agent runtime kind

## Runtime and models

The agent reasoning loop runs inside the disposable sandbox. Each
person declares an **agent runtime kind** and an explicit image; composition
injects the matching workspace credentials. Do not duplicate a person merely to
select a different engine. See
[ADR 0008](docs/adr/0008-agent-runtime-kind-on-definition.md).

For `openai-agents`, model configuration remains OpenAI-compatible and
provider-neutral:

```ts
{
  (provider, baseUrl, apiKey, model);
}
```

For `cursor`, the workspace supplies a Cursor API key and model id; inference
stays Cursor-hosted.

The sandbox launch contract is deliberately small: task, agent definition and
instructions, runtime credentials for that kind, an optional scoped MCP session,
and `/work` as its current directory. It does not receive Run IDs, repository or
provider details, upstream provider credentials, or a Preview URL. Runtime API
keys and the MCP session token are technical credentials; tool subprocesses
must not inherit them.

## Roles and capabilities

Roles declare capabilities rather than relying on implicit host state. A
software-engineer role may be allowed shell, Git, and GitHub tools, but a run
prepares required repositories and other inputs before the role starts. Other
roles may use uploaded artifacts, APIs, databases, or only a prompt.

`/work` is a runtime convention, not a repository convention: a run may
prepare a repository, files, or nothing there.

## Run inputs and entrypoints

Agents should not be responsible for acquiring their own required context. A
run declares **inputs** (the data or workspace the role needs) and optional
deterministic **entrypoints** (platform-managed preparation steps).

For example, a software-engineer run can request a repository and revision;
the platform's checkout entrypoint acquires it before the agent starts. The
agent receives the resulting workspace and task, rather than deciding whether
or how to clone a repository. Other roles may receive an uploaded artifact,
database query result, or no input at all.

Entrypoints are invoked by the orchestrator, not exposed as agent tools. They
are parameterized, auditable, and must complete before the role runtime starts.
The optional finite init from Preview configuration is an entrypoint; failure
fails the run. The Preview command is not an entrypoint: it stays up for the
sandbox lifetime and does not gate the agent loop.

Every agent runtime starts in `/work`; entrypoints prepare any filesystem
inputs directly beneath it. `/work` is disposable staging: an agent may hand
work back through a granted capability (for example, a pull request), but
arbitrary files there do not persist after the run. V1 has no generic artifact
or manifest model; add one only when durable storage or multiple named inputs
need it.

Room attachments stay durable with their messages. Only attachments on the
message that triggered a run are copied, after metadata and checksum
verification, into that run's `.sweat/attachments/<id>/` staging area.
Repository workspaces exclude that staging area from Git. The runtime can pass
supported raster images from this area to a vision-capable model with its
scoped `view_image` tool.

V1 also has no structured run-output or handoff model. The runtime report and
the durable effects of granted capabilities are its handoff. Add structured
outputs only when another run must reliably consume a prior run's result.

## Software-engineer repository runs

A **Git workspace** is a prepared repository input: a Git working directory
seeded at the resolved base revision. Today only software-engineer runs
receive one. The sandbox may inspect, edit, test, create local branches, and
commit, but receives no Git provider credential. A GitHub capability adapter
accepts only a clean `HEAD` descended from that base, publishes it under the
platform-assigned remote run branch, and opens its pull request in the scoped
repository.

## Sub-agents

SDK handoffs can delegate work within an agent runtime. True isolated
sub-agents are platform-managed jobs: assigning (or creating) a child Issue to
an agent definition is that request, and the orchestrator starts a new
Issue-linked run in its own sandbox. An agent must not receive the host
sandbox daemon. Nested Docker inside a sandbox is the project's runtime for
Preview, not Colony sandbox control. In-sandbox SDK subagents are not a
substitute for child Issue-linked runs.

The platform controls budgets, allowed roles, nesting depth, credentials, and
network policy. Tool subprocesses must not inherit model API credentials.

## MCP capabilities

MCP access is a platform service, not bespoke sandbox setup. Every agent
sandbox uses the same generic runtime and connects to one platform-managed
MCP gateway.

Keep these separate:

```text
Connection       -> workspace-owned external provider setup for a Connection kind
Connection link  -> durable link from a Configured Connection to an agent definition
Capability grant -> run-scoped allowed actions and resource scope
MCP session      -> short-lived technical access created from the grant
```

Core capabilities (for example `workspace.room`, `workspace.issues`,
`github.pull-requests`) are requested on the agent role. Connection
capabilities (for example `asana.tasks`, `postgres.sql`) are eligible only when that Connection
is Configured and linked to the agent definition. When a run is created, the
platform resolves role requests, Connection links, and task context into a
narrow, expiring grant.

At sandbox spawn, the orchestrator creates an MCP session from that grant and
provides the generic runtime with the gateway endpoint and a short-lived run
credential. Provider credentials remain in the platform gateway, never in the
agent sandbox. Revoke the MCP session when the run terminals; the sandbox may
still remain for Preview grace.

The initial tools should remain provider-specific (for example, Linear issue
tools). Add a cross-provider task-management abstraction only when multiple
providers create a demonstrated shared need.

A run binds its granted MCP session to the generic runtime. The runtime
connects to the gateway and exposes only the tools in that session; agents
never receive a provider endpoint or credential.

An agent that can execute arbitrary shell code effectively has its run's
granted capabilities. Mitigate this with narrow grants, short expirations,
auditing, and network egress policy; do not rely on hiding a tool credential
from shell subprocesses. Consequential writes require no per-call operator
approval once the platform has issued the run's narrow grant.
