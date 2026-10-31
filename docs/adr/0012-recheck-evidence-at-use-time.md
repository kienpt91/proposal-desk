# 0012. Evidence is re-checked every time facts are used

Status: accepted (2026-10-31). Amends 0004.

## Context

ADR 0004 made `verified` mean "the tool hashed a local file and can do it again". But the status is a field in a JSON file the user (or a
script editing it) can change, and only `facts add` and `facts verify` ever hashed anything. A hand-written `"status": "verified"` with a
made-up digest was believed, an evidence file could change or disappear without any effect, and `export` did not notice.

## Decision

Every command that uses facts (`analyze`, `draft`, `check`, `approve`, `export`, `facts list`) first re-hashes the evidence file of each
checkable fact that is not already stale (once per file) and recomputes the status in memory: it is `verified` exactly when the file
hashes to the recorded digest now. A mismatch or a missing file makes the fact stale for that run, with a notice that names the fact and
the reason. The facts file itself is only rewritten by `facts add`, `facts verify` and `facts stale --mark`. Facts already marked stale
stay stale until `facts verify` re-checks them.

The claim policy is tightened to match: a fact with a number, years or an outcome word is usable only when its trust is `verified`.
A link or a self-declaration is not enough. Superlatives were already limited to verified facts.

The approval binding digests the facts as re-checked now, so changing an evidence file after approval makes `export` refuse.

## Alternatives

- **Only refuse old `checkedAt` dates.** Does not catch a forged date or a file changed yesterday. Rejected.
- **Require a matching `fact.verified` log entry.** The log is not a secret store (see 0011), and it would not notice a changed file.
  Rejected.

## Consequences

Every command pays for hashing the evidence files (size-bounded to 256 MiB each, in practice a few kilobytes). A file that is edited
for any reason, even a typo fix, makes its fact stale until `facts verify`; that is the intended behaviour. Hashing still proves only
that a file did not change, not that it supports the claim.
