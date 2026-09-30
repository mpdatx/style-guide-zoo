---
title: Architecture
summary: How a generation happens, how staleness is decided, and where each stage writes.
order: 20
---

# Architecture

This document describes how a generation happens, how the pipeline decides what
to regenerate, and where each stage's output lives on disk. It is also the
source of the `project-docs` corpus passage: the section
[How a generation happens](#how-a-generation-happens) is reproduced verbatim in
`corpus/project-docs.md`, and a test asserts the two stay identical.

## The shape of the pipeline

Four stages, each writing files the next stage reads. Nothing is held in memory
between stages, and nothing runs at page-load time.

```
guides/*.md  corpus/*.md  prompts/*.md
        |
        v
  runner/content.js      parse frontmatter, hash each file
        |
        v
  runner/worklist.js     decide which (guide, passage, run) cells are stale
        |
        v
  runner/backends/cli.js spawn `claude -p`, one child per generation
        |
        v
  results/runs/<guide>/<passage>/r<n>.json      one record per generation
        |
        v
  build/build-site.js    fold records into site data
        |
        v
  site/data/index.json + site/data/cells/*.json
```

## How a generation happens

A generation begins with three files: a style guide, a corpus passage, and a
prompt template. The runner parses the frontmatter of each, hashes the file
whole, and records the hash alongside the output. The guide's body becomes the
system prompt. The passage is substituted into the template to form the user
prompt, which is written to the child process on standard input rather than
passed as an argument, so that no shell quoting rule and no command-line length
limit ever applies to it. The runner then spawns the Claude Code CLI with an
explicit argument vector, requests a JSON envelope, and waits with a timeout
that escalates from a polite termination signal to a forced kill. What comes
back is parsed even when the process exits non-zero, because a refusal arrives
that way: a failing exit code and a well-formed envelope that names the reason.
Every field of that envelope is written to disk, successful or not, along with
the argument vector, the resolved model, the token counts, and the wall-clock
duration.

## Staleness

`runner/record.js` decides whether an existing record still counts. A cell is
current when a successful record exists whose stored guide, passage, and
template hashes all match the files on disk now, and whose backend matches the
one being used.

Two deliberate exclusions:

- **The model is not part of the staleness check.** It is provenance, not
  content. Changing `model` in `config/experiment.json` does not invalidate
  anything; use `--force` if you want a clean re-run on a new model.
- **The backend is.** Otherwise a `--backend fake` test run would write records
  that a later real run would skip over, silently poisoning the published
  dataset with placeholder text.

Because the hash covers the whole file including frontmatter, editing a guide's
`name` or `order` restales every cell for that guide. This is blunt on purpose:
a hash that tried to cover only the prompt body would have to decide what
counts as the body, and being wrong about that is worse than regenerating.

## Records

One JSON file per generation, at
`results/runs/<guide-id>/<passage-id>/r<run-index>.json`. Committed, never
generated in CI. A record carries `schema_version`, the request (backend, CLI
version, model requested, argument vector, system prompt, user prompt, and the
three content hashes), and the response (`ok`, the text, the model actually
reported, the raw `modelUsage` map, token usage, cost, duration, `attempts`,
`stop_reason`, and any error).

Error messages pass through a redactor that strips Windows drive paths, POSIX
home directories, and UNC paths before they are stored, because records are
published and CLI errors carry filesystem paths.

## Site data

`build/build-site.js` reads every record and writes a small index plus one file
per cell, so the browser fetches only the cell it is showing. The index holds
the guide list, the passage list with the full original text of each passage,
and a per-cell summary — run count and failure count, not the runs themselves.

The site's schema version is separate from the record schema version. They
change for different reasons: one when the on-disk record format changes, the
other when the browser's expectations change.

## What is not here

No build step, no bundler, no runtime dependencies, and no framework. The site
is three files served statically. The runner is Node 22 ESM with nothing
outside the standard library, and the tests are `node:test`. Tests never spawn
the CLI; they use a deterministic offline backend.
