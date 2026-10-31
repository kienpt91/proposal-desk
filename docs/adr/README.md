# Architecture decision records

Short records of decisions that shape the tool, in the order they were taken. Each states the context,
the decision, the alternatives that were rejected and the consequences. A decision is changed by adding a
new record that supersedes the old one, not by editing history.

| # | Decision |
| --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions |
| [0002](0002-deterministic-local-core.md) | A deterministic, local core: no model, no network |
| [0003](0003-layers-with-enforced-dependency-rule.md) | DDD layers with a mechanically enforced dependency rule |
| [0004](0004-facts-and-checkable-evidence.md) | Facts, and "verified" means mechanically checkable |
| [0005](0005-independent-verifier.md) | An independent verifier is the gate |
| [0006](0006-human-approval-bound-to-digests.md) | Human approval, bound to digests, at a terminal only |
| [0007](0007-hash-chained-log.md) | Hash-chained log and content-addressed objects |
| [0008](0008-learning-proposes-never-applies.md) | Learning from outcomes proposes; a human applies |
| [0009](0009-untrusted-job-text.md) | Job text is untrusted data |
| [0010](0010-zero-runtime-dependencies.md) | Zero runtime dependencies |
| [0011](0011-authenticated-approvals.md) | Approvals and applied configurations carry a keyed MAC |
| [0012](0012-recheck-evidence-at-use-time.md) | Evidence is re-checked every time facts are used |
