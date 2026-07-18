# Version Recommendation Decisions And Visible Exposures

Daily News Digest will record versioned Recommendation Decisions for Digest Builder selection and Reader ranking. Reader recommendation evidence will use Exposures based on actual card visibility instead of treating every Reader Item returned in a feed response as viewed.

A Reader Exposure requires at least half of the card to remain visible for at least 500 milliseconds. Each Story Cluster may produce at most one Exposure within a ranking context. A new context is created for the initial page and each successful non-append change of sort, feed, period, or view; expanding `More` and appending pagination keep the current context.

Recommendation Decisions will preserve the active policy version, candidate and displayed ordering, score inputs, explanations, eligibility reasons, and selection reasons. Technical Digest Builder decisions remain service-role-only Pipeline Memory. Reader interaction events keep nullable observability fields so older deployments and historical rows remain compatible.

**Considered Options**

- Continue treating every returned Reader Item as an impression.
- Record client visibility without database idempotency or policy versions.
- Record visible, idempotent Exposures and versioned Recommendation Decisions.

**Consequences**

- Recommendation and source policies can be evaluated against attributable outcomes.
- Collapsed or background Reader Items no longer dilute engagement metrics.
- Ranking-context lifecycle and rank semantics become part of the Reader ranking interface.
- Exposure writes require database-level deduplication in addition to client deduplication.
- Bulk state changes must be distinguished from direct reading behavior before they can inform Preference Signals.
- Historical events remain readable but pre-observability metrics are not directly comparable with corrected metrics.
