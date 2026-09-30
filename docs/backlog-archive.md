---
title: Backlog archive
summary: Closed backlog items, oldest first.
order: 91
---

# Backlog archive

## B01. Verify the site visually in a browser
Status: done · Added: 2026-09-30 · Closed: 2026-09-30

Closed 2026-09-30: the user reviewed the site in a browser and signed off.

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
- **Gallery pages** (D13). The full-width gallery blocks, their run buttons in
  the block header, and the home page's single-column list (title beside
  description above 40rem) were added without being seen rendered either.

Acceptance: both checked at a phone width and in dark mode, with any contrast or
wrap problems fixed or recorded here.

Blocks B02 — the repository was kept private specifically until this was done.

## B02. Make the repository public
Status: done · Added: 2026-09-30 · Closed: 2026-09-30

Closed 2026-09-30: the repository is public, Pages was enabled with GitHub
Actions as the build source (it had never been enabled, which is why every
earlier deploy run failed), the deploy succeeded, and
https://mpdatx.github.io/style-guide-zoo/ serves the site and its data.

The repository was created private so the site could be reviewed before
publication. Everything that gated it is done: the corpus and guide prompts are
cleared for redistribution (see [CORPUS-LICENSES](../CORPUS-LICENSES.md)), error
messages are redacted (D07), and the superpowers ledger is excluded from git.

Blocked on B01.

Acceptance: visibility flipped to public, GitHub Pages confirmed serving from
the `site/` artifact, and the README's "Browse the outputs" link resolving.
