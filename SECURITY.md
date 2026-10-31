# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately.

- Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose
  **Report a vulnerability**.
- Or email **kienphan.dev@gmail.com** with the subject `proposal-desk security`.

Please include what you ran, what you expected and what happened. Do not open a public issue for a
vulnerability. I aim to acknowledge a report within 7 days and to publish a fix and a note in the
changelog of the release that contains it. There is no bug bounty.

Only the latest release on the default branch is supported.

## What proposal-desk is, for the threat model

A local command-line tool. It reads job text you paste or save, a facts file you write, and optional
evidence files you point at. It writes drafts, a log and a configuration into a state directory on your
machine. It has **no network code at all**, never scrapes, never logs in anywhere and never submits
anything: you review its output and send it yourself.

## Assets

| Asset | Why it matters |
| --- | --- |
| Your facts file and evidence files | Personal data about your work, rate and location |
| Your state directory (log, drafts, job texts, configuration) | A record of whom you applied to and what you offered |
| The integrity of what a draft claims | A proposal that claims something false damages your reputation |
| Your terminal | Untrusted text is printed to it |

## Trust boundaries and threats

Job posts are **untrusted input**: anyone can write one, and it is pasted into the tool.

| Threat | Mitigation | Where it is tested |
| --- | --- | --- |
| A post carries ANSI/OSC escape sequences, C1 controls, bidirectional overrides or zero-width characters to drive the terminal or hide text | Every printed character goes through one output layer that rewrites these as visible `\u{...}` escapes; JSON output uses valid `\uXXXX` escapes; the same characters are stripped from the post before analysis and reported as a risk flag | `tests/domain/text-safety.test.ts`, `tests/e2e/hostile.test.ts` |
| A post contains instructions aimed at an AI or a script ("ignore previous instructions", "begin your proposal with ...") | There is no model in the tool: the post is data. Instructions are never followed, are flagged, and the draft depends only on extracted requirements and your facts | `tests/e2e/hostile.test.ts` |
| A post fakes the tool's own structure (a metadata block, a `## Provenance` section) | The metadata block is honoured only as the first thing in the input; drafts are built from facts, never from post text | `tests/domain/job-extraction.test.ts`, `tests/e2e/hostile.test.ts` |
| A post requests credentials, seed phrases, remote access or free work, or moves you off-platform | Deterministic risk flags; credentials and free work are hard warnings that force a `skip` recommendation | `tests/domain/risk.test.ts` |
| A draft, or a proposal written elsewhere, contains an unsupported claim | The independent verifier (`check`) matches every sentence to facts by content and fails on untraceable numbers, capabilities, superlatives, boilerplate and contact details. A draft that would fail is never produced | `tests/domain/verify.test.ts`, property test in `tests/domain/draft.test.ts` |
| A script or another program approves a draft on your behalf | `approve` and `config apply` refuse to run unless standard input and standard error are terminals and the human types an exact token that depends on what is being approved | `tests/infrastructure/cli-units.test.ts`, `tests/e2e/binary.test.ts` |
| A draft is edited, or its facts change, after approval | Approval is bound to the digests of the draft text, the job text and the cited facts; `export` re-checks all three and re-runs the verifier | `tests/application/workflow.test.ts` |
| The log or stored objects are edited | The log is append-only and hash-chained; objects are content-addressed and re-hashed on read; `verify-log` recomputes everything | `tests/domain/log.test.ts`, `tests/e2e/walkthrough.test.ts` |
| Another local user reads or swaps your state | The state directory is created `0700`, files `0600`; the tool refuses a state directory or state file that is a symbolic link, owned by someone else or accessible by group/others; writes are atomic (exclusive temp file, fsync, rename) | `tests/infrastructure/stores.test.ts` |
| Resource exhaustion by a huge or pathological post | Every read is size-bounded (job text 256 KiB and 60,000 characters, facts file 1 MiB, objects 512 KiB, log 128 MiB, 100,000 entries); extraction patterns are bounded and tested against adversarial strings | `tests/e2e/hostile.test.ts` |
| Learning from outcomes changes behaviour without you noticing | `insights` only prints statistics and suggestions. Scoring and templates are data in a versioned configuration; a change is a proposal with a diff and a digest that a human applies at a terminal. There is no self-modifying code | `tests/application/workflow.test.ts` |
| A malicious dependency | There are **zero runtime dependencies**; the architecture test fails the build if one appears. Development dependencies are exact-pinned and installed with `npm ci --ignore-scripts` | `tests/architecture/dependency-rule.test.ts` |

### Known limits

- The hash chain detects edits, removals and reordering of earlier entries. It cannot detect that the
  **end** of the log was cut off unless you remember an earlier head hash (`verify-log` prints it).
- Someone who can run code as you can read everything you can. File permissions protect against other
  users, not against your own account being compromised.
- Evidence files are hashed, not interpreted. `file-hash` evidence proves a file did not change, not that its
  content is true. `repo-url` and `self-declared` evidence is labelled and cannot be verified offline.
- Facts files from other people are data you load: a malicious facts file can point evidence at any local path,
  which the tool will hash (revealing only whether a digest matches).
- Extraction is heuristic and English-centric. A hostile post can make a requirement look present or absent;
  it cannot make the tool claim something your facts do not support.

## Privacy statement

All data stays on your machine. proposal-desk makes no network connections: there is no telemetry, no
update check, no remote model, no account. The only files it writes are in the state directory
(`$XDG_STATE_HOME/proposal-desk`, default `~/.local/state/proposal-desk`, or the path you pass with `--state`),
in the facts file you choose, and in the export path you name. The repository ships only synthetic example
facts and a synthetic example job post; never commit your own facts, job posts or state.

What is stored in the state directory: a log (event types, digests, timestamps, fit scores, the notes you
type), the job texts and drafts you analysed (content-addressed objects), and your configuration.
Delete the directory to delete all of it.

## Dependency policy

- Runtime dependencies: none (Node.js built-ins only).
- Development dependencies: exact versions in `package.json`, resolved against a fixed publication date
  (`npm install --before=<date> --ignore-scripts --save-exact`), locked in `package-lock.json` and installed
  with `npm ci --ignore-scripts`. `node` must be 22.12 or newer.
- Dependabot opens weekly update pull requests for npm and GitHub Actions with a 7-day cooldown, and ignores
  major upgrades of `typescript` and `@types/node`, which are reviewed by hand.
- GitHub Actions are pinned by commit SHA, the workflow has read-only `contents` permission and checkout does
  not persist credentials.
- Secrets: `scripts/secret-scan.sh` runs in the pre-commit and pre-push hooks (`lefthook.yml`) and in CI over
  the tree and the whole history. Findings print the file, line and rule, never the value.
