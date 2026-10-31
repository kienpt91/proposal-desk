# 0007. Hash-chained log and content-addressed objects

Status: accepted (2026-10-31)

## Context

The tool should leave an audit trail of analyses, drafts, checks, approvals and outcomes that the user can
trust, without a database.

## Decision

State lives in a private directory. The log (`log.jsonl`) is append-only; each entry holds a sequence number,
timestamp, type, payload, the previous entry's hash and its own SHA-256 over the canonical JSON of the rest.
Large or sensitive content (job texts, draft records, configuration proposals) is stored as write-once objects
named by their SHA-256 and referred to from log payloads. Appends take a lock file and are bounded
(100,000 entries, 16 KiB per payload); files are created `0600` in a `0700` directory, written atomically,
and refused when they are symbolic links, owned by someone else or accessible by others. `verify-log`
recomputes the chain and checks every referenced object.

## Alternatives

- **SQLite.** Needs a native module or a runtime that bundles one (see 0010). Rejected.
- **A signed log.** Needs key management the tool should not own. Rejected.

## Consequences

Edits, removals and reordering of earlier entries are detectable. Truncating the tail is not, unless the user
remembers a head hash (documented in `verify-log` output and the security policy). Every append reads the whole
log; at the supported size limit this stays well under a second.
