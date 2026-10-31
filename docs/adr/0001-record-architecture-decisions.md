# 0001. Record architecture decisions

Status: accepted (2026-10-31)

## Context

The tool makes several choices that look odd in isolation (no model, a verifier that ignores provenance,
approval only at a terminal). Without a record, later changes will undo the reasons.

## Decision

Keep one short Markdown record per significant decision in `docs/adr/`, numbered in order, with Context,
Decision, Alternatives and Consequences. Supersede instead of editing.

## Consequences

Decisions are discoverable and reviewable in pull requests. The cost is a page of writing per decision.
