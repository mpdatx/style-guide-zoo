# style-guide-zoo — Design

**Date:** 2026-08-26
**Status:** Approved for planning

## Purpose

A public GitHub repository that collects prose style guides expressed as
Claude system prompts, applies each of them to a shared reference corpus,
and publishes the resulting outputs on GitHub Pages so a visitor can
compare them side by side.

The repository answers one question: *what does a given style guide
actually do to a piece of text, and how much does that vary between
runs?*

Everything is generated locally by the maintainer. The published site is
static. No generation ever happens in CI or in the browser.

## Success criteria

1. A visitor lands on the site, picks a passage, and sees every style
   guide's rewrite of it side by side without further explanation.
2. For any single output, the visitor can see the exact system prompt,
   user prompt, model, CLI version and token usage that produced it.
3. Five runs of the same cell are visible, so run-to-run variation is
   observable rather than hidden behind a single sample.
4. A maintainer adds a new guide or corpus passage by adding one markdown
   file and running one command; only the affected cells regenerate.
5. The full pipeline is testable without spending money or making network
   calls.

## Non-goals

- Ranking or scoring the guides. The repository presents outputs; readers
  judge them.
- Collecting evaluation votes. A static Pages site has no backend, and a
  half-working voting UI is worse than none.
- Bit-reproducibility. See "Provenance honesty" below.
- Running generation in CI.

## Architecture

Zero runtime dependencies. Node 22 (verified present locally: v22.19.0)
for both the runner and the site build. The local Python is 3.8, and the
site is JavaScript regardless; one language and an empty `node_modules`
keeps the supply chain of a public repository trivial to audit.

```
style-guide-zoo/
  README.md
  LICENSE                     MIT, for the code and the guide prompts
  CORPUS-LICENSES.md          per-passage provenance and licence
  package.json                name, type: module, scripts. No dependencies.
  config/
    experiment.json           model, runs_per_cell, prompt template id, CLI flags
  guides/
    <guide-id>.md             frontmatter + system prompt body
  corpus/
    <passage-id>.md           frontmatter + passage text
  prompts/
    rewrite-v1.md             the user-prompt template, versioned
  runner/
    run.js                    CLI entry: work list, staleness, concurrency pool
    worklist.js               enumerate cells, detect stale/missing
    record.js                 record schema, read/write, hashing
    backends/
      cli.js                  spawn `claude -p`, parse the JSON envelope
      fake.js                 deterministic canned responses, for tests
  build/
    build-site.js             results/ -> site/data/
    metrics.js               word count, mean sentence length, Flesch
  results/
    runs/<guide-id>/<passage-id>/r<N>.json
  site/
    index.html
    app.js
    style.css
    data/                     generated; committed so Pages needs no build step of its own
  test/
    *.test.js                 node:test
  .github/workflows/pages.yml
```

### Content files

A guide is a markdown file whose frontmatter is metadata and whose body is
the system prompt sent to Claude verbatim.

```markdown
---
id: asd-ste100
name: ASD-STE100 Simplified Technical English
description: The aerospace controlled-language standard.
source_url: https://www.asd-ste100.org/
license_note: Prompt is an original paraphrase of the specification's rules.
order: 20
---

You rewrite text according to ASD-STE100 Simplified Technical English...
```

`license_note` matters: several of these standards are copyrighted
documents. The repository ships original prose describing the rules, never
transcriptions of the specifications.

A corpus passage is the same shape:

```markdown
---
id: gettysburg
title: The Gettysburg Address
genre: oratory
source: Public domain (1863)
license: public-domain
order: 10
---

Four score and seven years ago...
```

### v1 content set

Thirteen guides across three families:

*Core (6)* — `control` (no style instruction; the baseline every other
output is read against), `caveman`, `asd-ste100`, `economist`,
`plain-language`, `strunk-white`.

*Engineering documentation (3)* — `google-devdocs`, `microsoft-style`,
`chicago`.

*Wildcards (4)* — `hemingway`, `corporate-buzzword`, `pirate`, `haiku`.

Eight public-domain corpus passages spanning genres: oratory, narrative
fiction, a news lede, legal boilerplate, safety instructions, a technical
procedure, marketing copy, and dense academic prose. These are a starting
point; more technically relevant sources will be added later by dropping
files into `corpus/`, which regenerates only the new cells.

`control` is a guide like any other, with an empty style body and a
prompt template that asks only for a faithful reproduction. It occupies a
column on the site and gives readers a reference point.

## Generation

### The call

One process spawn per output. Arguments are passed as an array through
`child_process.spawn` without a shell, so no quoting or escaping of
passage text is involved; the user prompt is written to stdin.

```
claude -p
  --safe-mode
  --no-session-persistence
  --strict-mcp-config
  --disable-slash-commands
  --tools ""
  --model <pinned model id from config>
  --system-prompt <guide body>
  --output-format json
```

`--safe-mode` disables the maintainer's CLAUDE.md, skills, plugins, hooks,
MCP servers and custom agents, so an output does not depend on one
machine's personal configuration. `--bare` would isolate more aggressively
but forces `ANTHROPIC_API_KEY` authentication, which defeats the decision
to run on the CLI subscription. `--tools ""` removes the tool-use
scaffolding, leaving a plain text transformation. `--output-format json`
returns the model actually served, token usage, cost and duration.

`--max-budget-usd` is set from config as a safety rail on full runs.

### Provenance honesty

The CLI does not expose temperature or a sampling seed. Identical inputs
therefore do not produce identical outputs, and the repository says so
plainly in the README rather than implying a reproducibility it cannot
deliver. Everything that *is* knowable is recorded. The five-runs-per-cell
design exists precisely because the variation is real and worth showing.

### Record schema

One JSON file per call, at
`results/runs/<guide-id>/<passage-id>/r<N>.json`:

```json
{
  "schema_version": 1,
  "run_id": "asd-ste100__gettysburg__r3",
  "run_index": 3,
  "generated_at": "2026-08-26T14:03:11.482Z",
  "guide": { "id": "asd-ste100", "source_hash": "sha256:..." },
  "passage": { "id": "gettysburg", "source_hash": "sha256:..." },
  "prompt_template": { "id": "rewrite-v1", "source_hash": "sha256:..." },
  "request": {
    "backend": "claude-code-cli",
    "cli_version": "2.1.246",
    "model_requested": "claude-sonnet-5",
    "argv": ["-p", "--safe-mode", "..."],
    "system_prompt": "<full text as sent>",
    "user_prompt": "<full text as sent>"
  },
  "response": {
    "ok": true,
    "text": "<the rewrite>",
    "model_reported": "claude-sonnet-5-...",
    "usage": { "input_tokens": 0, "output_tokens": 0 },
    "total_cost_usd": 0.0,
    "duration_ms": 0,
    "session_id": "...",
    "num_turns": 1
  }
}
```

A failed call writes the same record with `response.ok: false`, an
`error` object, and no `text`. Failures are recorded rather than dropped,
so a partially failed matrix is visible instead of silently sparse.

`source_hash` is the sha256 of the whole guide/passage/template file. It
is what makes staleness detection work: edit a guide and every record
naming its old hash becomes stale.

### Runner behaviour

`node runner/run.js [options]`

| Option | Effect |
|---|---|
| `--guide <id,...>` | restrict to these guides |
| `--passage <id,...>` | restrict to these passages |
| `--runs <n>` | override runs per cell for this invocation |
| `--dry-run` | print the work list and call count, spawn nothing |
| `--force` | regenerate cells that already have current records |
| `--concurrency <n>` | parallel spawns, default 4 |
| `--backend fake` | use the canned backend |

Default behaviour is incremental and resumable: a cell is skipped when a
record exists whose three `source_hash` values match the current files and
whose `response.ok` is true. Records are never overwritten without
`--force`. Interrupting the runner loses at most the in-flight calls.

Retries: two attempts on a non-zero exit or unparseable envelope, with a
short backoff. A third failure writes a failure record and the run
continues.

Scale note: 13 guides x 8 passages x 5 runs is 520 spawns, each a cold CLI
start. At concurrency 4 this is roughly half an hour of wall clock and
real subscription usage per full regeneration. The first real generation
should be a slice (`--guide` / `--passage`) to check output quality before
committing to the full matrix.

## Site build

`node build/build-site.js` reads `results/` plus the content files and
writes `site/data/`:

- `index.json` — guides, passages, and for each cell a summary: run count,
  failure count, and the per-run metrics.
- `cells/<guide-id>__<passage-id>.json` — the full records for that cell,
  loaded on demand so the initial page load stays small.

Metrics are computed at build time, not in the browser: word count, mean
sentence length, and Flesch reading ease, for each output and for the
original passage. They turn "did ASD-STE100 actually simplify anything"
into a number rather than a squint. They are descriptive statistics, not
scores, and the site labels them as such.

`site/data/` is committed. GitHub Pages then serves the repository
directly and the workflow does no work beyond deployment; a visitor and a
maintainer see byte-identical data.

## Site behaviour

One page. A passage selector across the top. Below it, the original
passage, then one column per guide in `order`.

Each column shows a single run with a 1-5 run switcher, and a collapsed
provenance disclosure that reveals, for that specific run, the exact
system prompt, the exact user prompt, the full argv, the model requested
and the model reported, token usage, cost and duration. Metrics sit under
the output as a compact row.

A cell whose runs all failed renders as an explicit failure state naming
the error, never as an empty column.

Vanilla HTML, CSS and JavaScript. No framework, no build step, no runtime
fetch to anything outside the repository.

## Error handling

| Situation | Behaviour |
|---|---|
| `claude` not on PATH | runner exits immediately with an install hint |
| non-zero exit / bad JSON | retry twice, then write a failure record |
| budget exhausted | runner stops cleanly, keeps completed records |
| malformed guide/corpus frontmatter | fail fast at work-list time, naming the file |
| duplicate `id` across files | fail fast at work-list time |
| record present but stale | regenerated on the next default run |
| cell with zero records at build | site build warns; site shows a gap |

## Testing

`node --test`, no framework.

- `hash` — stable across line endings, changes when content changes.
- `worklist` — enumeration, filters, staleness by each of the three
  hashes, `--force`, duplicate-id and bad-frontmatter rejection.
- `record` — schema round-trip, failure records.
- `backends/cli` — argv construction is exact and stable, including
  quoting-sensitive text; JSON envelope parsing, including malformed
  envelopes.
- `backends/fake` — the whole runner drives end to end against it,
  producing records without a network call.
- `build-site` — aggregation, on-demand cell files, metric values against
  hand-checked fixtures, missing-cell warning.

The `fake` backend is what makes the pipeline testable at zero cost, and
is the default in every test.

## Licensing

MIT for the code and for the guide prompts, which are original prose. The
corpus is public-domain only in v1, with per-passage provenance recorded
in `CORPUS-LICENSES.md`. Model outputs are stored as generated with no
claim of authorship, and the README notes they are Claude outputs.

## Open items deferred by decision

- More technically relevant corpus sources (the maintainer will add these
  later; the design supports it with no code change).
- A second backend using the Anthropic API, which would gain real
  temperature and seed control. Not built now, but the backend interface
  is a seam that admits one.
- Any cross-model comparison axis.
