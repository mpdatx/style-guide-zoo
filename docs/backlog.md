---
title: Backlog
summary: Open work. Closed items move to the archive.
order: 90
---

# Backlog

Each item is `## Bnn. Title` followed by one line, then free prose:

    Status: open · Added: YYYY-MM-DD · Spec: superpowers/specs/… · Source: TODO.md

`Status` and `Added` are required. Statuses: open, in-progress, blocked, done, dropped.
Done and dropped items are moved to the [archive](backlog-archive.md) by the pre-commit
hook. IDs are never reused.

## B01. Verify the site visually in a browser
Status: open · Added: 2026-09-30

Two aspects of the site have only ever been checked by reading the CSS, because
the browser automation extension was never connected during development:

- **Dark mode.** The palette swaps via `prefers-color-scheme` in
  `site/style.css`. The token values have never been seen rendered, so actual
  contrast is unverified — in particular `--muted` on `--surface` for the
  metrics row and disclosure summaries, and `--accent` for links.
- **Narrow width.** `.pair` is
  `repeat(auto-fit, minmax(min(24rem, 100%), 1fr))`, which should collapse the
  two columns to one on a phone. The `.controls` bar is sticky and wraps; how it
  behaves once it wraps to two or three rows on a narrow viewport is the part
  most likely to be wrong.

Acceptance: both checked at a phone width and in dark mode, with any contrast or
wrap problems fixed or recorded here.

Blocks B02 — the repository was kept private specifically until this was done.

## B02. Make the repository public
Status: blocked · Added: 2026-09-30

The repository was created private so the site could be reviewed before
publication. Everything that gated it is done: the corpus and guide prompts are
cleared for redistribution (see [CORPUS-LICENSES](../CORPUS-LICENSES.md)), error
messages are redacted (D07), and the superpowers ledger is excluded from git.

Blocked on B01.

Acceptance: visibility flipped to public, GitHub Pages confirmed serving from
the `site/` artifact, and the README's "Browse the outputs" link resolving.

## B03. Add corpus passages closer to what most readers write
Status: open · Added: 2026-09-30 · Source: conversation, 2026-08-26

The corpus was seeded with public-domain literary and political prose because it
was unambiguously redistributable, with a note at the time that more technical
and contemporary sources would be more useful to most readers and that adding
them was deferred. `project-docs` was the first step in that direction.

Candidates worth considering: an API reference section, a commit message or pull
request description, a bug report, a support reply, a design document, release
notes.

Constraints: every passage must be public domain or original CC0 prose written
for this repository (`corpus/<id>.md` with `license: public-domain` or
`cc0-original`), and each addition costs one full column of generation — ten
guides × five runs = 50 CLI invocations per passage.

Acceptance: at least two new passages in genres not yet represented, generated,
built, and added to the provenance table.
