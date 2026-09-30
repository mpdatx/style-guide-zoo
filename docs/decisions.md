---
title: Decisions
summary: Why things are the way they are. Records are never rewritten; superseded ones are marked.
order: 30
---

# Decisions

Each record is `## Dnn. Title` followed by **Context**, **Decision**, **Why** and
**Consequences** paragraphs. When a decision is reversed, add `Status: superseded by Dmm`
directly under its heading and write the new record; do not edit the old text. IDs are
never reused.

These records were written on 2026-09-30 when the project adopted this
convention. They document decisions already made and already visible in
[Architecture](architecture.md), the README and the commit history; the dates
given are the dates the decisions took effect, not the date they were recorded.

## D01. Generate through the Claude Code CLI, not the API SDK

**Context.** The corpus had to be rewritten by a model hundreds of times, and
the maintainer wanted every generation to happen on their own machine under
their own subscription (2026-08-26).

**Decision.** Spawn the local `claude -p` CLI once per generation, passing the
passage on standard input and requesting `--output-format json`.

**Why.** It uses the maintainer's existing authenticated CLI, so the repository
needs no API key and a reader can reproduce a run with software they already
have. Standard input avoids every shell-quoting and command-line-length problem
that passing a passage as an argument would create.

**Consequences.** The CLI exposes no temperature or sampling seed, which forced
D05. Generation is also comparatively slow — one process per cell — so the
matrix is regenerated incrementally (D02) rather than wholesale.

## D02. The model is provenance, not content: it is excluded from the staleness hash

**Context.** A record is considered current when the guide, passage and template
it was generated from have not changed. The model could plausibly count as an
input too (2026-08-26).

**Decision.** Staleness compares the content hashes of the guide, passage and
template, plus the backend name. It deliberately does not compare the model.

**Why.** Treating the model as content would mean that bumping the model in
`config/experiment.json` silently invalidated all 450 records, turning a
one-line config edit into a full regeneration. The model belongs in the
provenance of each record, where a reader can see it, rather than in the
decision about what to regenerate.

**Consequences.** Changing the model does not regenerate anything; a clean
re-run on a new model needs `--force`. The backend *is* part of the check,
because otherwise a `--backend fake` test run would write placeholder records
that a later real run would skip over, poisoning the published dataset.

## D03. The content hash covers the whole file, frontmatter included

**Context.** Hashing a guide or passage to decide staleness raises the question
of what counts as its content (2026-08-26).

**Decision.** Hash the entire file, after normalising CRLF to LF. Frontmatter
is included.

**Why.** A hash that covered only the prompt body would have to decide where the
body begins, and being wrong about that means silently serving outputs that no
longer match their inputs. Hashing everything is blunt but cannot be subtly
wrong.

**Consequences.** Editing a guide's `name` or `order` restales every cell for
that guide, and renaming a passage restales its whole column. This is a real
cost: it is why retiring or renaming things is batched, and why new guides are
given unused `order` values rather than renumbering existing ones.

## D04. The site's schema version is separate from the record schema version

**Context.** Both the on-disk records and the JSON the browser reads are
versioned (2026-08-27).

**Decision.** `SCHEMA_VERSION` in `runner/record.js` and `SITE_SCHEMA_VERSION`
in `build/build-site.js` are independent constants.

**Why.** They change for different reasons — one when the record format
changes, the other when the browser's expectations change — and coupling them
would force a meaningless bump on one side every time the other moved.

**Consequences.** Two constants to keep straight. The build deliberately does
not propagate the record version into the site data.

## D05. Record everything, promise nothing

**Context.** The CLI exposes no temperature or seed, so identical inputs do not
produce identical outputs (2026-08-26).

**Decision.** Store the complete envelope for every generation — both prompts,
the argument vector, the CLI version, the model requested and the model served,
the raw `modelUsage` map, token counts, cost, duration, attempts and
`stop_reason` — and state plainly that runs are not bit-reproducible.

**Why.** The honest claim is the useful one. Publishing several runs per
combination turns the irreproducibility from a caveat into the feature that
shows how much of an output is the style guide and how much is sampling noise.

**Consequences.** Five runs per cell, which is five times the cost. The
`model_reported` field must be derived carefully: the envelope's `modelUsage`
map can name an auxiliary model alongside the real one, so the reported model is
the one with the highest output-token count rather than the first key.

## D06. Publish failures instead of hiding or regenerating them away

**Context.** One cell — the `corporate-buzzword` guide on the `runbook` passage
— refused in all five runs, with `stop_reason: refusal` (2026-09-06).

**Decision.** Record the refusal like any other result and render it as a
readable failure state, with the verbatim CLI message in a disclosure. Do not
change the corpus to make it go away.

**Why.** The cause was more interesting than a complete grid: neither the
passage nor the prompt refuses alone, only their conjunction. Renaming the
token that triggered it would also have restaled every cell for that passage
(D03), spending real generation cost to erase a finding.

**Consequences.** The raw CLI message needed redaction (D07) and a
reader-facing summary, since it is written for a terminal user. When the guide
was later retired (D09) the finding was preserved as
[a findings page](findings/corporate-buzzword-runbook-refusal.md) rather than
lost with it.

## D07. Redact filesystem paths from every stored error message

**Context.** Error text from the CLI is committed and published, and CLI errors
carry absolute paths including usernames (2026-08-27).

**Decision.** Route every error message the CLI backend stores — from the
`spawn` stage and from every message built in `parseEnvelope` — through one
redactor that strips Windows drive paths, POSIX home directories and UNC paths,
and caps the length.

**Why.** An earlier version redacted only the `spawn` fallback while
`parseEnvelope` stored the envelope's result verbatim, which is the channel
refusals actually use. One function on the single path out is the only shape
that cannot drift back into a leak.

**Consequences.** Published messages contain `<path>` placeholders. The
redactor is pattern-based and deliberately conservative: it covers the shapes
that appear in practice rather than trying to be exhaustive.

## D08. The baseline is the corpus passage, not a generated control column

**Context.** The original design had a `control` guide whose prompt asked the
model to reproduce the passage unchanged, so the site could show a baseline
column (2026-09-28).

**Decision.** Delete the `control` guide. The site reads the original passage
from its index and shows it directly.

**Why.** A generated control spends one CLI call per passage to ask the model to
echo its input back, and the result is not even guaranteed to be the input. The
passage is already in the site data.

**Consequences.** One fewer column to generate on every corpus change. The
comparison column is now exact rather than approximately exact.

## D09. A guide earns its place by showing something unpredictable

**Context.** Thirteen guides had been generated, including a pirate dialect, a
corporate-buzzword generator and a haiku sequence (2026-09-28).

**Decision.** Retire those three. Each produced an obvious register shift and
nothing a reader could not predict from the prompt, while costing a full column
of regeneration every time the corpus grew.

**Why.** The project's value is in showing what a style instruction does that
you would not have guessed. A guide whose output is fully implied by its own
prompt is a demonstration, not a finding, and it is not free.

**Consequences.** Ten guides. The refusal finding that lived in one of the
retired guides was moved to a findings page (D06). Novelty guides are not
banned, but a new one should be able to answer "what did this teach you?".

## D10. `claude-style` specifies no manner at all

**Context.** With the generated control gone (D08) there was no column
representing the model's own default voice, which is the thing an actual style
guide should be compared against (2026-09-28).

**Decision.** Add a guide that asks for a rewrite and explicitly withholds any
instruction about how, rather than one that describes a "Claude voice".

**Why.** Describing the default would have produced one more authored style
guide. The absence of instruction *is* the treatment, and it turns out to be
informative: averaged over every passage and run the default runs to 34.5 words
per sentence, longer and more subordinated than every guide here that actually
prescribes a manner.

**Consequences.** The guide's own description has to explain that it is a
deliberate absence, or it reads as an empty prompt. It is also the one guide
whose output will drift if the underlying model's default style changes — which
is arguably the point.

## D11. Two browse axes, updated in place

**Context.** The site originally rendered all thirteen guides as one wide grid
of columns for a selected passage (2026-09-28).

**Decision.** Replace it with two views behind a hash router: one pinning a
guide and varying the passage, one pinning a passage and letting each of two
columns take any voice. Each view builds its chrome once and updates only the
panels when the route changes.

**Why.** Thirteen columns is not a comparison, it is a wall; the questions a
reader actually has are "what does this guide do?" and "which of these do I
want?", which are different axes. Rebuilding the whole view on every navigation
read as a page reload and threw the reader to the top of the page.

**Consequences.** The site now has routing, and `site/app.js` needs tests —
which it had none of. A DOM shim was written for that, and then had to be
hardened when it proved more permissive than a real browser (D12).

## D12. A test double must not be more permissive than the thing it stands for

**Context.** The DOM shim written to test `site/app.js` modelled `childNodes` as
a plain array. Production code called `.map` on it, which passed in the tests
and threw in every browser (2026-09-28).

**Decision.** Model the real API surface, not a convenient approximation:
`childNodes` and `children` return an object with `length`, `item()` and an
iterator and nothing else, and setting a `<select>`'s value to something no
option carries leaves it empty as a real select does. Verify a shim catches a
bug by reintroducing the bug and watching the suite fail.

**Why.** A permissive double is worse than no test, because it converts a bug
that would have been caught into a green suite and a false report of safety.

**Consequences.** The shim is slightly more code. Any future addition to it is
expected to come with the same reintroduce-the-bug check before the suite is
described as passing.

## D13. A gallery is the default on both axes; the columns move to `/compare`

**Context.** With D11's two-column views as the only way in, reading what one
guide does meant picking passages from a dropdown one at a time, and reading
one passage across guides meant cycling a column selector (2026-09-30).

**Decision.** `#/style/<guide>` and `#/source/<passage>` are now galleries:
every output on the axis, stacked at full width, the source passage shown only
on the source axis. The D11 views stay, unchanged, at `/compare`. Each gallery
block has its own run buttons, held as block-local state rather than in the
route.

**Why.** Browsing a voice is the common case, and a long page is faster to scan
than a dropdown. Putting the run of each of nine or ten blocks in the URL would
make it unreadable for no gain — nobody links to "run 3 of block 5".

**Consequences.** A gallery fetches nine or ten cells rather than one. A run
choice in a gallery is not shareable and is lost on reload. A `?source=` or
`?style=` on a gallery scrolls to that block, which is how the compare pages
link back to where the reader came from.
