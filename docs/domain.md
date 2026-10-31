# Domain model

proposal-desk answers two questions about a pasted job post: *is it worth applying to?* and *what can I
honestly say in a proposal?* The second answer may contain only statements backed by facts about you, and
every such statement is re-checked by an independent verifier before a human approves it.

## Glossary

The ubiquitous language. These words mean the same thing in the code, the CLI, the docs and the log.

| Term | Meaning |
| --- | --- |
| **Fact** | One short statement about you (id, claim, category, evidence, status, tags, attributes). The only source of claims in a draft. |
| **Fact base** | All your facts. An aggregate: ids are unique, there is at most one live rate, availability, location and timezone fact. |
| **Category** | `skill`, `project`, `role`, `metric`, `availability`, `rate` or `constraint`. The last three describe your own terms (floor, hours, location, timezone, language) rather than achievements. |
| **Evidence** | What backs a fact: `repo-url`, `file-hash`, `command-output`, `document` or `self-declared`, with a reference and optional date. |
| **Mechanically checkable** | Evidence the tool can re-check offline: a local file whose SHA-256 is recorded (`file-hash`, `command-output`, `document`). |
| **Status** | `verified` (checkable evidence, re-hashed successfully), `declared` (anything else) or `stale` (evidence changed, disappeared or is overdue). |
| **Trust** | Derived: `verified`, `evidenced` (evidence exists but cannot be verified offline) or `self-declared`. Shown on every cited fact. |
| **Claim policy** | The rule that decides whether a fact may appear in a proposal: no stale facts, no self-declared numbers or outcomes, no superlatives without verified evidence. |
| **Usable fact** | A fact the claim policy accepts. Only usable facts count for coverage and drafting. |
| **Job post** | The pasted text, untrusted. Optionally preceded by a **metadata block** of listing facts you copy yourself. |
| **Requirement** | Something the post asks for: a technology (via the technology dictionary), years of experience, a language, availability, a location or a timezone. Has a priority: **must-have** or **nice-to-have**. |
| **Coverage matrix** | One row per requirement: `covered`, `partial` or `uncovered`, with the fact ids it rests on. |
| **Risk flag** | A deterministic warning with a documented rationale and false-positive notes. Severity: info, warning or hard warning. |
| **Fit score** | `clamp(coverage - penalties, 0, 100)`; the formula is printed with the real numbers. |
| **Recommendation** | `apply`, `apply with caveats` or `skip`, with reasons. |
| **Rate floor** | The minimum rate in your rate fact. A suggested bid is never below it. |
| **Draft** | A proposal assembled from templates and fact claims. Every sentence carries the ids of the facts it rests on. Identified by `d-` plus 12 hex characters of its content digest. |
| **Provenance** | The footnotes and JSON `factIds` that tie each claim to a fact. |
| **Check** | The independent verifier. It ignores provenance and matches sentences to facts by content. |
| **Approval** | A human decision recorded at a terminal, bound to the digests of the draft text, the job text and the cited facts. |
| **Export** | Writing an approved, unchanged draft to a Markdown file. The tool never sends anything. |
| **Outcome** | What happened after you sent a proposal: `replied`, `interview`, `hired`, `no-response` or `declined`. |
| **Insight** | A statistic over outcomes (reply rate by flags, fit band, bid against budget, tone), always with its sample size. |
| **Configuration** | Versioned data: scoring weights, thresholds, risk limits, word cap, templates. Changed only through a **proposal** that a human applies. |
| **State directory** | Private directory with the log, stored objects and active configuration. |
| **Log** | Append-only, hash-chained record of what happened. Entries refer to **objects** (job texts, draft records, proposals) by digest. |

## Bounded contexts

```
                     +----------------------+
                     |     Fact base        |  facts, evidence, claim policy
                     +----------+-----------+
                                | usable facts (conformist)
             +------------------+-------------------+
             v                                      v
   +--------------------+   analysis    +------------------------+
   |   Job analysis     |-------------->| Drafting & verification|
   | requirements,      |  coverage,    | draft, check           |
   | coverage, risks,   |  rate, flags  +-----------+------------+
   | rate, score        |                           | draft + digests
   +---------+----------+                           v
             |                          +------------------------+
             | summaries                |  Approval & audit      |
             v                          | approve, export, log   |
   +--------------------+  outcomes     +-----------+------------+
   | Learning           |<--------------------------+
   | outcomes, insights |
   +---------+----------+
             | suggestions (text only)
             v
   +--------------------+
   | Configuration      |  versioned data; proposals applied by a human
   +--------------------+  (read by Job analysis and Drafting)
```

| Context | Aggregate / key types | Code |
| --- | --- | --- |
| Fact base | `FactBase`, `Fact`, claim policy | `src/domain/facts` |
| Job analysis | `JobPosting`, `JobSpec`, `CoverageRow`, `RiskFlag`, `RateGuidance`, `FitScore` | `src/domain/job`, `src/domain/analysis`, `src/domain/dictionary` |
| Drafting & verification | `Draft`, `CheckReport` | `src/domain/proposal`, `src/domain/policy` |
| Approval & audit | `Approval`, `LogEntry` | `src/domain/log` |
| Learning | `Insights` | `src/domain/learning` |
| Configuration | `Config`, `ConfigProposal` | `src/domain/config` |

Relationships:

- **Fact base** is upstream of everything. Other contexts consume `usable()` assessments and never read raw
  facts directly, so the claim policy cannot be bypassed (conformist relationship).
- **Job analysis** produces a value object (`JobAnalysis`) that **Drafting** consumes; drafting never re-parses
  the post for claims.
- **Verification** is deliberately independent of drafting: it shares only the fact base and the phrase
  lists, not the draft's provenance. `draftProposal` runs it on its own output (a draft that would fail
  `check` is never produced), and `approve` and `export` run it again.
- **Learning** reads stored summaries of drafts and recorded outcomes. It cannot write configuration; it
  can only print a `config propose` command.
- **Configuration** is a shared kernel of plain data read by Job analysis, Drafting and Learning.

## Domain events

`fact.added`, `fact.verified`, `fact.marked-stale`, `job.analyzed`, `draft.generated`, `proposal.checked`,
`draft.approved`, `draft.exported`, `outcome.recorded`, `config.proposed`, `config.applied`. Each becomes one
entry in the hash-chained log (see [ADR 0007](adr/0007-hash-chained-log.md)). Fact events are returned by
the `FactBase` aggregate; workflow events are written by the use cases.

## Layers and the dependency rule

```
src/domain          pure: entities, value objects, aggregates, domain services, events.
                    No IO, no clock, no randomness, no node: imports.
   ^
src/application     use cases and ports (interfaces). Depends on the domain only.
   ^
src/infrastructure  adapters: file stores, evidence hashing, terminal prompt, CLI. Implements the ports.
   ^
src/composition     wires adapters to use cases; the program entry point.
```

`tests/architecture/dependency-rule.test.ts` scans every import in `src/` and fails when an inner layer
imports an outer one, when the domain or application layers use `node:` modules, the clock, randomness or
`process`, when any module reaches for the network, or when a runtime dependency is declared. The test is
itself tested against deliberately bad snippets so it cannot silently stop detecting violations.

Tests mirror the layers: `tests/domain` (unit and property-style), `tests/application` (use cases with
in-memory fakes), `tests/contracts` + `tests/infrastructure` (the same port contract run against the fake and
the real file adapter), `tests/e2e` (the CLI end to end, including the compiled binary and hostile posts).
