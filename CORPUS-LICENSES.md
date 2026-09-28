# Corpus provenance

Every passage in `corpus/` is either public domain or original text written
for this repository and released under CC0. No copyrighted text is
redistributed here.

| Passage | Genre | Source | Licence |
|---|---|---|---|
| `gettysburg` | oratory | Abraham Lincoln, 1863 (Bliss copy) | Public domain |
| `moby-dick` | narrative fiction | Herman Melville, *Moby-Dick*, 1851 | Public domain |
| `declaration` | political rhetoric | United States, 1776 | Public domain |
| `origin-species` | scientific prose | Charles Darwin, *On the Origin of Species*, 1859 first edition (Project Gutenberg ebook 1228) | Public domain |
| `terms-of-service` | legal boilerplate | Written for this repository | CC0 |
| `news-lede` | news | Written for this repository | CC0 |
| `safety-notice` | safety instructions | Written for this repository | CC0 |
| `runbook` | technical procedure | Written for this repository | CC0 |
| `project-docs` | software documentation | This repository's own `docs/architecture.md` | CC0 |

The organisations, services, people, and places named in the CC0 passages are
fictional.

## Style guides

The prompts in `guides/` are original prose written for this repository and
released under the MIT licence with the rest of the code. They describe the
principles of the named style guides in paraphrase rather than transcribing
copyrighted manuals. The one exception is `strunk-white.md`, which quotes the
short rule headings (e.g. "Omit needless words") verbatim from the 1918 first
edition of *The Elements of Style* — that edition is in the public domain in
the United States, so the quotation carries no licence risk; see its
`license_note` frontmatter field. Where a guide corresponds to a published
standard or manual, the file's `source_url` points at the authoritative
document.

`claude-style.md` is a deliberate exception to the pattern: it names no style
and describes no manner. It asks for a rewrite and explicitly withholds any
instruction about how, so that the model's unmarked default is what the column
shows. That absence is the treatment.
