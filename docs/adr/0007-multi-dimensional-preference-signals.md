# ADR 0007: Add multi-dimensional Preference Signals alongside legacy feedback

## Status

Accepted for staged rollout.

## Context

The legacy feedback model stores one reason and sentiment per story. It cannot represent independent preferences such as liking a topic while disliking one source, and it ties topic learning to Reader Item retention.

## Decision

Add `reader_preference_signals` with a stable Story Cluster, dimension, target, optional stable source ID, sentiment, origin, weight, and confidence. Supported dimensions are topic, entity, source, repetition, and quality. Story Clusters retain topic and entity tags.

Explicit feedback and eligible behavioral outcomes dual-write to the new table while legacy tables remain available. Reads prefer the new table when it contains evidence and fall back to legacy feedback when the migration is unavailable or no migrated/new evidence exists. Bulk or automatic events have zero preference effect, and missing engagement is never negative evidence.

## Consequences

- A reader may hold several independent signals for the same story.
- Source preferences survive source renames through `reader_source_id`.
- Preference learning survives Reader Item retention through Story Cluster tags.
- Removal of legacy feedback requires a later parity audit and cleanup migration.
