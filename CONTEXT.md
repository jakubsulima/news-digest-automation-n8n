# Daily News Digest

Daily News Digest is a private news product for collecting, ranking, and reading news from the user's perspective.

## Language

**Hosted Production**:
The live version of the product that runs without depending on the user's personal computer.
_Avoid_: local production, laptop production

**Local Runtime**:
The developer-only environment used to run and test the product on a personal machine.
_Avoid_: production machine, home server

**Digest Builder**:
The part of the product that turns source articles into ranked digest stories.
_Avoid_: n8n workflow, cron job

**Pipeline Memory**:
The historical record used to recognize repeated, changed, or newly important stories.
_Avoid_: reader database, app cache

**Pipeline Stage**:
A persisted, retryable unit of digest-building work.
_Avoid_: code chunk, helper function

**Reader Item**:
A story prepared for reading in the private reader.
_Avoid_: raw article, source item

**Source Item**:
A raw item received from a configured news source during a digest run.
_Avoid_: reader item, story

**Run Trigger**:
The user or schedule action that starts a digest run.
_Avoid_: reader action, cron job

**Operator**:
The allowed user who can start and observe digest runs.
_Avoid_: admin, reader

**Stage Executor**:
The mechanism that advances a digest run through its pipeline stages.
_Avoid_: run trigger, scheduler

**Digest State**:
The canonical database record of digest runs, stories, articles, and publication state.
_Avoid_: markdown archive, latest file

## Relationships

- **Hosted Production** does not depend on the **Local Runtime**
- A **Digest Builder** uses **Pipeline Memory** to produce **Reader Items**
- A **Digest Builder** is composed of ordered **Pipeline Stages**
- Migrating to **Hosted Production** preserves **Digest Builder** behavior while changing infrastructure
- The first hosted version keeps sources, settings, and prompts as version-controlled project files
- **Digest State** is stored as database rows, not Markdown files
- **Pipeline Memory** is part of **Digest State**
- A **Run Trigger** may be manual or scheduled
- A **Run Trigger** starts a run; a **Stage Executor** advances it
- In the first hosted version, the single allowed reader is also the **Operator**
- Only one digest run may be active at a time
- A **Source Item** is stored as per-run evidence before it becomes part of **Digest State**
- A **Reader Item** may be based on one or more source articles

## Example dialogue

> **Dev:** "Can we retire n8n but keep the digest service on my computer?"
> **Domain expert:** "No. **Hosted Production** should not depend on the **Local Runtime**."

## Flagged ambiguities

- "Move out from n8n" was used to mean removing the whole local production dependency, not only replacing the n8n workflow runner.
- "Reader app" was expanded to include an admin-only **Run Trigger**, not a general pipeline editing interface.
