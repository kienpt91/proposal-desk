# Supplying your own facts

Your facts live in a JSON file that is yours. By default it is `facts.json` in the state directory
(`$XDG_STATE_HOME/proposal-desk`, default `~/.local/state/proposal-desk`, mode `0700`); any command accepts
`--facts <file>` to use another path. Never put it in a repository you publish.

`examples/facts.json` is a synthetic file you can copy and edit. Evidence paths in a facts file are resolved
relative to the facts file, so a directory with `facts.json` and an `evidence/` folder is portable.

## Adding facts with the CLI

```
proposal-desk facts add --id ts-services \
  --claim "Built and maintained TypeScript services on Node.js for five years" \
  --category skill --attr years=5 --tag typescript --tag node.js \
  --evidence file-hash --ref evidence/ts-services.md --date 2026-05-01
```

For `file-hash`, `command-output` and `document` the file is hashed at that moment and the fact is stored as
`verified`. `repo-url` and `self-declared` facts are stored as `declared`. `facts verify` re-hashes every
checkable file later: a match re-verifies the fact, a changed or missing file makes it `stale`, and stale
facts are never used in a proposal.

## Writing good claims

- A short statement without pronouns, 8 to 200 characters, one line, no links or contact details:
  *Designed and tuned PostgreSQL schemas for a multi-tenant billing service.* A draft embeds the claim
  verbatim after a short lead-in, so it should read well on its own.
- Name technologies the way you would in a post; they are matched through a dictionary of canonical ids and
  synonyms (`src/domain/dictionary/tech.ts`). Tags add technologies the claim does not name.
- Numbers, years and outcomes ("five years", "40% faster", "10k users") need evidence beyond
  `self-declared`, otherwise the fact is accepted but never used in a proposal. `facts list` shows why.
- No superlatives ("best", "expert", "world-class") unless the fact is `verified`.

## Your own terms

Four categories describe your terms instead of achievements. They may be `self-declared`, including their
numbers, and each has at most one live fact:

| Category | Attributes | Used for |
| --- | --- | --- |
| `rate` | `floor` (number), `currency` (`USD`), `unit` (`hour` or `project`) | the bid suggestion, which is never below the floor; the budget-below-floor flag |
| `availability` | `hoursPerWeek`, optional `startWithinDays` | availability requirements; the availability line in a draft |
| `constraint` with `kind=location` | `value` (a country or region name) | location restrictions in posts |
| `constraint` with `kind=timezone` | `value` (`UTC+7`) | timezone overlap checks |
| `constraint` with `kind=language` | `value` (`English`) | language requirements |

## The file format

```json
{
  "schema": 1,
  "facts": [
    {
      "id": "ts-services",
      "claim": "Built and maintained TypeScript services on Node.js for five years",
      "category": "skill",
      "evidence": { "kind": "file-hash", "reference": "evidence/ts-services.md", "digest": "<sha256>", "date": "2026-05-01" },
      "status": "verified",
      "tags": ["typescript", "node.js"],
      "attrs": { "years": 5 },
      "checkedAt": "2026-10-30"
    }
  ]
}
```

The schema is strict: unknown fields are errors, the file is limited to 1 MiB and 500 facts, and a fact with
`status: "verified"` must have checkable evidence and a `checkedAt` date. Prefer `facts add` and
`facts verify` to editing statuses by hand.
