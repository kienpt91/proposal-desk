# 0009. Job text is untrusted data

Status: accepted (2026-10-31)

## Context

Anyone can write a job post, and its text reaches the terminal, the log and the analysis. It may carry escape
sequences, hidden characters, instructions aimed at automation, fake structure and oversized or pathological
input.

## Decision

All printing goes through one output layer that rewrites control characters (C0, DEL, C1 including the 8-bit
CSI and OSC introducers), bidirectional controls, zero-width and invisible characters, and tag characters as
visible `\u{...}` escapes; JSON output uses `\uXXXX`. Before analysis the same characters are stripped
(so they cannot split a keyword) and counted into a risk flag. Instructions in a post are matched by a small
list of patterns, reported as flags and never obeyed: no component interprets the text as commands, and drafts
are assembled only from dictionary labels, fact claims and the configured templates. The optional metadata
block is honoured only as the first thing in the input. Inputs are size-bounded and extraction patterns are
bounded and tested against adversarial strings.

## Consequences

A hostile post can change which requirements are extracted (it is the post, after all) but cannot add a claim,
inject markup into the audit view's structure, or reach the terminal raw. The pattern lists are finite, so a
cleverly worded injection is not flagged, only ignored.
