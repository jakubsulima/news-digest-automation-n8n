# ADR-0008: Keep Reader Notes durable and story-centered

## Status

Accepted.

## Context

Reader Items are retained for 90 days unless saved, while personal research must remain available for longer. A note may quote one Article but usually concerns the complete evolving Story Cluster.

## Decision

A Reader Note belongs to one Operator and primarily references a Story Cluster. It may also reference the Reader Item and Article that supplied its quote. All three references use `ON DELETE SET NULL`, and the note stores immutable title, source, URL, publication-date, topic-tag, and entity-tag snapshots.

Reader Items with Reader Notes are excluded from normal retention cleanup. Reader Notes do not create Preference Signals and do not count as Exposures.

## Consequences

- personal knowledge survives Reader Item retention and upstream record deletion;
- later Story Updates remain connected through stable Story Cluster identity;
- source context stays readable even when an optional reference disappears;
- removing the last note makes an expired Reader Item eligible for a later cleanup run.

