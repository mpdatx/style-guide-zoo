---
title: Product
summary: What it does, for whom, and what it deliberately does not do.
order: 10
---

# Product

## Purpose

Style prompts are easy to write and hard to judge. "Write in plain language",
"follow the Chicago Manual", "use Simplified Technical English" — each sounds
specific, but nobody can tell what any of them will do to a piece of writing
until they watch one do it.

This project answers one question: *what does a given style guide actually do
to a piece of text, and how much does that vary between runs?* Each style guide
is a system prompt. Each corpus passage is a piece of prose. Every guide is
applied to every passage, several times, through the local Claude Code CLI, and
every output is committed with the full provenance of the generation that
produced it.

The audience is anyone about to put a style instruction into a prompt and
wondering which one to pick — and anyone who wants to see how much of a model's
output is the instruction and how much is sampling noise.

The [README](../README.md) is the public front door and carries the findings
worth leading with. This page is the durable statement of scope.

## Capabilities

- **A matrix of generated rewrites.** Every (guide × passage) pair, five runs
  each, committed as JSON records under `results/runs/` and folded into
  `site/data/` for the browser.
- **Two browse axes.** `#/style/<guide>` pins a guide against the unedited
  source with a passage dropdown; `#/source/<passage>` pins a passage and gives
  each of two columns a voice selector plus a swap control, so any two voices
  can be compared directly. `#/` indexes both.
- **Run switching**, so run-to-run variation is visible rather than averaged
  away or hidden behind a single sample.
- **Full provenance on every output**, in the page: the exact system and user
  prompts, the argument vector, the CLI version, the model requested and the
  model actually served, token usage, cost, duration, attempts, and
  `stop_reason`.
- **Readability metrics** under each column — word count, mean sentence length,
  Flesch reading ease — so "these two columns look similar" can be checked
  rather than eyeballed.
- **Published failures.** A generation that times out, fails to start, or is
  refused gets a record and a rendered panel like any other.
- **Incremental regeneration** driven by content hashes: editing one guide
  regenerates only that guide's cells.
- **A baseline that is not generated.** The comparison column is the corpus
  passage itself. The closest thing to a neutral voice is the `claude-style`
  guide, which specifies no manner at all and so shows whatever the model
  reaches for by default.

## Non-goals

Taken from the design spec, and still binding:

- **Ranking or scoring the guides.** The repository presents outputs; readers
  judge them.
- **Collecting evaluation votes.** A static Pages site has no backend, and a
  half-working voting UI is worse than none.
- **Bit-reproducibility.** The CLI exposes no temperature or sampling seed, so
  identical inputs do not produce identical outputs. Several runs per
  combination are published instead of a claim that cannot be honoured.
- **Running generation in CI.** Everything published was generated locally and
  committed. CI tests and deploys; it never calls the model.

Two further non-goals established since:

- **No runtime dependencies, no build step, no framework.** The site is three
  hand-written files served statically. If something seems to need a library,
  write the twenty lines instead.
- **No guide that only performs.** A guide earns its place by showing something
  not predictable from its own prompt. Four were retired for failing that test;
  see [Decisions](decisions.md).
