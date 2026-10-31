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

Job posts are **untrusted input**: anyone can write one, and it is pasted into the tool. So is every proposal handed to `check`. The
facts file, the evidence files and the state directory are trusted only as far as they are re-checked: the tool re-hashes evidence
every time it uses facts, and authenticates approvals with a key.

| Threat | Mitigation | Where it is tested |
| --- | --- | --- |
| A post carries ANSI/OSC escape sequences, C1 controls, bidirectional overrides, zero-width or other invisible characters to drive the terminal or hide text | Every printed character goes through one output layer that rewrites these as visible `\u{...}` escapes (controls, every default-ignorable and format character, private use, separators, blank braille); JSON output uses valid `\uXXXX` escapes; the same characters are stripped from the post before analysis and reported as a risk flag | `tests/domain/text-safety.test.ts`, `tests/regression/evasion.test.ts`, `tests/e2e/hostile.test.ts` |
| A post or proposal hides a banned phrase, a credential request, a contact detail or a number with look-alike letters (Cyrillic, Greek), fullwidth forms, soft hyphens, spelled-out addresses ("john at gmail dot com"), digits of another script, or numbers glued to units (`3x`, `90ms`) | Matching runs on folded text: invisible characters removed, compatibility forms decomposed, marks removed, Cyrillic/Greek look-alikes mapped to Latin, all decimal digits mapped to ASCII. Words mixing scripts are flagged. Numbers are found in every notation, in ranges and as words | `tests/regression/evasion.test.ts` |
| A post contains instructions aimed at an AI or a script ("ignore previous instructions", "begin your proposal with ...") | There is no model in the tool: the post is data. Instructions are never followed, are flagged, and the draft depends only on extracted requirements and your facts | `tests/e2e/hostile.test.ts` |
| A post fakes the tool's own structure (a metadata block, a `## Provenance` section) or tries to vouch for its client | The metadata block is honoured only as the first thing in the input and the report says where it came from. `--meta <file>` takes the listing metadata from a separate file so the post cannot supply it, and a block inside the post is then flagged. Drafts are built from facts, never from post text | `tests/regression/untrusted-text.test.ts`, `tests/e2e/hostile.test.ts` |
| Post text turns into links, images or HTML in the Markdown audit file | Everything taken from the post (the client's questions, screening instructions, metadata problems) is written inside a code span whose fence is longer than any backtick run in the text | `tests/regression/untrusted-text.test.ts` |
| A post requests credentials, seed phrases, remote access or free work, or moves you off-platform, and adds a negation word to talk the warning away | Deterministic risk flags; credentials and free work are hard warnings that force a `skip` recommendation. A negation exempts a request only when it directly governs it ("no free work", "we will never ask you to share your password"), never when it merely appears nearby | `tests/domain/risk.test.ts`, `tests/regression/risk-evasion.test.ts` |
| A proposal written by hand or by another tool contains an unsupported claim | The independent verifier matches every sentence to facts by content and judges it clause by clause. It fails on numbers, capabilities, superlatives, boilerplate and contact details that no fact supports, on claims about the author that follow a repeated fact ("... for five years and I hold a PhD"), on credentials, titles, degrees and awards no fact supports, and on look-alike or hidden characters. A negation word switches nothing off: only a negator tied to an experience word, in the same clause as the technology, makes a mention a gap statement. A draft that would fail is never produced | `tests/domain/verify.test.ts`, `tests/regression/verifier-bypass.test.ts`, property test in `tests/domain/draft.test.ts` |
| Text in the file that the verifier does not read (a tail after `## Review notes`, HTML comments, footnote forgery) is sent along with the proposal | The proposal text is extracted by one function that reaches a fixed point, so the string that is verified, approved and exported is the same string. Anything after a Provenance or Review notes heading must be the tool's own structure (footnotes that name a fact and repeat its claim, bullet notes); other text fails with `unchecked-tail`, forged footnotes fail, HTML comments fail, and review notes are reported as not part of the proposal | `tests/regression/verifier-bypass.test.ts` |
| A facts file is edited to say `"status": "verified"` for evidence that does not exist or has changed | Verification status is recomputed every time facts are used (`analyze`, `draft`, `check`, `approve`, `export`, `facts list`): checkable evidence is re-hashed and a missing or changed file makes the fact stale for that run, with a notice. Numbers and outcomes need such verified evidence; a link or a self-declaration is not enough | `tests/regression/fact-status.test.ts`, `tests/domain/recheck.test.ts` |
| A script or another program approves a draft, or forges an approval, on your behalf | `approve` and `config apply` refuse to run unless standard input and standard error are terminals and the human types an exact token. Approvals and applied configurations are written with a keyed MAC (HMAC-SHA-256 over type, payload and the hash of the previous entry) using a random key in `secret.key` (`0600`, never printed or logged). `export` verifies the whole hash chain and the MAC before it writes anything; rewriting history before an approval voids it. See the limits below | `tests/regression/approval-forgery.test.ts`, `tests/domain/hmac.test.ts`, `tests/e2e/binary.test.ts` |
| A draft is edited, or its facts change, after approval | Approval is bound to the digests of the draft text, the job text and the cited facts (as re-checked now); `export` re-checks all three and re-runs the verifier | `tests/application/workflow.test.ts`, `tests/regression/fact-status.test.ts` |
| The log or stored objects are edited | The log is append-only and hash-chained; objects are content-addressed and re-hashed on read; `verify-log` recomputes everything, including every MAC | `tests/domain/log.test.ts`, `tests/e2e/walkthrough.test.ts` |
| `config.json` is edited by hand to change scoring or templates | The file is honoured only if its digest equals the digest in the last authenticated `config.applied` entry (or the defaults when none exists); otherwise every command refuses and `config show` says why | `tests/application/analysis.test.ts`, `tests/regression/approval-forgery.test.ts` |
| Another local user reads or swaps your state | The state directory is created `0700`, files `0600`; the tool refuses a state directory or state file that is a symbolic link, owned by someone else or accessible by group/others; writes are atomic (exclusive temp file, fsync, rename) | `tests/infrastructure/stores.test.ts` |
| Two runs at once corrupt the log or lose a facts update | The log and the facts file are changed under lock files holding `pid:token`. A lock of a process that is gone is taken over at once, one of a live process is waited for, and a holder checks that it still owns its lock right before it writes | `tests/regression/robustness.test.ts` |
| Evidence that is a FIFO or a link to somewhere else | The evidence checker `lstat`s first, refuses links and non-regular files without reading them, and opens with `O_NOFOLLOW` and `O_NONBLOCK` | `tests/regression/robustness.test.ts` |
| Resource exhaustion by a huge or pathological post or proposal | Every read is size-bounded (job text 256 KiB and 60,000 characters, facts file 1 MiB, objects 512 KiB, log 128 MiB, 100,000 entries); the markup reader is linear; the verifier stops at 250 sentences and 100 findings and reports the text as too long | `tests/e2e/hostile.test.ts`, `tests/regression/verifier-bypass.test.ts` |
| Learning from outcomes changes behaviour without you noticing | `insights` only prints statistics and suggestions. Scoring and templates are data in a versioned configuration; a change is a proposal with a diff and a digest that a human applies at a terminal. There is no self-modifying code | `tests/application/workflow.test.ts` |
| A malicious dependency | There are **zero runtime dependencies**; the architecture test fails the build if one appears. Development dependencies are exact-pinned and installed with `npm ci --ignore-scripts` | `tests/architecture/dependency-rule.test.ts` |

### Known limits

- **A same-user adversary can approve.** The approval gate stops accidental and non-interactive use. A process running as you that
  can allocate a pseudo-terminal (`script`, `expect`, a Python `pty`) satisfies the terminal check and can read the confirmation
  token the prompt prints, so it can approve. A process running as you can also read `secret.key` and forge an approval that
  verifies. The MAC protects against everything that cannot read that file: a different user, a copied or edited log, a
  transplanted state directory, a rewritten history. If you need protection from your own account being compromised, keep the
  state directory on a volume that only a separate approver account can write, or approve on another machine.
- The hash chain detects edits, removals and reordering of earlier entries. It cannot detect that the **end** of the log was cut off
  unless you remember an earlier head hash (`verify-log` prints it).
- Someone who can run code as you can read everything you can. File permissions protect against other users, not against your own
  account being compromised.
- Evidence files are hashed, not interpreted. `file-hash` evidence proves a file did not change, not that its content is true, and
  nothing relates the file to the claim: any file can "verify" any claim. `repo-url` and `self-declared` evidence is labelled and
  cannot be verified offline.
- Facts files from other people are data you load: a malicious facts file can point evidence at any local regular file, which the
  tool will hash (revealing only whether a digest matches).
- **What the verifier does not check.** It is a set of patterns, not an understanding of text. It checks numbers, technologies,
  superlatives, boilerplate, contact details, hidden and look-alike characters, rate and availability and location statements, and
  claims about the author expressed with common verbs or credential words (built, led, won, hold a degree, certified, former...).
  It does not check arbitrary prose: a claim phrased without those words ("my clients love me", a made-up anecdote, an
  employer name without a verb) can pass, though a name that follows "at", "for", "with" or "from" and is in neither the facts nor
  the post is reported as a warning. Read every proposal before you send it.
- Extraction is heuristic and English-centric. A hostile post can make a requirement look present or absent; it cannot make the tool
  claim something your facts do not support.
- `scripts/secret-scan.sh` is a byte-for-byte copy of a scanner shared between repositories. Its known weaknesses with file names
  that contain spaces or colons are tracked and fixed in the shared copy, not edited here.

## Privacy statement

All data stays on your machine. proposal-desk makes no network connections: there is no telemetry, no
update check, no remote model, no account. The only files it writes are in the state directory
(`$XDG_STATE_HOME/proposal-desk`, default `~/.local/state/proposal-desk`, or the path you pass with `--state`),
in the facts file you choose, and in the export path you name. The repository ships only synthetic example
facts and a synthetic example job post; never commit your own facts, job posts or state.

What is stored in the state directory: a log (event types, digests, timestamps, fit scores, the notes you
type), the job texts and drafts you analysed (content-addressed objects), your configuration, and `secret.key`, the random key that authenticates approvals.
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
