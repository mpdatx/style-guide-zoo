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
