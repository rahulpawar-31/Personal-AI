# DevOS Agent

Personal AI command-centre: a chat agent that reads/writes the user's email, calendar, tasks, notes, and GitHub/Trello activity on their behalf.

## Language

**Intent**:
A string naming one action the classifier or LangChain agent can take (e.g. `add_task`, `delete_event`, `get_calendar`). Every action, read or write, is identified by its intent.
_Avoid_: action type, command, tool name (tool name is the LangChain-specific wrapper around an intent, not the intent itself).

**Pending Action**:
A write-capable intent the agent has proposed but not yet run — queued as a `pending_actions` row and requiring explicit human approval (`POST /api/actions/:id/approve`) before `executeAction` actually executes it. Exists to keep a destructive or externally-visible intent from firing autonomously off untrusted input (e.g. email content) in the same turn it was read.
_Avoid_: queued action, draft (a draft is a saved-but-unsent email; a Pending Action is a not-yet-approved write of any kind).
