# 0010. Zero runtime dependencies

Status: accepted (2026-10-31)

## Context

The tool handles private data and is meant to be trusted by running it on a laptop. Every runtime dependency
is code that sees that data and a supply-chain risk.

## Decision

The program uses Node.js built-ins only (`node:*`). A test fails if `package.json` declares runtime,
optional or peer dependencies. Development dependencies (TypeScript, Vitest with the V8 coverage provider and
`@types/node`) are exact-pinned, resolved against a fixed publication date, locked, and installed with
`npm ci --ignore-scripts`; the lockfile is verified in clean amd64 and arm64 containers. Argument parsing,
SHA-256 for the domain, canonical JSON, the output escaper and the hash-chained log are implemented in the
repository.

## Alternatives

- **A CLI framework and a schema library.** Less code, but more code that reads your facts. Rejected.

## Consequences

More code to maintain (about 300 lines of parsing and escaping) and test. Installing the tool needs no
network after download, and there is nothing to audit but this repository.
