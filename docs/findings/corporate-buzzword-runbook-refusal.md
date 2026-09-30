---
title: A refusal caused by a conjunction
summary: Why one guide/passage pair refused in all five runs, when neither ingredient refuses alone.
order: 80
---

# A refusal caused by a conjunction, not an ingredient

*Observed 2026-08-27. The guide that produced it (`corporate-buzzword`) was
retired on 2026-09-28 as low-value, so this finding no longer appears on the
site. The full records are preserved in git history at commit `4016597`, under
`results/runs/corporate-buzzword/runbook/`.*

## What happened

Of the 520 generations in the original 13 × 8 × 5 matrix, 519 produced text.
One cell refused, in all five runs: the `corporate-buzzword` guide applied to
the `runbook` passage. The CLI exited non-zero with a valid JSON envelope
carrying `stop_reason: "refusal"` and this result text:

```
API Error: Sonnet 5 can't help with this. Start a new session to continue.

Learn more: https://www.anthropic.com/legal/aup

Details: `[bio]`

Request ID: req_011CemqUxFz8DjjBXrJepDcd
```

All five runs carried the same `Details: [bio]` classification and differed
only in request id.

## Neither half is sufficient

The interesting part is that neither the passage nor the prompt triggers a
refusal alone:

|                             | passage contains `TRV` | passage has no `TRV` |
| --------------------------- | ---------------------- | -------------------- |
| `corporate-buzzword` prompt | 0 of 5 succeed         | 35 of 35 succeed     |
| the other twelve guides     | 60 of 60 succeed       | all succeed          |

Sixty successful runs contain `TRV`. Thirty-five successful runs use the
buzzword prompt. Only the intersection fails.

## Why

`TRV` was invented for this corpus as a deliberately opaque internal acronym.
It is also the standard abbreviation for Tobacco Rattle Virus, so it reads as a
biological agent designator — hence `[bio]`. On its own that is harmless, and
twelve other guides rewrote the passage without complaint.

The `corporate-buzzword` prompt supplied the other half. It instructed the
model to bury the underlying facts, hedge every claim, and prefer the passive
voice so that no sentence names who acts. Applied to a token that looks like a
hazardous agent designator, a request to obfuscate becomes a request to
obfuscate information about a biological agent.

Isolation calls confirmed the mechanism: substituting any other acronym for
`TRV` makes the cell generate normally, while removing the corpus's other
invented identifiers (`QDX-7`, `NKF`) changes nothing.

## Why it was left in place at the time

Renaming `TRV` would have changed the `runbook` passage's content hash and
restaled all thirteen of its cells — roughly sixty-five CLI invocations — to
hide a result that was more informative than a complete grid. The corpus was
left as it was and the refusal was published as a rendered failure state, which
is also what drove the site's readable-failure handling: the raw CLI message
(which says things like "start a new session" and carries a request id) is
written for a terminal user, not a reader, so it moved into a disclosure and a
plain sentence took its place.

`TRV` still appears in `corpus/runbook.md`, unchanged.
