# 0002. A deterministic, local core: no model, no network

Status: accepted (2026-10-31)

## Context

The tool exists to make proposals *trustworthy*: every claim must be traceable to a fact about the
freelancer. A language model can write fluent text, but it can also invent a claim, follow an instruction
hidden in a job post, and give different answers to the same input. Sending data to a remote service would
also expose the freelancer's facts, rates and the clients' posts.

## Decision

The core uses no language model and makes no network connection. Extraction, scoring, risk detection,
drafting and verification are deterministic rules over text and data. The same inputs produce byte-identical
outputs. There is no scraping, no login and no submission: the user pastes or saves the post, reviews the
output and sends it manually. A test fails the build if any module imports a network module or calls `fetch`.

## Alternatives

- **Model-written drafts, verified afterwards.** Fluent, but the verifier would have to catch every
  fabrication and the output would not be reproducible. Rejected for the core. Because `check` works on any
  text, a proposal written by a model elsewhere can still be put through the same gate (see 0005).
- **Fetching the post from a URL.** Convenient, but it requires network access, site-specific scraping and
  often a login. Rejected.

## Consequences

Behaviour can be tested exhaustively and explained line by line. Extraction is heuristic and English-centric,
and drafts are plain: they quote facts instead of paraphrasing them. Quality of wording is traded for
certainty about content.
