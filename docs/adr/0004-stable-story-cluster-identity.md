# Stable Story Cluster Identity

The Digest Builder will preserve a Story Cluster identity across runs by matching each new group against recent Pipeline Memory before creating a new key. A Story Cluster key is immutable after creation, while evidence from new articles is recorded in `story_cluster_articles` with the match reason, score, and algorithm version.

Within a run, articles may join a group only when they match every current member closely enough. This complete-link guard prevents bridge merges where A resembles B and B resembles C even though A and C describe different events. Confirmation counts represent distinct publishers rather than raw article count.

**Considered Options**

- Recompute a Story Cluster key from the lexicographically smallest title fingerprint on every run.
- Merge every connected pair with union-find and accept transitive bridge merges.
- Preserve an immutable identity and store article-to-cluster evidence explicitly.

**Consequences**

- Reader feedback and update history remain attached when titles or canonical sources change.
- Pipeline Memory can explain why an article joined a Story Cluster and which algorithm version made the decision.
- New matching logic can run in shadow mode and be audited without rewriting historical cluster identifiers.
- Recent historical candidates must be bounded and indexed so Stage Executor work stays within its runtime budget.
