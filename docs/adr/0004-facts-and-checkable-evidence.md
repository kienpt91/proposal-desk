# 0004. Facts, and "verified" means mechanically checkable

Status: accepted (2026-10-31); amended by [0012](0012-recheck-evidence-at-use-time.md): the status is recomputed from the evidence every time facts are used, and numbers need verified evidence.

## Context

"Verified" is meaningless if the user can type it. The tool needs a notion of verification that the tool
itself can repeat, offline.

## Decision

A fact has a status of `verified`, `declared` or `stale`. A fact may be `verified` only when its evidence is a
local file whose SHA-256 the tool recorded and can recompute (`file-hash`, `command-output`, `document`).
`repo-url` and `self-declared` evidence cannot be re-checked offline and yield `declared`. `facts verify`
re-hashes; a changed or missing file makes the fact `stale`, and stale facts are never used. A claim policy
decides usability: stale facts, numbers and outcomes backed only by a self-declaration, and superlatives
without verified evidence are excluded. Facts about the freelancer's own terms (rate, availability, location,
timezone, language) may be self-declared, with their numbers, because they are declarations by nature.

## Alternatives

- **Fetch the repository URL and check it.** Needs the network (see 0002). Rejected.
- **Let the user mark facts verified.** Defeats the purpose. Rejected.

## Consequences

Evidence the tool cannot check is labelled everywhere it is cited (`evidenced`, `self-declared`) and shown in
the review notes. Users must keep a small evidence file per claim they want verified; the examples show how.
Hashing proves a file did not change, not that it is true.
