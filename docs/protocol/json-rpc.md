# Senny Core JSON-RPC Protocol

Transport: newline-delimited JSON-RPC 2.0 over stdio.

## Methods

### `initialize`

Params:

```json
{
  "protocolVersion": "2026-05-08",
  "clientName": "senny-sdk",
  "clientVersion": "0.1.0"
}
```

### `session/create`

Creates or resumes a native-core session.

```json
{
  "cwd": "/project",
  "model": "optional-model",
  "resume": "optional-session-id"
}
```

### `session/run`

Starts a run for a session. Streamed events arrive as `session/event` notifications.

```json
{
  "sessionId": "session-...",
  "prompt": "Implement the feature"
}
```

### `session/cancel`

Cancels the active run for a session.

### `session/list`

Lists in-memory native-core sessions.

### `session/delete`

Deletes a saved session by exact ID or prefix.

### `worktree/list`

Lists Git worktrees using the native Late worktree implementation.

### `worktree/active`

Returns the active worktree path.

### `worktree/create`

Creates a Git worktree.

### `worktree/remove`

Removes a Git worktree.

### `shutdown`

Requests graceful shutdown.

## Notifications

### `session/event`

```json
{
  "sessionId": "session-...",
  "type": "turn_start",
  "turn": 1
}
```
