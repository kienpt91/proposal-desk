# 0003. DDD layers with a mechanically enforced dependency rule

Status: accepted (2026-10-31)

## Context

The rules (claim policy, scoring, verification) are the valuable part and must stay independent of files,
terminals and clocks, otherwise they cannot be tested as plain functions and drift towards whatever the I/O
layer happens to provide.

## Decision

Four layers, each allowed to import only the ones before it: `domain` (pure entities, value objects,
aggregates, domain services, events) <- `application` (use cases and ports) <- `infrastructure` (file
stores, evidence hashing, terminal prompt, CLI) <- `composition` (wiring and the entry point). The domain
and application layers may not use `node:` modules, the clock, randomness or `process`; time arrives through a
`Clock` port. `tests/architecture/dependency-rule.test.ts` scans all imports and forbidden tokens, and is
itself tested against bad examples.

## Alternatives

- **A convention in a README.** Cheap, but conventions erode. Rejected.
- **A linter plugin.** Adds a dependency (see 0010). Rejected; a 150-line test does the job.

## Consequences

Domain and application tests run without files or processes. Adding an adapter means implementing a port
and contract tests (`tests/contracts`), which also run against the in-memory fake, so the fake cannot drift.
The pure SHA-256 in the domain exists only because the domain may not import `node:crypto`; it is tested
against `node:crypto`.
