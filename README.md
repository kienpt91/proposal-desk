# proposal-desk

**Decide in a minute whether a job post is worth your time, and draft a proposal in which every claim is backed by a fact you can prove.**

proposal-desk is a small local command-line tool for freelancers. You paste or save a job post; it reads it
with deterministic rules, matches the requirements against a file of verified facts about *you*, flags the
risks, suggests a bid that respects your rate floor, and drafts a short proposal made only of your own
verified claims. A separate verifier re-checks any proposal (this tool's, yours, or one written by anything
else) before you send it. A human approval, bound to the exact text, job and facts, is required before the
final file is written.

It is the first real application of three ideas about reliable automation: **verification** (claims are
re-checked by an independent component), **evidence** (a "verified" fact is one the tool can re-hash on
demand) and **human approval** (nothing leaves without a person confirming exactly what was reviewed).

```
facts.json  ──┐
              ├──> analyze ──> fit score, risk flags, rate guidance, recommendation
job post  ────┤
              └──> draft ───> proposal + provenance ──> check ──> approve ──> export ──> you send it
                                                          ^
                                    any other proposal ───┘
```

## What it does, and what it does not

It does:

- Extract requirements from pasted text with fixed rules (must-have vs nice-to-have, technologies through a
  synonym dictionary, years, location, timezone, language, availability, budget, duration, requested
  attachments, the client's questions) and build a requirement-to-evidence **coverage matrix**.
- Compute a **fit score** with the formula printed, no hidden weights, and a recommendation
  (apply / apply with caveats / skip) with reasons.
- Raise **risk flags**, each documented with its rationale and false-positive notes
  ([docs/risk-flags.md](docs/risk-flags.md)): location restrictions, video intros, free work, moving off the
  platform, low budgets, unrealistic scope, vague posts, stack mismatch, crowded listings, new or unverified
  clients, urgency, and requests for credentials or wallet access (always a hard warning).
- Suggest a **bid** from the listing's range and your floor; never below the floor.
- **Draft** a proposal from templates and your fact claims only, deterministically: the same inputs give
  byte-identical output, every sentence is footnoted with its fact ids, and hard limits apply (word cap,
  no contact details, no unverifiable claims, no unbacked superlatives, at most one question).
- **Check** any proposal independently and exit with status 1 on violations.
- Keep a local, append-only, hash-chained **log** and let you record outcomes, then show simple **statistics**
  with sample sizes. It may *suggest* configuration changes; it never makes them (a change is a versioned
  proposal you apply at a terminal).

It does not:

- scrape any website, log in anywhere, fetch anything, or **submit** anything. There is no network code at
  all. You paste or save the post, review the output and send it yourself.
- use a language model, or guarantee any outcome. Scoring is heuristic and keyword extraction is
  English-centric (see [Limitations](#limitations)).
- verify what it cannot check offline. A fact backed by a repository URL or by your word is labelled as such.

## Install

Requires Node.js 22.12 or newer. There are no runtime dependencies.

```
git clone https://github.com/kienpt91/proposal-desk.git
cd proposal-desk
npm ci --ignore-scripts
npm run build
node dist/composition/main.js --help        # or: npm link, then: proposal-desk --help
```

The examples below use `proposal-desk` for `node dist/composition/main.js`.

## A real walkthrough

Everything below was produced by running the compiled tool inside a container with the synthetic example
files in [`examples/`](examples) (a fictional freelancer and a fictional post). The only edits are marked.
Paths and timestamps are those of that run.

### 1. Facts

```
$ proposal-desk facts list --facts examples/facts.json
Facts in /tmp/demo/examples/facts.json: 10
  ts-services      verified verified      skill        usable  Built and maintained TypeScript services on Node.js for five years
                   evidence: file-hash: evidence/ts-services.md (checked 2026-10-30)
  postgres-tuning  verified verified      project      usable  Designed and tuned PostgreSQL schemas and indexes for a multi-tenant billing service
                   evidence: command-output: evidence/postgres-explain.txt (checked 2026-10-30)
  ... (the remaining 8 facts omitted here)
```

```
$ proposal-desk facts verify --facts examples/facts.json
VERIFIED ts-services      evidence/ts-services.md matches the recorded digest
VERIFIED postgres-tuning  evidence/postgres-explain.txt matches the recorded digest
VERIFIED rest-openapi     evidence/openapi-summary.md matches the recorded digest
VERIFIED docker-ci        evidence/docker-ci.md matches the recorded digest
SKIPPED  react-dashboard  evidence kind repo-url cannot be re-checked offline
SKIPPED  english          evidence kind self-declared cannot be re-checked offline
SKIPPED  location         evidence kind self-declared cannot be re-checked offline
SKIPPED  timezone         evidence kind self-declared cannot be re-checked offline
SKIPPED  availability     evidence kind self-declared cannot be re-checked offline
SKIPPED  rate-floor       evidence kind self-declared cannot be re-checked offline
```

Facts with a file hash are re-hashed; the others cannot be checked offline and say so. Write your own with
`facts add` ([docs/facts.md](docs/facts.md)).

### 2. Analyze a post

```
$ proposal-desk analyze examples/job-post.txt --facts examples/facts.json
Job: Senior TypeScript engineer for an internal logistics dashboard
Facts: /tmp/demo/examples/facts.json   configuration version 1   job digest adab1f0802a0

Recommendation: APPLY WITH CAVEATS   (fit 80.9 / 100)
  - fit 80.9 is at or above the apply threshold 70, but:
  - uncovered must-haves: Redis

Fit score (formula, no hidden weights)
  weights: must-have = 3, nice-to-have = 1; credit: covered = 1, partial = 0.5, uncovered = 0
  coverage = 100 x sum(weight x credit) / sum(weight) = 100 x 23.5 / 28 = 83.9
  penalty = hard 0 x 40 + warn 0 x 10 + info 1 x 3 = 3
  fit = clamp(coverage - penalty, 0, 100) = 80.9

Requirements and evidence
  COVERED   must  TypeScript         facts: ts-services
                  5 years evidenced, 4 asked
  COVERED   must  15 hours per week  facts: availability
                  20 hours per week declared, 15 asked
  COVERED   must  Node.js            facts: ts-services
                  verified or evidenced fact names this technology
  COVERED   must  PostgreSQL         facts: postgres-tuning
                  verified or evidenced fact names this technology
  COVERED   must  REST APIs          facts: rest-openapi
                  verified or evidenced fact names this technology
  COVERED   must  React              facts: react-dashboard
                  verified or evidenced fact names this technology
  UNCOVERED must  Redis              facts: -
                  no usable fact mentions this technology
  COVERED   must  English            facts: english
                  declared language
  COVERED   nice  Docker             facts: docker-ci
                  verified or evidenced fact names this technology
  COVERED   nice  CI/CD              facts: docker-ci
                  verified or evidenced fact names this technology
  UNCOVERED nice  GraphQL            facts: -
                  no usable fact mentions this technology
  PARTIAL   nice  Kubernetes         facts: docker-ci
                  only related technologies are evidenced

Risk flags
  [info] location-excluded: Location restriction or preference excludes your declared location
      Your declared location (Vietnam, location) is outside the stated preference: north-america, europe.
      > Candidates from North America or Europe preferred.

Rate guidance
  Suggested bid: 53 USD per hour
  - Your floor (rate-floor): 40 USD per hour.
  - Client budget in the post: 40-60 USD (hourly).
  - Bid range from the listing: 35-70 USD.
  - Suggested bid = max(floor 40, min(midpoint 52.5, client maximum 60)) = 53.

Extracted from the post
  Budget: 40-60 USD (hourly)
  Duration: 60-90 days
  Location restriction: preferred north-america, europe
  Timezone requirement: none found
  Requested attachments: portfolio, code-samples
  Client asks:
    - (request) Please include a link to your GitHub profile or a portfolio of similar work.
    - (question) Also tell us: how would you approach the first two weeks of this project?
  Listing metadata: proposals=14, clientHires=3, paymentVerified=true, accountAgeDays=420, bidMin=35, bidMax=70, currency=USD
```

Add `--json` for the same data as JSON. Use `-` instead of a file name to read the post from standard input.

### 3. Draft a proposal

```
$ proposal-desk draft examples/job-post.txt --facts examples/facts.json > draft.md

Draft d-709a3891c3f9: 94 of 200 words, tone plain, 5 cited facts.
Nothing was sent. Review it, then:
  proposal-desk check <file> --job <job>              verify an edited version
  proposal-desk approve d-709a3891c3f9                record your approval (needs a terminal)
  proposal-desk export d-709a3891c3f9 --out final.md  write the approved text
$ cat draft.md
Hello, your post asks for TypeScript, Node.js and PostgreSQL.

On TypeScript: Built and maintained TypeScript services on Node.js for five years.[^1]

On PostgreSQL: Designed and tuned PostgreSQL schemas and indexes for a multi-tenant billing service.[^2]

On REST APIs: Designed and documented REST APIs with OpenAPI for internal and public consumers.[^3]

I have no verified experience with Redis, so I will not claim it.

Which part of the TypeScript work would you like handled first?

Available 20 hours per week.[^4] For this work my rate would be 53 USD per hour.[^5]

Thank you for reading.

## Provenance

[^1]: ts-services (verified; file-hash: evidence/ts-services.md) Built and maintained TypeScript services on Node.js for five years
[^2]: postgres-tuning (verified; command-output: evidence/postgres-explain.txt) Designed and tuned PostgreSQL schemas and indexes for a multi-tenant billing service
[^3]: rest-openapi (verified; document: evidence/openapi-summary.md) Designed and documented REST APIs with OpenAPI for internal and public consumers
[^4]: availability (self-declared: own statement) Available 20 hours per week
[^5]: rate-floor (self-declared: own statement) Minimum rate is 40 USD per hour

## Review notes

- Recommendation: apply-with-caveats (fit 80.9).
- The client asks (answer by hand): Please include a link to your GitHub profile or a portfolio of similar work.
- The client asks (answer by hand): Also tell us: how would you approach the first two weeks of this project?
- The client asks for: portfolio. Add it yourself if you choose to.
- The client asks for: code-samples. Add it yourself if you choose to.
```

The proposal is the part above `## Provenance`. Each claim is footnoted with the fact it rests on and how far
that fact can be trusted (`verified`, `evidenced`, `self-declared`). The review notes list what the tool
cannot do for you: the client's questions, the attachments they ask for, and any warnings. The gap note
("I have no verified experience with Redis") is deliberate: uncovered must-haves are never bluffed.
`draft --json` returns the same draft with per-sentence `factIds`.

### 4. Check a proposal

```
$ proposal-desk check draft.md --job examples/job-post.txt --facts examples/facts.json
Check: PASSED (0 errors, 0 warnings)   94/200 words, 9 sentences, 1 question
Trace (sentence -> facts matched by content)
  1   -                Hello, your post asks for TypeScript, Node.js and PostgreSQL.
  2   ts-services      On TypeScript: Built and maintained TypeScript services on Node.js fo…
  3   postgres-tuning  On PostgreSQL: Designed and tuned PostgreSQL schemas and indexes for …
  4   rest-openapi     On REST APIs: Designed and documented REST APIs with OpenAPI for inte…
  5   -                I have no verified experience with Redis, so I will not claim it.
  6   -                Which part of the TypeScript work would you like handled first?
  7   availability     Available 20 hours per week.
  8   -                For this work my rate would be 53 USD per hour.
  9   -                Thank you for reading.
```

`check` works on any text. Here is a hand-written proposal that should not be sent (exit status 1):

```
$ cat bad.md
Dear Hiring Manager, I am the best TypeScript expert with 12 years of Kubernetes experience.
Reach me at jane@example.com. Do you want a call? Or a demo?
$ proposal-desk check bad.md --job examples/job-post.txt --facts examples/facts.json
Check: FAILED (8 errors, 0 warnings)   27/200 words, 4 sentences, 2 questions
  error   too-many-questions
          2 questions; ask at most one.
  error   contact-details
          An email in a proposal invites the client off the platform and leaks personal data.
          > jane@example.com
  error   sentence 1  boilerplate
          Boilerplate phrase "dear hiring manager".
          > Dear Hiring Manager, I am the best TypeScript expert with 12 years of Kubernetes experience.
  error   sentence 1  superlative-without-evidence
          "best" is not backed by a verified fact.
          > Dear Hiring Manager, I am the best TypeScript expert with 12 years of Kubernetes experience.
  error   sentence 1  superlative-without-evidence
          "expert" is not backed by a verified fact.
          > Dear Hiring Manager, I am the best TypeScript expert with 12 years of Kubernetes experience.
  error   sentence 1  untraceable-number
          The number 12 is not in any verified fact.
          > Dear Hiring Manager, I am the best TypeScript expert with 12 years of Kubernetes experience.
  error   sentence 1  unverified-capability
          TypeScript is in your facts, but this sentence is not traceable to the fact that covers it.
          > Dear Hiring Manager, I am the best TypeScript expert with 12 years of Kubernetes experience.
  error   sentence 1  unverified-capability
          Kubernetes is not covered by any verified fact.
          > Dear Hiring Manager, I am the best TypeScript expert with 12 years of Kubernetes experience.
Trace (sentence -> facts matched by content)
  1   -  Dear Hiring Manager, I am the best TypeScript expert with 12 years of…
  2   -  Reach me at jane@example.com.
  3   -  Do you want a call?
  4   -  Or a demo?
$ echo $?
1
```

### 5. Approve and export

Export refuses until a human has approved exactly this draft:

```
$ proposal-desk export d-709a3891c3f9 --out final.md --facts examples/facts.json
proposal-desk: draft d-709a3891c3f9 cannot be exported
  this draft has not been approved
  Run `approve` again after reviewing the draft.
```

`approve` needs a person at a terminal. It shows the draft and what it rests on, then asks for a token that
depends on the digests of the text, the job and the cited facts. (Elided below: the draft text and review
notes, which are printed as above.)

```
$ proposal-desk approve d-709a3891c3f9 --facts examples/facts.json
Approve draft d-709a3891c3f9?

Nothing is sent anywhere. Approval only allows `export` to write the final text to a file.

[... the draft text and review notes, printed as in step 3 ...]

text e3d9d040446b  job adab1f0802a0  facts 1571b3552947

Type "approve 1dfedef5" to confirm, anything else cancels: approve 1dfedef5

Approved d-709a3891c3f9. Binding 1dfedef5eb2f716a8e538c06a094373e43ee5da4cc8e85800a8a66a1d1ed51d4.
Next: proposal-desk export d-709a3891c3f9 --out final.md
$ proposal-desk export d-709a3891c3f9 --out final.md --facts examples/facts.json
Wrote 579 bytes to final.md. Review it once more and send it yourself.
$ cat final.md
Hello, your post asks for TypeScript, Node.js and PostgreSQL.

On TypeScript: Built and maintained TypeScript services on Node.js for five years.

On PostgreSQL: Designed and tuned PostgreSQL schemas and indexes for a multi-tenant billing service.

On REST APIs: Designed and documented REST APIs with OpenAPI for internal and public consumers.

I have no verified experience with Redis, so I will not claim it.

Which part of the TypeScript work would you like handled first?

Available 20 hours per week. For this work my rate would be 53 USD per hour.

Thank you for reading.
```

Without a terminal the same command refuses, so a script cannot approve for you:

```
$ proposal-desk approve d-709a3891c3f9 --facts examples/facts.json < /dev/null
proposal-desk: this step needs a person at an interactive terminal
  Run the command directly in a terminal; it cannot be scripted or piped.
```

Edited the draft by hand? Check it, then approve that exact text with `approve <draft-id> --text edited.md`:
the edited text must pass the same check, the approval is bound to *its* digest, and `export` writes it. If the
text, the job text or a cited fact (or its evidence) changes after approval, `export` refuses again.

### 6. Record the outcome and look at the statistics

```
$ proposal-desk outcome record d-709a3891c3f9 replied --note "asked for a call" --bid 53
Recorded replied for d-709a3891c3f9.
$ proposal-desk insights
Drafts: 1   with an outcome: 1   pending: 0
Overall reply rate: 100% (1 of 1)  [small sample]

reply rate by risk flags
  no warnings                            100%  (1 of 1)  [small sample]
  with warnings                          n/a   (0 of 0)

reply rate by fit score
  high fit                               100%  (1 of 1)  [small sample]
  middle fit                             n/a   (0 of 0)
  low fit                                n/a   (0 of 0)

reply rate by bid against budget
  bid in the lower half of the budget    n/a   (0 of 0)
  bid in the upper half of the budget    100%  (1 of 1)  [small sample]
  bid above the budget maximum           n/a   (0 of 0)
  no comparable bid and budget           n/a   (0 of 0)

reply rate by tone
  plain                                  100%  (1 of 1)  [small sample]
  concise                                n/a   (0 of 0)

Read this first
  - Only 1 outcome (minimum 20): every rate below is noise. Do not change anything because of it.
  - These are correlations in a personal sample, not causes. The tool never changes scoring or templates by itself.

Suggestions (nothing is changed automatically)
  none
```

With one outcome nothing can be concluded and the tool says so. Suggestions appear only when the compared
groups each have at least 20 outcomes, and they are text: to change anything you write a proposal, review its
diff and apply it at a terminal.

```
$ proposal-desk config propose --set scoring.applyThreshold=65 --note "looser threshold"
Proposal 3dd2778e0e4fc20187ac58b1b4e23739d668c0faaab2f801011b988d19db4c21
version 1 -> 2
  scoring.applyThreshold: 70 -> 65
Nothing changed. To adopt it: proposal-desk config apply 3dd2778e0e4f
```

### 7. The log

```
$ proposal-desk history
1     2026-10-31T09:15:13.847Z  fact.verified     ts-services re-checked on 2026-10-31
2     2026-10-31T09:15:13.849Z  fact.verified     postgres-tuning re-checked on 2026-10-31
3     2026-10-31T09:15:13.851Z  fact.verified     rest-openapi re-checked on 2026-10-31
4     2026-10-31T09:15:13.852Z  fact.verified     docker-ci re-checked on 2026-10-31
5     2026-10-31T09:15:13.941Z  job.analyzed      job adab1f0802a0: fit 80.9, apply-with-caveats
6     2026-10-31T09:15:14.076Z  draft.generated   d-709a3891c3f9 (plain) for job adab1f0802a0
7     2026-10-31T09:15:14.187Z  proposal.checked  text e3d9d040446b: passed (draft d-709a3891c3f9)
8     2026-10-31T09:15:14.293Z  proposal.checked  text 99ea54621112: 8 errors
9     2026-10-31T09:15:17.374Z  draft.approved    d-709a3891c3f9 approved, binding 1dfedef5eb2f
10    2026-10-31T09:15:18.637Z  draft.exported    d-709a3891c3f9 exported, 579 bytes
11    2026-10-31T09:15:18.848Z  outcome.recorded  d-709a3891c3f9: replied - asked for a call
$ proposal-desk verify-log
Hash chain: OK, 11 entries, head 47f70afba7cd5c2a292b221e82d8e7b39f7c2ffd55738ed7ff5fa1f6f5350e9f
Stored objects checked: 2, all present and intact
Note: truncating the end of the log is only detectable if you remember an earlier head hash.
```

The state directory holds `log.jsonl` and `objects/` (plus `facts.json` if you use the default facts location,
and `config.json` once you apply a proposal), created `0700` and `0600`.

## Commands

| Command | What it does |
| --- | --- |
| `facts add \| list \| verify \| stale` | maintain your facts; `verify` re-hashes evidence, `stale` lists facts not re-checked recently (`--mark` makes them stale) |
| `analyze <job\|->` | coverage matrix, risk flags, rate guidance, fit score, recommendation (`--json`) |
| `draft <job\|->` | proposal with footnoted provenance (`--tone plain\|concise`, `--json`) |
| `check <proposal> --job <job>` | independent verification; exit 1 on violations (`--json`) |
| `approve <draft-id> [--text <file>]` | record a human approval at a terminal; `--text` approves your hand-edited version instead |
| `export <draft-id> --out <file>` | write an approved, unchanged draft (`--force` to overwrite) |
| `outcome record <draft-id> <outcome>` | `replied`, `interview`, `hired`, `no-response` or `declined`; `--note`, `--bid` |
| `insights` | reply rates by flags, fit band, bid against budget and tone, with sample sizes |
| `config show \| propose \| apply` | versioned scoring and template configuration; changes need a proposal and a terminal |
| `history`, `verify-log` | read the log; recompute the hash chain and check stored objects |

Every command accepts `--state <dir>`; `facts`-using commands accept `--facts <file>`. Exit status: `0`
success, `1` a check or policy said no, `2` wrong usage, `3` the state directory or a file could not be used
safely. A job post may start with an optional metadata block you copy from the listing
(see [`examples/job-post.txt`](examples/job-post.txt)): proposals so far, client hires, payment verified,
account age, the listing's bid range.

## How it decides

- [docs/scoring.md](docs/scoring.md): coverage, the fit formula, thresholds, rate guidance.
- [docs/risk-flags.md](docs/risk-flags.md): every flag with rationale and false positives.
- [docs/domain.md](docs/domain.md): glossary, bounded contexts, layers.
- [docs/adr](docs/adr): the decisions behind it.
- [SECURITY.md](SECURITY.md): threat model, privacy statement, dependency policy.

## Privacy

All data stays on your machine. The tool makes no network connections (a test fails the build if any module
imports a network module), has no telemetry and no accounts. Your facts live in the state directory
(`$XDG_STATE_HOME/proposal-desk`, mode `0700`) or at the path you pass with `--facts`; the repository ships
only synthetic examples, and `.gitignore` excludes `.proposal-desk/` and `*.local.json`. Do not commit your
own facts, posts or state. Job posts are treated as untrusted: control sequences are shown as visible
escapes, instructions inside a post are flagged and never followed.

## Limitations

- **English-centric extraction.** Requirements, cues ("must", "nice to have"), places and budgets are
  recognised from English phrasing and a finite dictionary of technologies. Other languages and unusual
  phrasing are missed; a missing requirement is a missing row, not an error.
- **Heuristic scoring.** The fit score and the recommendation are a transparent estimate of how well your
  facts cover a post, not a prediction of being hired. The weights are defaults you can change by proposal.
- **The verifier is heuristic too.** It catches numbers, capabilities, superlatives, boilerplate and contact
  details that no fact supports. It can reject honest hand-written text (for example a technology named in
  passing in a first-person sentence) and can pass a sentence vague enough to avoid all of them.
- **Offline verification only.** A file hash proves a file did not change, not that it is true; repository
  URLs and self-declarations are labelled but not verified.
- **Single currency comparisons.** Budgets in another currency than your rate floor produce no bid suggestion.
- **Tail truncation of the log** is not detectable without a remembered head hash.
- Drafts quote your fact claims after a short lead-in instead of paraphrasing them; they are plain by design.

## Development

```
npm ci --ignore-scripts
npm run typecheck && npm test && npm run build
npm run coverage
```

Layers ([ADR 0003](docs/adr/0003-layers-with-enforced-dependency-rule.md)): `src/domain` (pure) <-
`src/application` (use cases and ports) <- `src/infrastructure` (file stores, terminal prompt, CLI) <-
`src/composition`. `tests/architecture` fails the build on any import that points the wrong way.

### Tests and coverage

`npm test` runs 320 tests in 29 files, offline, organised by layer:

| Directory | Tests | What it covers |
| --- | ---: | --- |
| `tests/domain` | 185 | unit and property-style tests of the pure rules (seeded generators: SHA-256 against `node:crypto`, canonical JSON, log tampering, every draft passing its own check) |
| `tests/application` | 45 | every use case against in-memory fakes of the ports |
| `tests/infrastructure` (with `tests/contracts`) | 48 | the same port contracts run against the fake **and** the real file adapters, plus permissions, symlinks, locks, tampering, the terminal prompt, argument parsing |
| `tests/e2e` | 34 | the CLI end to end with real files, the compiled binary as a separate process, and hostile job posts |
| `tests/architecture` | 8 | the dependency rule, no network, no runtime dependencies (and a test that the checks detect violations) |

`npm run coverage` (V8 provider) fails below the thresholds in `vitest.config.ts`. Last run:

| Layer | Statements | Branches | Functions | Lines | Target |
| --- | ---: | ---: | ---: | ---: | --- |
| `src/domain` | 98.66% | 94.71% | 99.73% | 99.58% | 95% |
| `src/application` | 98.33% | 94.09% | 100% | 100% | 90% |
| `src/infrastructure` | 96.51% | 87.28% | 98.37% | 98.82% |  |
| `src/composition` | 85.71% | 100% | 80% | 83.33% |  |
| **all of `src`** | **98.05%** | **93.26%** | **99.29%** | **99.33%** | 85% |

`src/composition/main.ts` is exercised by the compiled-binary tests, which run in a separate process and so
do not count towards coverage.

Secrets: `lefthook.yml` runs `scripts/secret-scan.sh --staged` before every commit and `--tree` before every
push; CI runs both the tree and the whole-history scan.

## License

MIT. See [LICENSE](LICENSE).
