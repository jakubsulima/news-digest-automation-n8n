# ADR-0006: Freeze the Source Portfolio per digest run

## Status

Accepted.

## Context

Source selection must be explainable, retry-safe, and unable to make a digest run non-deterministic. Recomputing a portfolio during a retried `source_fetch` could change the input set after source observations or operator settings changed.

## Decision

Source Portfolio selection is an idempotent prelude to `source_fetch`, not a new Pipeline Stage. The prelude loads `digest_run_source_decisions` for the run or creates the complete decision set exactly once. Retries reuse those rows.

Manual and advisory modes continue fetching the legacy enabled set while recording the proposed portfolio. Automatic mode uses the frozen actual selection, bounded exploration, and probes. A portfolio failure falls back to the legacy enabled sources and cannot fail the digest run.

`always_on` and `blocked` are hard source modes. The algorithm never mutates them. Automatic activation is operator-controlled and reversible.

## Consequences

- retries use identical source input;
- proposed and actual selections remain distinguishable;
- shadow evaluation is possible without changing production input;
- Source Portfolio does not expand the Pipeline Stage schema or retry machinery;
- changes require an explicit operator action or portfolio-mode setting.
