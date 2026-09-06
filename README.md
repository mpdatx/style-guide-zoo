# Style Guide Zoo

Thirteen prose style guides, one shared corpus, multiple runs of each
combination, and the complete provenance of every generation.

**[Browse the outputs →](https://mpdatx.github.io/style-guide-zoo/)**

## What this is

Each style guide in `guides/` is a system prompt. Each passage in `corpus/` is
a piece of prose. The runner applies every guide to every passage, multiple
times per combination, through the local Claude Code CLI and writes one JSON
record per generation into `results/runs/`. Multiple runs per cell exist so
that run-to-run variation is visible rather than hidden behind a single
sample. The site folds those records into a side-by-side comparison.

Nothing is generated in CI, in the browser, or on demand. Everything you see
was generated locally and committed.

Applied to the Gettysburg Address, the conservative guides — Chicago and
Strunk & White in particular — produce output very close to the original, and
to each other. That is a result, not a defect: Lincoln's prose is already
tight, so guides that mainly police punctuation and needless words have little
to change. The same two guides are expected to diverge more sharply on
deliberately tangled prose such as the `terms-of-service` passage, with
Strunk & White collapsing subordination into plain sentences while Chicago
preserves a more formal register — and that divergence is visible today on
the published site's `terms-of-service` column. Near-identical columns are
information about the guide, and the metrics row under each output makes that
legible.

## What is and is not reproducible

Every record contains the exact system prompt, the exact user prompt, the full
argument vector, the CLI version, the model requested, the model actually
served, token usage, cost, and duration. Each record also stores `attempts`
(how many CLI attempts the generation took) and the raw `model_usage` map from
the CLI envelope alongside `model_reported`, so you can verify which model
actually did the work rather than trusting a single reported name. The sha256
of the guide, passage, and template files is recorded too, so you can tell
exactly which version of a prompt produced a given output.

The Claude Code CLI does not expose a temperature or a sampling seed. Identical
inputs therefore do **not** produce identical outputs, and this repository does
not claim otherwise. Multiple runs per cell are published precisely so that the
run-to-run variation is visible rather than hidden behind a single sample.

Generation uses `--safe-mode`, which disables the maintainer's CLAUDE.md,
skills, plugins, hooks, and MCP servers, so an output does not depend on one
machine's personal configuration.

## The one cell that refuses

519 of the 520 generations produced text. One cell refuses, every time:
`corporate-buzzword` applied to the `runbook` passage. The refusal is recorded
rather than regenerated away, because what causes it is more interesting than a
complete grid.

Neither ingredient is sufficient on its own:

|                              | passage contains `TRV` | passage has no `TRV` |
| ---------------------------- | ---------------------- | -------------------- |
| `corporate-buzzword` prompt  | 0 of 5 succeed         | 35 of 35 succeed     |
| the other twelve guides      | 60 of 60 succeed       | all succeed          |

Sixty successful runs contain `TRV`. Thirty-five successful runs use the
buzzword prompt. Only the intersection fails.

`TRV` was invented for this corpus as a deliberately opaque internal acronym.
It is also the standard abbreviation for Tobacco Rattle Virus, so it reads as a
biological agent designator — the CLI reports `stop_reason: refusal` with
`Details: [bio]`. On its own that is harmless, and twelve guides rewrite the
passage without complaint. The `corporate-buzzword` prompt is the other half:
it instructs the model to bury the underlying facts, hedge every claim, and use
the passive voice so that no sentence names who acts. Applied to a token that
looks like a hazardous agent, that becomes a request to obfuscate information
about one.

Substituting any other acronym makes the cell generate normally; removing
`QDX-7` or `NKF` instead does not. The corpus is deliberately left as it is.

## Reproducing a run

Requires Node 22 and an authenticated Claude Code CLI on your PATH.

```bash
node runner/run.js --dry-run                    # see what would be generated
node runner/run.js --guide caveman --runs 1     # one guide, one run each
node runner/run.js                              # the full matrix
node build/build-site.js                        # rebuild site/data/
```

The runner is incremental: a cell is skipped when a successful record already
exists whose content hashes match the current guide, passage, and template.
Edit a guide and only that guide's cells regenerate. Add a passage and only the
new column regenerates. Use `--force` to regenerate regardless.

| Option | Effect |
|---|---|
| `--guide <ids>` | comma-separated guide ids to restrict to |
| `--passage <ids>` | comma-separated passage ids to restrict to |
| `--runs <n>` | runs per cell |
| `--concurrency <n>` | parallel generations |
| `--backend fake` | deterministic offline backend, for testing |
| `--dry-run` | print the work list and exit |
| `--force` | regenerate current cells |

The full matrix is 13 x 8 x 5 = 520 CLI invocations. Expect roughly half an
hour at the default concurrency, and real subscription usage.

## Adding a style guide

Create `guides/<id>.md` with the frontmatter fields `id`, `name`,
`description`, `order`, and optionally `source_url` and `license_note`. The
body is the system prompt, sent verbatim. Then:

```bash
node runner/run.js --guide <id>
node build/build-site.js
```

Guide prompts must be original prose describing a style guide's principles.
Do not transcribe text from a copyrighted manual.

## Adding a passage

Create `corpus/<id>.md` with `id`, `title`, `genre`, `source`, `license`, and
`order`. The licence must be `public-domain` or `cc0-original`; see
[CORPUS-LICENSES.md](CORPUS-LICENSES.md).

## Configuration

`config/experiment.json` holds the model, runs per cell, concurrency,
`max_budget_usd`, and the CLI isolation flags. `max_budget_usd` is passed as
`--max-budget-usd` to **each individual CLI invocation**, not as a total for
the run — it is not a cap on spend across the whole matrix. Changing the model
does not invalidate existing records — the model is provenance, not a content
hash — so change it and use `--force` if you want a clean re-run.

## Tests

```bash
npm test
```

Tests never spawn the CLI; they use the `fake` backend.

## Licence

Code, guide prompts, and site: MIT. Corpus: public domain or CC0, per
[CORPUS-LICENSES.md](CORPUS-LICENSES.md). Model outputs in `results/` are
Claude generations, published as produced with no claim of authorship.
