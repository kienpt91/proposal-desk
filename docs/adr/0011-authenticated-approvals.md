# 0011. Approvals and applied configurations carry a keyed MAC

Status: accepted (2026-10-31). Amends 0006 and 0007.

## Context

A security review showed that the hash chain of ADR 0007 is not authentication: it is an unkeyed SHA-256, so anyone who can append to
`log.jsonl` can write a `draft.approved` line with correctly computed digests and `export` would honour it, with no terminal at all.
The same applied to `config.applied`, and `config.json` itself was not tied to any log entry.

## Decision

- A random 32-byte key is created on first need in `<state>/secret.key` (hex, mode `0600`, exclusive create, refused when it is a
  link, owned by someone else or open to others). It is never printed, logged or stored in the log or in objects.
- Entries of type `draft.approved` and `config.applied` carry `mac = HMAC-SHA-256(key, "proposal-desk/v1/<type>\n<hash of the previous entry>\n<canonical payload>")`.
  Binding the previous hash ties the entry to its position: rewriting any earlier entry voids every later approval, even if the
  attacker recomputes the unkeyed chain.
- `export` reads the log, recomputes the whole hash chain, finds the latest approval of the draft, checks its MAC with the key and
  refuses unless all of it holds; then it checks the binding (text, job, facts) and re-runs the verifier.
- `config.json` is honoured only if its digest equals the `configDigest` in the last authenticated `config.applied` entry (the digest
  of the defaults when none exists). Otherwise every command refuses and `config show` explains. Deleting the file returns to the
  defaults.
- `verify-log` also checks every MAC and reports a missing key.
- HMAC is implemented in the domain on top of the pure SHA-256 (tested against RFC 4231 and `node:crypto`); the key lives behind a
  `SecretStore` port, so the domain still imports nothing from Node.

## Alternatives

- **A passphrase typed at approval, or an OS keychain.** Stronger against a same-user process that can read files, but it adds a
  secret for the user to manage and a native or platform dependency. Rejected for now; the limit is documented.
- **Read the confirmation from `/dev/tty`.** A process that can allocate a pseudo-terminal also has a controlling terminal, so it adds
  nothing against the adversary that matters here. Rejected.
- **Not showing the token.** The human has to type something that depends on what is approved; any such token can be read by a
  process that owns the terminal. Rejected.

## Consequences

A different user, a copied or edited log, a log moved to another state directory and a rewritten history can no longer produce an
approval. A process running as the same user can still read `secret.key` and forge one, or drive a pseudo-terminal; SECURITY.md says
so in the "Known limits". Losing `secret.key` voids all earlier approvals and applied configurations (approve again).
