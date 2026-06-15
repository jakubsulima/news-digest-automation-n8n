# Refactor Python Builder Into Stage Functions

The first hosted migration will preserve the existing Python digest-builder behavior but refactor it away from the local HTTP service shape into importable, idempotent pipeline stage functions. Hosted routes can invoke those functions by run and stage, while the old `digest_service.py` pattern remains a local Docker/n8n adapter rather than the production execution model.

**Considered Options**

- Deploy the existing Python HTTP service shape unchanged.
- Rewrite the digest builder into TypeScript immediately.
- Refactor the Python builder into stage functions and wrap those from hosted routes.

**Consequences**

- The migration keeps editorial behavior stable while changing runtime boundaries.
- Stage functions must read and write Supabase state instead of local Markdown files.
- A later TypeScript rewrite can happen stage by stage rather than as a full replacement.
