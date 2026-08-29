# Claude as a Colony agent runtime, on the user's own plan

Status: research / proposed. Nothing implemented. See also
[cursor provider](cursor-provider.md) (the runtime-adapter precedent),
[workspace LLM configuration](../workspace-llm-configuration.md), and
[ADR 0008](../adr/0008-agent-runtime-kind-on-definition.md).

## Recommendation

Two changes, in this order. They are independent and the first is the valuable
one:

1. **Make provider credentials per-account, with workspace fallback.** Today
   every credential is a workspace singleton (`workspace_llm_config`,
   `workspace_cursor_runtime_config`, both `CHECK (id = 1)`) read through a
   zero-argument thunk at definition-resolve time. Give the resolver the
   account that started the run and let a member's own credential win over the
   deployment's. This is what "users add their own agent providers" actually
   requires, and it applies to the runtimes Colony already has.
2. **Add a `claude-code` agent runtime kind** backed by
   [`@anthropic-ai/claude-agent-sdk`](https://code.claude.com/docs/en/agent-sdk/typescript)
   in a dedicated image, beside `cursor` and `openai-agents`. Do *not* fold it
   into Workspace → LLM provider: like Cursor, this is an agent harness, not an
   OpenAI-compatible inference endpoint.

For the credential itself, ship **the user's own Anthropic API key** as the
default path and treat **the user's Claude subscription** as a separate,
explicitly-labelled, off-by-default path. That split is not squeamishness —
it is what Anthropic's terms say, and the two paths need different plumbing.

## What Anthropic's terms actually allow

This is the constraint that decides the design, so it goes first.

[Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
says, verbatim:

> Anthropic does not permit third-party developers to offer Claude.ai login
> into their own applications, or to route requests through Free, Pro, or Max
> plan credentials on behalf of their users. Moreover, developers may not
> collect, store, or intermediate Claude.ai credentials or session tokens —
> sign-in to a Claude account must complete through Anthropic's own flow.

And, in the same section:

> Nor does it prevent an end user from signing in to the unmodified Claude Code
> binary with their own Claude subscription, including where a platform hosts
> Claude Code as described under *Can customers offer Claude Code in their
> products?*

That carve-out has conditions: the binary must be unmodified and none of its
authentication methods removed or restricted, and the platform "may not pay
for, resell, or intermediate Claude usage on their end users' behalf" — each
end user authenticates with their own credential, billed to them. Hosting
Claude Code in a product requires agreeing to the
[Commercial Terms](https://www.anthropic.com/legal/commercial-terms). For a
self-hosted product that condition lands on whoever runs the deployment, not
on Colony's repository.

Subscription use of the SDK is not a grey area on the billing side: Pro, Max,
Team, and Enterprise seats now get a
[monthly Agent SDK credit](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
that explicitly covers "third-party apps that authenticate with your Claude
subscription through the Agent SDK". The credit is per-account and cannot be
pooled across teammates, and Anthropic's own guidance is that production
automation at scale should use API keys.

Reading those together, the line is **who holds the credential**, not which
plan pays:

| Shape | Verdict |
| --- | --- |
| Member pastes their own Console API key into Colony; Colony encrypts it and injects it into their runs | Permitted. This is ordinary BYOK — "configuring an API key in a development environment, secrets manager, or machine image for use by the customer's own authorized users". |
| Member runs `claude setup-token` locally and pastes the resulting `CLAUDE_CODE_OAUTH_TOKEN` into a Colony form | **Not permitted.** That token is a Claude.ai credential, and Colony would be collecting and storing it. This is the obvious smallest diff — it is the same shape as the existing Cursor API key form — and it is the one thing to not build. |
| Colony implements "Sign in with Claude" against claude.ai | **Not permitted.** Offering Claude.ai login in your own application is named directly. |
| Member signs in to the unmodified `claude` binary, inside their own Colony sandbox, through Anthropic's own browser flow; the credential file lives in a per-account volume Colony treats as opaque | The carve-out this is written for, with the operator on Commercial Terms. Defensible on a personal or small-team deployment; the more members whose Claude.ai credentials sit on one server, the more it looks like the thing the first quote forbids. |

So: API key path is unambiguous and should be the default. Subscription path is
the login-inside-the-sandbox flow, gated behind an operator opt-in
(`SWEAT_CLAUDE_SUBSCRIPTION_LOGIN=1`) with the caveat stated in the UI. If
someone wants the pasted-token version anyway, that is their call to make with
the quote above in front of them — but it should not be the shipped default.

## Fit with the current codebase

| Colony boundary | Claude Agent SDK fit | Decision |
| --- | --- | --- |
| `AgentRuntimeConfig` kinds ([`agents/definition.ts`](../../project/agents/definition.ts)) | The SDK is an agent harness with its own built-in tools, not a `{ baseUrl, apiKey, model }` endpoint. | Add `kind: "claude-code"` with its own credential shape. Do not extend `ModelRuntimeConfig`. |
| `AgentProvider.run()` | `query({ prompt, options })` returns an async generator of `SDKMessage` plus `interrupt()`, `setModel()`, `supportedModels()`. | One `providers/claude-agent-runtime.ts` beside [`cursor-sdk-runtime.ts`](../../project/providers/cursor-sdk-runtime.ts), reusing `createStdoutStepRuntime`. |
| Colony steps | `SDKAssistantMessage` / `SDKToolUseMessage` / `SDKToolResultMessage` map onto `message` / `tool_call` / `tool_result`. `SDKThinkingMessage` exists. | Discard thinking, as the Cursor adapter does. `SDKCostMessage` is worth logging per run — it is the only place the credit spend is visible. |
| Prepared `/work` | `options.cwd`. | Pass `/work`; the checkout stays platform-managed. |
| Scoped MCP | `options.mcpServers` takes inline HTTP servers with headers. | Pass the run's gateway session inline, same as [`runtime/cursor-sdk.ts`](../../project/runtime/cursor-sdk.ts). |
| Repo skills / `CLAUDE.md` | `options.settingSources: ['project']`, `options.systemPrompt: { type: 'preset', preset: 'claude_code', append }`. | Load project settings so workspace-staged skills work; append the role instructions rather than replacing the preset. |
| Approvals | `permissionMode: 'bypassPermissions'` needs `allowDangerouslySkipPermissions: true`. | The outer sandbox stays the security boundary, exactly as for Cursor. |
| Cancellation | `Query.interrupt()`. | Sandbox disposal remains the hard stop for the first slice. |
| Image | The SDK ships a per-platform native binary as an optional dependency (`pathToClaudeCodeExecutable` overrides). | A `Dockerfile.claude` mirroring [`Dockerfile.cursor`](../../project/Dockerfile.cursor): `npm ci` in a builder so npm resolves the right per-arch package, bundle the CLI with `bun build`, copy the native binary beside it. The binary must be shipped as published — see the terms above. |
| Model catalog validation | `Query.supportedModels()`. | Same role `Cursor.models.list()` plays in [`cursor-runtime-config.ts`](../../project/gui/src/server/features/workspace/cursor-runtime-config.ts) — validate the saved model against the credential's own catalog rather than hard-coding one. |

## The platform piece that does not exist yet: per-account credentials

Everything today is workspace-singleton, resolved with no notion of an actor:

```ts
// project/agents/roster.ts
cursor?: () => CursorRuntimeConfig
model?: () => OpenAICompatibleModel
// ...
resolve(id, grantContext) { /* ... */ runtime: { kind: "cursor", image, cursor: options.cursor() } }
```

`resolve` already receives an `AgentGrantContext`, which is the seam. Four
changes, in dependency order:

1. **`AgentGrantContext` gains `accountId`.** It already carries `roomId`,
   `chatId`, `issueId`, and `oneshotId` — the account that started the
   run belongs in the same snapshot. `room_run.requested_by_id` proves the
   value is already available at every room start path. Schedules have no live
   actor, so a schedule needs an owning account; issue-dispatch child runs
   inherit the parent's.
2. **Credential accessors take the context.** `cursor?: (context) => …`,
   `model?: (context) => …`, `claudeCode?: (context) => …`. A missing
   credential keeps returning `undefined` from `resolve`, so the existing
   `rosterNotConfiguredMessage` path already handles "this person is not
   configured for you".
3. **One per-account credential table**, shaped like `workspace_connection`
   (which already stores `fields_json` plus optional encrypted key columns) so
   it does not become a fourth one-table-per-provider migration:

   ```sql
   CREATE TABLE `account_provider_credential` (
     `account_id` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
     `kind` text NOT NULL,
     `fields_json` text NOT NULL,
     `api_key_ciphertext` text,
     `api_key_iv` text,
     `api_key_tag` text,
     `created_at` integer NOT NULL,
     `updated_at` integer NOT NULL,
     PRIMARY KEY (`account_id`, `kind`)
   );
   ```

   Reuse `createSecretBox('sweat-account-provider-credential')` from
   [`secret-box.ts`](../../project/gui/src/server/secret-box.ts) — same
   AES-256-GCM, same HKDF-from-`BETTER_AUTH_SECRET` derivation, and the same
   never-return-the-key-to-a-client rule the workspace configs already follow.
4. **Resolution order: account credential → workspace credential → not
   configured.** No new admin surface: the existing Workspace pages keep
   setting the deployment default, and a new per-member settings page writes
   the account row. Members see their own row only; an administrator sees
   presence, never plaintext.

That layer is worth building on its own merits — it lets a member bring their
own Cursor key or OpenAI-compatible endpoint too, which is the general form of
the request.

## Two credential kinds for Claude

**`anthropic-api-key`** — the ordinary path. Stored encrypted per account,
injected as `ANTHROPIC_API_KEY`. Precedence rank 3 in Claude Code's
[authentication order](https://code.claude.com/docs/en/authentication), so it
wins over anything left in the image. Billed to the member's own Console
organization. This is the one to ship first, and the one to point Teams at.

**`claude-code-login`** — the subscription path. No secret in Colony's
database at all:

- A per-account persistent volume mounted into the agent sandbox, with
  `CLAUDE_CONFIG_DIR` pointing at it. On Linux the credential file lives at
  `$CLAUDE_CONFIG_DIR/.credentials.json`, mode `0600`, and the binary refreshes
  it in place — which is why the volume must be writable and must persist
  across runs. `SandboxSpec.volumes` already exists and is already used for
  the `/work` bind mount, so this is a spec addition, not a provider change.
- A one-time login run: Colony starts a short-lived sandbox on the Claude
  image with that volume mounted and runs the unmodified binary's login. In a
  container the browser cannot reach the CLI's local callback server, so
  Claude Code falls back to its documented paste-the-code flow — Colony surfaces
  the URL, the member completes sign-in on claude.ai, and pastes the code back.
- `ExecRequest` has no stdin, and adding stdin plumbing across three sandbox
  providers is the expensive way to get it. The cheap way: the login command
  reads from a fifo (`mkfifo /tmp/login`), and Colony delivers the code with a
  second `exec` into the same sandbox (`sh -c 'printf %s "$CODE" > /tmp/login'`).
  `Sandbox.exec` is already callable more than once per sandbox.
- Colony never parses, logs, or copies the credential file. Its only jobs are
  to provide the volume and to keep it out of every run that is not the owning
  account's.

There is no device-code flow to lean on; Anthropic
[has not shipped one](https://github.com/anthropics/claude-code/issues/22992).
If that changes, it replaces the fifo trick entirely.

## Trust boundary: an honest difference from the Cursor adapter

The Cursor adapter can promise something this one cannot. `cursor-cli.ts`
takes the key out of `process.env` before `Agent.create`, and the contract
suite asserts a shell tool cannot observe it. Claude Code's own Bash tool is a
child of the process holding the credential, and — on the subscription path —
the credential is a file inside the sandbox by design. Neither `env` scrubbing
nor a read-only mount fixes that: refresh needs write access, and the agent
*is* the binary.

So the guarantee Colony can make is narrower, and should be written down as
such: **a member's credential is present only in runs that member started.**
Not "the agent cannot see it". That is the same exposure as running Claude Code
on your own laptop, which is the situation the carve-out describes — but it
means a prompt injection in a repository can reach the credential, and the
required contract test is the negative one: a run started by account A must not
see account B's volume, key, or config directory.

An `apiKeyHelper` script fetching a short-lived credential from the host per
request would narrow the window on the API-key path. It does not remove the
exposure (the agent can call the same host endpoint), so it is not worth
building in the first slice.

## Smallest viable slice

1. Per-account credential table, secret box, HTTP routes, and a member
   settings page. Wire `accountId` through `AgentGrantContext` and change the
   three credential accessors to take it. No new runtime yet — prove it by
   letting a member override the existing Cursor or OpenAI-compatible
   credential, which is independently useful.
2. `Dockerfile.claude` + `runtime/claude-cli.ts` + `providers/claude-agent-runtime.ts`
   + `kind: "claude-code"` on `AgentRuntimeConfig`, `imagesByKind`, and
   `SWEAT_CLAUDE_AGENT_IMAGE`. Credential source: `anthropic-api-key` only.
   One adapter contract test proving final-result mapping, tool start/result
   pairing, discarded thinking, output bounds, and cross-account isolation.
3. The `claude-code-login` volume plus login flow, behind an operator opt-in,
   with the terms caveat in the UI. Skip if the API-key path covers the
   deployments that actually exist.

Steps 1 and 2 are shippable without step 3, and step 1 is shippable alone.

## Rejected first implementations

- **A `CLAUDE_CODE_OAUTH_TOKEN` field in Workspace settings, or in member
  settings.** Smallest diff, mirrors the Cursor form exactly, and collects and
  stores a Claude.ai credential. Named directly in the terms quoted above.
- **Claude through Workspace → LLM provider as an OpenAI-compatible base URL.**
  Same mistake the Cursor research rejected: it mislabels an agent harness as a
  model endpoint, and it throws away the built-in tools, session resume, and
  project settings that are the reason to use the SDK at all.
- **The Anthropic SDK (`@anthropic-ai/sdk`) with the OpenAI Agents runtime.**
  A reasonable way to get Claude *models* into `@antboy`, and unrelated to this
  request — an API key on the existing OpenAI-compatible form does not let
  anyone use their Claude plan.
- **One deployment-wide Claude credential, like the Cursor one.** It is the
  existing pattern and it is the wrong one here: the Agent SDK credit is
  per-account and explicitly non-poolable, and paying for members' Claude usage
  is the "intermediate on their behalf" case.

## Open questions to resolve before implementation

1. Does the bundled Claude Code binary run on the `debian:bookworm-slim` base
   the Cursor image ships, for both `arm64` and `amd64`? The Cursor image
   already solves the per-arch native-package problem with an `npm ci` builder
   stage; confirm the same trick covers this binary rather than assuming it.
2. Does the paste-the-code login flow complete against a fifo rather than a
   TTY? If the CLI requires a real terminal, the fifo trick dies and step 3
   costs stdin support in `docker-sandbox`, `apple-container-sandbox`, and
   `smolvm-sandbox`.
3. How long does a `/login` credential last inside a volume that is only
   written during runs? Claude Code warns three days before expiry and refreshes
   while in use — a member who starts no runs for weeks comes back to an
   expired login, and Colony needs to say so rather than failing a run with a
   model error.
4. Which account owns a schedule's runs, and does that account's credential
   getting revoked pause the schedule or fail it loudly? Same question for
   issue-dispatch child runs that outlive the parent's session.
5. Does `SDKCostMessage` report subscription-credit consumption or only API
   dollars? If the former, it is worth projecting onto the run record so a
   member can see their own credit burn.
