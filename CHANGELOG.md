# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-31

First release.

### Added

- Fact base (`facts add | list | verify | stale`) with strict schema, size caps, evidence kinds, a claim policy and
  re-hashing of local evidence files.
- `analyze`: requirement extraction, technology dictionary, coverage matrix, fit score with printed formula,
  recommendation, rate guidance and 21 documented risk flags.
- `draft`, `check`, `approve` (including `--text` for hand-edited drafts), `export`: deterministic drafting with
  per-sentence provenance, an independent verifier, terminal-only human approval bound to text, job and fact digests.
- Local state: hash-chained append-only log, content-addressed objects, `history`, `verify-log`.
- `outcome record`, `insights`, `config show | propose | apply`: statistics with sample sizes and versioned,
  human-applied configuration.
- Terminal-safe output (control, ANSI/OSC and bidirectional characters escaped), size-bounded input, private state
  files with symlink and ownership checks, atomic writes.

### Security review fixes (before the first release)

- Approvals and applied configurations carry a keyed MAC (HMAC-SHA-256, random `secret.key` per state directory, never printed);
  `export` verifies the hash chain and the MAC, and `config.json` is honoured only if it matches the last authenticated
  `config.applied` entry. `verify-log` checks every MAC.
- Evidence files are re-hashed every time facts are used; the `status` field of the facts file is never trusted on its own. Numbers
  and outcomes need verified evidence.
- Verifier: clause-level judgement (a negation word no longer switches checks off, a repeated fact cannot carry extra claims),
  credentials/titles/degrees/awards, numbers in every notation, invisible and look-alike characters, hidden comments, forged provenance
  and an unchecked tail are reported, the proposal text is extracted by one idempotent function, linear-time scanning with limits.
- Risk flags: a negation exempts a request only when it governs it; look-alike letters are mapped back before matching;
  `--meta <file>` takes listing metadata from outside the post; post text in the Markdown audit view is wrapped in code spans.
- File handling: lock files with process-aware takeover and an ownership check before writing, facts updates under a lock, links and
  FIFOs refused as evidence, prototype-named keys rejected.
