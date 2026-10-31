# 0008. Learning from outcomes proposes; a human applies

Status: accepted (2026-10-31)

## Context

Outcomes (replied, interview, hired, no response, declined) could tune the fit threshold and the templates.
Automatic tuning from a handful of personal data points would mostly fit noise, and self-modifying behaviour
is the opposite of an auditable tool.

## Decision

`insights` reports reply rates by risk-flag presence, fit-score band, bid against budget and tone, each with
its sample size, and warns loudly when a sample is below the configured minimum (default 20). It may print
suggestions, only when the compared groups are large enough, in the form of a `config propose` command. Scoring
weights, thresholds, risk limits and templates are plain data in a versioned configuration. `config propose`
records a diff and a digest in the log and changes nothing; `config apply <digest>` shows the diff, requires the
same terminal confirmation as approval, and writes the new version. Templates are validated: no numbers, no
contact details, no boilerplate or superlatives, only whitelisted placeholders, so a template cannot smuggle a
claim into a draft. There is no self-modifying code.

## Consequences

Improvement is slow and deliberate. The statistics are correlations in a small personal sample and are
labelled as such.
