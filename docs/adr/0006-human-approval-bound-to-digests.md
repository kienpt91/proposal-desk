# 0006. Human approval, bound to digests, at a terminal only

Status: accepted (2026-10-31); amended by [0011](0011-authenticated-approvals.md): the approval record carries a keyed MAC that `export` verifies, and the limits against a same-user adversary are documented.

## Context

The tool must never send anything, and a person must stay in the loop for what leaves their name. An
approval that survives later edits, or that a script can give, is worth nothing.

## Decision

`approve` shows the draft, its provenance and the review notes, and asks the user to type an exact token
(`approve` plus the first eight hex characters of the binding digest). It refuses to run unless standard input
and standard error are terminals. The approval is bound to the digest of the draft text, the digest of the job
text and the digest of the cited facts as they were at drafting time. `export` finds the latest approval for
the draft, recomputes all three digests from the current state, re-runs the verifier, and writes the file only
if everything still matches. There is no flag or environment variable that skips the prompt.

Hand edits are supported without weakening this: `approve <draft-id> --text edited.md` runs the same verifier on
the edited text, stores it as an object, and binds the approval to *its* digest; `export` then writes exactly
that text. Text that fails the check cannot be approved.

## Alternatives

- **`--yes`.** Convenient for scripts, which is exactly the thing to prevent. Rejected.
- **Bind to the draft id only.** The id is derived from the draft content, but facts and job text could change
  underneath it. Rejected.

## Consequences

End-to-end automation of approval is impossible by design; tests use an injected prompt port and a separate
test proves the real prompt refuses non-terminals. An approval is voided by editing a cited fact, which is
the intended behaviour, even for harmless edits.
