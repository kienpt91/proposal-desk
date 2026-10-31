# Examples

Everything here is synthetic. The freelancer, the evidence files and the job post are fictional; no real person,
client or company is described.

- `facts.json` — ten facts for a fictional freelancer. Four have local evidence in `evidence/` (re-hashed by
  `facts verify`), one points at a repository URL, five describe terms (language, location, timezone, availability,
  rate floor).
- `evidence/` — the files whose SHA-256 digests are recorded in `facts.json`. They are hashed byte for byte
  (`.gitattributes` disables line-ending conversion for them).
- `job-post.txt` — a fictional post with the optional metadata block at the top.

Try it:

```
node dist/composition/main.js analyze examples/job-post.txt --facts examples/facts.json
```

To use your own facts, see [docs/facts.md](../docs/facts.md). Do not commit them.
