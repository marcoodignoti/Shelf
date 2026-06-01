# AI Chat — Design

Date: 2026-06-01
Status: Approved (pending implementation plan)
Branch: feat/ai-backup-studio-wave

## Summary

Replace the current plan-only "Ask AI" side panel with a modern, ChatGPT-style
conversational chat: the AI replies in streamed markdown prose, and when an
action would help it attaches a structured plan rendered as an inline action
card (checklist + Apply) inside the conversation. Conversations persist to
SQLite with a history rail (new / rename / delete). The chat lives in a wide
floating modal over a dimmed backdrop.

This builds directly on the existing AI stack: OpenRouter integration, the
`generate`/`apply` plan commands, `selectAiActions`, workspace context, and the
streaming + cancel machinery already in `ai.rs`.

## Goals

- Conversational prose answers in markdown (headings, lists, bold, code blocks
  with copy, GFM).
- Live token streaming into the assistant bubble (reuse existing SSE streaming +
  cancel/abort).
- Inline action cards: a turn can carry both prose and an optional action plan;
  the plan renders as a per-action checklist with Apply (reuse #6 selection +
  trusted-mode auto-apply).
- Persistent conversations: multiple chats, history rail, rename, delete.
- Per-message copy; regenerate the last AI reply.
- Wide floating modal: backdrop, left history rail, right conversation, bottom
  composer (textarea, model picker, send/stop), avatars, timestamps, auto-scroll.

## Non-goals

- Native OpenRouter tool/function calling (unreliable on free Kimi/DeepSeek
  tiers).
- Multi-model-per-message or per-conversation model pinning beyond the existing
  global model setting.
- Editing/branching past messages, message search, export.
- Inline-in-editor streaming insertion (separate future item; the `/Ask AI`
  slash item just opens this modal).

## Behavior model: prose + inline actions

One streamed model call per user turn. A new chat system prompt instructs the
model to:

1. Answer conversationally in markdown.
2. When (and only when) a workspace action helps, append exactly one fenced
   block at the very end:

   ````
   ```opennotion-actions
   { "version": 1, "summary": "...", "requires_confirmation": true, "actions": [ ... ] }
   ```
   ````

   The action JSON is the existing `AiActionPlan` schema (create_page,
   create_subpages, create_database, create_database_rows, append_blocks). Same
   id rules from workspace context apply (never invent ids).

### Streaming display contract

- Tokens stream into the active assistant bubble as they arrive.
- When the UI detects the opening marker ```` ```opennotion-actions ```` in the
  accumulating text, it stops appending visible prose and shows a transient
  "Preparing actions…" affordance. Everything before the marker is the rendered
  prose.
- On completion the backend returns `AiChatReply { content, plan }`:
  - `content` = prose with the action fence stripped.
  - `plan` = the parsed + validated `AiActionPlan`, or `None`.
- The plan is validated with the existing `validate_ai_action_plan`. A malformed
  or unsupported fence is dropped (prose still shown), never applied silently.

### Approaches considered

- **A. Embedded `opennotion-actions` fence (chosen).** One streamed call, prose +
  optional plan extracted at the end. Simple, streamable, no extra round-trip.
- B. Two calls (stream prose, then a separate plan-generation call). Cleaner
  separation but slower and doubles cost.
- C. Native tool/function calling. Most "correct" but inconsistent support on the
  free models this app is limited to; harder to stream.

## Backend

### New streaming consumer

`consume_chat_stream` — sibling of `consume_plan_stream` in `ai.rs`:

- Accumulates prose, emits token deltas through the same `on_delta` channel.
- Reuses `parse_sse_line` and the `tokio::select!`-based cancel/abort already
  built (`AppState.ai_cancel`, `cancel_ai_generation`).
- At end: split accumulated content on the `opennotion-actions` fence →
  `(message, Option<AiActionPlan>)`; validate the plan; return
  `AiChatReply { content, plan }`.

`stream_openrouter_chat` — sibling of `stream_openrouter_plan`: builds the chat
system prompt + messages (system, bounded history, user-with-context), sets
`stream: true`, sends, delegates to `consume_chat_stream`.

### Persistence schema

Idempotent `CREATE TABLE IF NOT EXISTS` at startup (no migration framework, same
as the rest of the schema). Best-effort `ALTER TABLE ADD COLUMN` for later
additions.

```sql
CREATE TABLE IF NOT EXISTS ai_conversations (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,           -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  plan_json       TEXT,                    -- nullable; serialized AiActionPlan
  seq             INTEGER NOT NULL,        -- ordering within a conversation
  created_at      TEXT NOT NULL
);
```

Conversation `updated_at` bumps on each new message; history rail sorts by it
descending. Deleting a conversation deletes its messages.

### Commands (registered in `lib.rs`, logic in `ai.rs`)

- `list_ai_conversations() -> Vec<AiConversationSummary>` — `{ id, title, updated_at }`, newest first.
- `get_ai_conversation(id) -> AiConversationDetail` — `{ conversation, messages[] }`.
- `create_ai_conversation() -> AiConversationSummary` — empty conversation (also created lazily on first message if none active).
- `rename_ai_conversation(id, title)`.
- `delete_ai_conversation(id)`.
- `stream_ai_chat_reply(request, on_event) -> AiChatReply`:
  - `request`: `{ conversation_id, prompt, provider, model, current_page_id }`.
  - Persists the user message (`seq = max+1`), bumps `updated_at`.
  - Sends prior messages of the conversation as bounded history (reuse the
    existing `chat_history` bounding: last 10 turns, 2000 chars each).
  - Reuses `build_ai_workspace_context` for page/db ids + studio PDF context.
  - Streams the reply; on completion persists the assistant message (content +
    `plan_json`), bumps `updated_at`, returns `AiChatReply`.
  - First user message in a fresh conversation sets `title` = trimmed/truncated
    prompt (≈40 chars); user can rename later.

- `regenerate_ai_chat_reply(request, on_event) -> AiChatReply`:
  - Used by the "regenerate" affordance. Does **not** append a new user message.
  - Deletes the trailing `assistant` message of the conversation (if any), then
    re-streams from the existing last `user` message (same persistence/return as
    `stream_ai_chat_reply` for the assistant turn).
  - Implemented as a thin wrapper over the same stream path with a
    `regenerate: true` flag so the two commands share one code path.

Plan application keeps the existing `apply_ai_action_plan` command unchanged
(inline cards call it directly).

### Types

```
AiConversationSummary { id, title, updated_at }
AiChatStoredMessage   { id, role, content, plan: Option<AiActionPlan>, created_at }
AiConversationDetail  { conversation: AiConversationSummary, messages: Vec<AiChatStoredMessage> }
AiChatReply           { content: String, plan: Option<AiActionPlan> }
```

`plan_json` is serialized `AiActionPlan`; deserialized back into `plan` on read.

## Frontend

New `AiChat` component (replaces the old `AiActionModal` panel) rendered from
`App.tsx`. Wide floating modal: dimmed backdrop, centered container.

Regions:

- **History rail (left):** conversation list (title + relative time), "New chat",
  rename (inline), delete. Active conversation highlighted.
- **Conversation (right):** message thread with user/assistant avatars, bubbles,
  timestamps, auto-scroll to bottom on new content. Assistant bubbles render
  markdown; inline action card appears under the prose when a message carries a
  plan.
- **Composer (bottom):** textarea (⌘/Ctrl+Enter to send), model picker (existing
  `aiModels`), send button, stop button while streaming.

### Markdown rendering

Add deps: `react-markdown` + `remark-gfm` + `rehype-highlight` (reuses the
already-present `highlight.js`). Code blocks get a copy button. No
`dangerouslySetInnerHTML` (react-markdown sanitizes structurally).

### Inline action card

Reuse from prior work: `formatAiActionPreview`, `selectAiActions`, per-action
checkboxes (#6), `applyAiActionPlan`, and `canTrustedModeAutoApply` (trusted mode
auto-applies a card's plan on arrival when eligible). Apply result still calls
`fetchPages` and may navigate to the primary page.

### Per-message actions

- **Copy:** copies the message's raw markdown.
- **Regenerate:** calls `regenerate_ai_chat_reply` — drops the trailing assistant
  message (UI + persisted row) and re-streams from the existing last user turn
  (no duplicate user message).

### State

Chat state lives in `useAppStore` (single-store rule), composing thin `ai.ts`
wrappers around the new commands: `conversations`, `activeConversationId`,
`messages`, plus actions (`fetchConversations`, `openConversation`,
`newConversation`, `renameConversation`, `deleteConversation`,
`sendChatMessage`, `regenerateLast`). Streaming deltas update the active
assistant message optimistically; the persisted message replaces it on
completion. Errors roll back and set `notice`/`error` (existing pattern).

### Launchers

Launcher button, ⌘K "Ask AI", and the editor `/Ask AI` slash item all open the
new modal (open + ensure an active conversation, creating one lazily).

## Removed / kept

- **Removed:** the old plan-only `AiActionModal` panel UI and its bespoke chat
  message helpers where superseded.
- **Kept/reused:** `generate_ai_action_plan` (still available), `apply_ai_action_plan`,
  `selectAiActions`, `parse_sse_line`, streaming + cancel, `build_ai_workspace_context`,
  trusted-mode auto-apply, AI settings/model picker/key handling.

## Build phasing (for the implementation plan)

1. **Backend chat stream:** chat system prompt, `AiChatReply`, action-fence
   splitter, `consume_chat_stream`, `stream_openrouter_chat`. Pure-function tests
   for the fence splitter; mock-server test for the chat stream (like the
   existing `consume_plan_stream` tests).
2. **Persistence:** tables at startup, types, CRUD commands, `stream_ai_chat_reply`
   (persist user + assistant). DB tests for CRUD + ordering + cascade delete.
3. **Frontend modal:** history rail, bubbles/avatars/timestamps, markdown +
   code copy, live streaming, inline action cards, copy/regenerate, store slice.
4. **Wire + cleanup:** point all launchers at the new modal, remove the old
   panel, update `tests/e2e/ai.e2e.ts` and unit tests.

## Testing

- Rust: fence splitter (prose-only, prose+valid plan, prose+invalid plan →
  dropped), `consume_chat_stream` via local mock SSE server, conversation/message
  CRUD + ordering + cascade delete.
- Frontend unit: action-fence detection during streaming (stop-at-marker),
  store reducers for optimistic streaming + rollback, regenerate logic.
- e2e: open chat, send a prompt (mocked), see streamed prose + an inline action
  card, apply it; create/rename/delete conversations; history persists across a
  reload.

## Risks / open points

- **Action-fence reliability:** free models may format the fence imperfectly.
  Mitigation: tolerant splitter (accept ` ```opennotion-actions ` with optional
  whitespace/language casing), validate, drop on failure (prose still shown).
- **Raw-JSON flash:** brief visibility of fence text before the stop-at-marker
  triggers. Mitigation: detect the marker prefix incrementally as tokens arrive.
- **Markdown bundle size:** react-markdown + plugins add weight to an
  already-large editor bundle; acceptable, lazy-loaded with the modal.
- **Scope:** large (~1500+ lines). One spec, phased plan with review checkpoints
  per phase.
