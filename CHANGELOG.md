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
