# Style Guide Zoo

Style prompts are easy to write and hard to judge. "Write in plain language,"
"follow the Chicago Manual," "use Simplified Technical English" — each sounds
like it means something specific, but you cannot tell what any of them will do
to your writing until you watch one do it. This repository shows you: a
collection of style guides, each written as a system prompt, applied to the same
set of passages, several times each, with every output and its full provenance
committed to the repo.

**[Browse the outputs →](https://mpdatx.github.io/style-guide-zoo/)**

## Why it's useful

Reading a style guide tells you what its authors value. Reading its output tells
you what it costs. Side by side on one passage, the differences are immediate
and often not what the guide's description would lead you to expect:

- **Some guides do almost nothing to good prose.** On the Gettysburg Address,
  Chicago and Strunk & White land within a couple of words per sentence of
  Lincoln. That is a real result, not a broken column: both guides mainly police
  punctuation and needless words, and Lincoln left them nothing to cut. Point
  the same two at the deliberately tangled `terms-of-service` passage and they
  separate sharply — Strunk & White collapses the subordination, Chicago keeps
  the formal register.
- **A guide can be unusable on a genre and fine on another.** Simplified
  Technical English is built for procedures, and it shows: clear on the runbook,
  and it flattens Melville into something unrecognisable.
- **The same prompt does not give you the same text twice.** Several runs of
  every combination are published, so you can see how much of a column is the
  style guide and how much is sampling noise. Sometimes the answer is
  uncomfortable.
- **Absence of a guide is also a style, and not a modest one.** The
  `claude-style` guide specifies no manner at all — it asks for a rewrite and
  deliberately declines to say how, so whatever the model reaches for by default
  is what appears. Averaged over every passage and run, that default runs to
  **34.5 words per sentence**: longer and more subordinated than every guide here
  that actually prescribes a manner, and beaten only by Chicago, which is
  largely preserving the source's own structure. Left to itself the model writes
  long. That is the argument for pointing a style guide at it, and it is why
  `claude-style` is the column worth comparing the others against.

There is no generated "control" column. The baseline is the source passage
itself, shown unedited beside every output.

## How to read the site

Two ways in, holding one axis fixed and varying the other.

**Browse by style** takes one guide and puts it against the unedited source,
with a dropdown to change which passage. This is the view for "what does this
guide do?" — run through the sources and watch where the guide helps, where it
does nothing, and where it destroys something.

**Browse by source** takes one passage and gives you a voice selector for each
column. Leave the original on the left and cycle the right, or put two guides
head to head with the source out of the picture entirely. This is the view for
"which of these do I want?"

On both, a run selector switches between the generated runs of the combination
on screen, and every generated column carries two disclosures: **About this
guide** (what it is, how it's licensed, a link to the authoritative standard
where one exists, and the verbatim system prompt) and **Prompt, model, and
usage for this run** (the full argument vector, the model requested and the
model actually served, tokens, cost, duration). Nothing requires reading the
source.

## How the outputs are generated

Each file in `guides/` is a system prompt. Each file in `corpus/` is a passage.
The runner applies every guide to every passage, several times each, through the
local Claude Code CLI, and writes one JSON record per generation into
`results/runs/`. `build/build-site.js` folds those records into
`site/data/`, which the site reads.

Nothing is generated in CI, in the browser, or on demand. Everything published
was generated locally and committed. See [docs/architecture.md](docs/architecture.md)
for the pipeline in detail.

The corpus is public-domain prose plus original CC0 passages across oratory,
fiction, legal boilerplate, news, safety instructions, a technical procedure,
and this repository's own documentation — the last one included because
rewriting your own docs in every voice here is a reasonable way to decide how you
want your docs to read.

## What is and is not reproducible

Every record contains the exact system prompt, the exact user prompt, the full
argument vector, the CLI version, the model requested, the model actually
served, token usage, cost, and duration. Each record also stores `attempts` and
the raw `model_usage` map from the CLI envelope alongside `model_reported`, so
you can verify which model actually did the work rather than trusting a single
reported name. The sha256 of the guide, passage, and template files is recorded
too, so you can tell exactly which version of a prompt produced a given output.

The Claude Code CLI does not expose a temperature or a sampling seed. Identical
inputs therefore do **not** produce identical outputs, and this repository does
not claim otherwise. Several runs per combination are published precisely so
that the run-to-run variation is visible rather than hidden behind a single
sample.

Generation uses `--safe-mode`, which disables the maintainer's CLAUDE.md,
skills, plugins, hooks, and MCP servers, so an output does not depend on one
machine's personal configuration.

Failures are published as failures. A generation that times out, fails to start,
or is refused gets a record and a rendered panel like any other; see
[docs/findings/corporate-buzzword-runbook-refusal.md](docs/findings/corporate-buzzword-runbook-refusal.md)
for one refusal that turned out to be caused by the interaction of a prompt and
a passage rather than by either alone.

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
new one regenerates. Use `--force` to regenerate regardless.

| Option | Effect |
|---|---|
| `--guide <ids>` | comma-separated guide ids to restrict to |
| `--passage <ids>` | comma-separated passage ids to restrict to |
| `--runs <n>` | runs per cell |
| `--concurrency <n>` | parallel generations |
| `--backend fake` | deterministic offline backend, for testing |
| `--dry-run` | print the work list and exit |
| `--force` | regenerate current cells |

The full matrix at the time of writing is 10 × 9 × 5 = 450 CLI invocations.
Expect real subscription usage and roughly half an hour at the default
concurrency.

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

Guides earn their place by showing something. Three were retired for not doing
so — a pirate dialect, a corporate-buzzword generator, and a haiku sequence all
produced an obvious register shift and nothing you could not predict from the
prompt, while costing a full column of regeneration every time the corpus grew.

## Adding a passage

Create `corpus/<id>.md` with `id`, `title`, `genre`, `source`, `license`, and
`order`. The licence must be `public-domain` or `cc0-original`; see
[CORPUS-LICENSES.md](CORPUS-LICENSES.md).

Note that the content hash covers the whole file, frontmatter included, so
editing a passage's title restales every one of its cells.

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
