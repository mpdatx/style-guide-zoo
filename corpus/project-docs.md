---
id: project-docs
title: How a Generation Happens
genre: software documentation
source: This repository's own documentation (docs/architecture.md)
license: cc0-original
order: 90
---

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
