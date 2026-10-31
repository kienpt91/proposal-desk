# 0005. An independent verifier is the gate

Status: accepted (2026-10-31); hardened after a security review (see below)

## Context

A draft carries provenance (fact ids per sentence), but provenance written by the same code that wrote the
sentence proves little. The tool also needs to make proposals from other sources safe to send.

## Decision

`check` re-derives everything from the text: it extracts sentences, matches them to facts by content, and
reports numbers, capabilities and superlatives no usable fact supports, boilerplate openers, contact details,
unsafe characters, length over the cap, more than one question, offers below the rate floor, availability
and location claims that contradict facts, and mismatches with the job's constraints. It does not read the
provenance. `draftProposal` runs it on its own output and refuses to return a draft that fails; `approve` and
`export` run it again with the current facts. `check` exits with status 1 on errors.

### Hardening

The first version exempted any sentence containing a word such as "not" from the technology and claim checks, accepted any sentence that contained a fact's claim
whatever else it said, found only ASCII digits and ASCII spellings, and silently ignored text after a Provenance heading. It now:

- judges **clauses**: a negator exempts a technology mention only when it is tied to an experience word in the same clause ("no verified experience with
Redis", "have not worked with"); "but", "however", "and I built", ";" end its scope;
- checks what is **left of a sentence** after the words of the facts it repeats, for claims about the author (verbs such as built/led/won/hold, credentials, titles,
degrees, awards);
- runs every matcher on **folded text** (invisible characters removed, compatibility and look-alike forms mapped, all digits ASCII) and finds numbers in any notation;
- extracts the proposal with one **fixed-point** function shared by `check`, `approve` and `export`, accounts for the tail and for HTML comments, and treats
provenance lines that do not repeat a real fact as forged;
- is linear on hostile input and stops at 250 sentences and 100 findings.

It remains a pattern matcher; SECURITY.md lists what it does not check.

## Alternatives

- **Trust the draft's provenance.** Fast, but any bug in drafting is invisible. Rejected.
- **Verify only at drafting time.** Facts may change before the proposal is sent. Rejected: export re-checks.

## Consequences

The verifier is heuristic. It will pass a sentence that is vague enough to avoid numbers and technologies, and
it can reject honest hand-written text (false positives are documented in `docs/risk-flags.md` and the
README). The property test in `tests/domain/draft.test.ts` asserts that every draft over random fact bases
and hostile posts passes the verifier.
