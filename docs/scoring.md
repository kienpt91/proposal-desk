# Scoring and recommendation

The fit score is a transparent heuristic. It is printed with the real numbers on every analysis, and
every constant in it lives in the configuration (`proposal-desk config show`). It estimates how well
your facts cover what the post asks for; it does not predict whether you will be hired.

## Coverage matrix

Each requirement extracted from the post gets one row:

| Status | Meaning |
| --- | --- |
| covered | a usable fact names the technology (or one it implies, such as TypeScript for JavaScript), and any asked-for years are evidenced |
| partial | only a related technology is evidenced (for example Docker for Kubernetes), or the technology is covered but the years are not |
| uncovered | no usable fact |

Only facts the claim policy accepts count: stale facts, numbers and outcomes without verified evidence, and
unverified superlatives are excluded (see [domain](domain.md)). "Verified" is recomputed from the evidence file each time facts are used. Every row cites the fact ids it rests on.

Requirement priority comes from the nearest cue in the sentence ("required", "must", "a plus",
"nice to have"), then from the section heading, and otherwise defaults to must-have. Each row records
the cue it used.

Location and timezone rows are gates: they weigh nothing in the score and are enforced through the
`location-excluded` and `timezone-gap` risk flags.

## Formula

```
coverage = 100 x sum(weight x credit) / sum(weight)
penalty  = hard x 40 + warn x 10 + info x 3
fit      = clamp(coverage - penalty, 0, 100)
```

Default weights: must-have 3, nice-to-have 1. Default credit: covered 1, partial 0.5, uncovered 0.
The configuration validates that penalties are ordered (info <= warn <= hard) and that the caveat
threshold is below the apply threshold.

## Recommendation

| Recommendation | Condition (defaults) |
| --- | --- |
| skip | any hard warning; or fit below 45; or nothing was recognised |
| apply with caveats | fit from 45 up, but below 70, or 70 and above with an uncovered must-have or a warning |
| apply | fit 70 or above, every must-have covered or partial, and no warnings |

Reasons are listed with the recommendation. The tool recommends; it never submits anything.

## Rate guidance

The suggested bid is `max(floor, min(midpoint of the reference range, client maximum))`. The
reference range is the bid range from the metadata block when present, otherwise the budget in the
post. It is never below your declared floor. When the client's maximum is below the floor the report
says so and suggests the floor with a warning. For fixed budgets the floor is multiplied by an hours
estimate (hours per must-have technology, default 5) to decide whether the budget is very low for the
scope. Currencies are never converted: a post in another currency produces no suggestion.
