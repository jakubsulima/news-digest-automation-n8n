# Manual-First Digest Runs

Daily News Digest will start hosted digest runs from an admin-only manual trigger in the reader app, with scheduling kept as a later fallback. The trigger will create or return the single active run quickly, while a separate stage executor advances persisted pipeline stages; this avoids making the browser request responsible for a full digest build and leaves room to replace the executor with a queue-backed worker later.

**Considered Options**

- Run the entire digest synchronously from the button request.
- Use a queue-backed worker from the first hosted version.
- Start with a separate stage executor route and persisted stage state.

**Consequences**

- The UI must show run status and handle an already-active run.
- The first implementation can stay simpler than a queue-backed worker.
- Pipeline stages must be idempotent so a future queue executor can reuse the same state model.
