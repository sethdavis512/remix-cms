# App Wiki

An LLM-maintained wiki about the application built on top of this Remix CMS template. Purpose: capture the knowledge that lives above the template code — the app's content model, the decisions behind customizations, requirements, and lessons learned — so it compounds instead of vanishing into chat history.

You are this wiki's maintainer. The human curates sources and asks questions; you do all summarizing, cross-referencing, filing, and bookkeeping. Follow the workflows below exactly. When a workflow feels wrong, propose a change to this file rather than silently deviating.

This wiki documents the *application* (what is built with the CMS), not the template internals — those belong in the repo's root `CLAUDE.md` and `docs/`.

## Layout

- `raw/` — source documents (requirements, meeting notes, decision jottings, articles). **Immutable: never create, edit, or delete anything in `raw/`** except that ingests may save images to `raw/assets/`. This is the source of truth. The user's own unpolished notes (decisions and why, lessons, ideas, stakeholder conversations) are first-class sources here — often the highest-value ones. Capture is frictionless: no formatting required, just get it in.
- `pages/` — the wiki pages you create and maintain. You own this layer entirely.
- `pages/index.md` — catalog of every page. Update on every ingest and whenever you add a page.
- `pages/log.md` — append-only history. Never edit past entries.

## Page conventions

- Filenames: kebab-case, `.md`, descriptive (`article-content-type.md`, not `notes-3.md`).
- Link between pages with wikilinks: `[[article-content-type]]`. Link liberally; the graph is the point.
- Every page starts with YAML frontmatter:

```yaml
---
type: source | content-type | feature | synthesis | answer | derivative
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: []
sources: []   # raw/ files this page draws from
---
```

- Page types:
  - **source** — summary of one document in `raw/`. Key claims, notable data, how it relates to existing pages.
  - **content-type** — one page per type in the app's content model: its fields, relations, who consumes it, publishing rules, and why it is shaped that way (e.g. `article-content-type.md`).
  - **feature** — a capability or customization built on the template: the surface, how it uses the CMS, decisions made along the way (e.g. `public-blog.md`).
  - **synthesis** — the evolving big-picture pages: overviews, theses, open questions.
  - **answer** — a filed query result worth keeping (comparison, analysis, discovered connection).
  - **derivative** — a guideline doc compiled from the wiki (content-model overview, editorial guide, launch checklist). Never edited incrementally: when stale, regenerate it from scratch from its inputs. Frontmatter adds `regenerated_from:` (the pages/sources it compiles) and `regenerated: YYYY-MM-DD`. Slow drift is the point; incremental edits can't catch it.
- Date claims that could go stale ("as of 2026-07, ..."), and record source publication dates in frontmatter when known.
- Flag contradictions inline where they live: `> ⚠️ Conflicts with [[other-page]]: <one-line description>.`

## Ingest workflow

When a new file appears in `raw/` and the user asks to ingest it (default style: supervised):

1. Read the source in full. If it references images, read the text first, then view the images separately.
2. Discuss the key takeaways with the user before filing anything.
3. Write or update the `source` page summarizing it.
4. Update every related page: add cross-links, revise summaries, note where the new source strengthens, extends, or contradicts existing claims. Exception: never edit `derivative` pages during ingest; they are only rebuilt whole.
5. Create new content-type/feature pages for anything significant that lacks one.
6. Update `pages/index.md`.
7. Append a log entry.

A single ingest touching 10-15 pages is normal, not excessive.

## Query workflow

1. Read `pages/index.md` to locate relevant pages; read those pages. Only go back to `raw/` when the wiki lacks the needed detail.
2. Synthesize an answer citing the wiki pages (and their sources) it draws from.
3. If the answer is durable — a comparison, an analysis, a connection worth keeping — offer to file it as an `answer` page, then index and log it.

## Lint workflow

When asked to health-check the wiki:

1. Scan for: contradictions between pages, claims superseded by newer sources, orphan pages (no inbound links), concepts mentioned 3+ times without their own page, missing cross-references, gaps worth new sources, and stale derivatives (any `derivative` page whose `regenerated` date predates ingests that touched its `regenerated_from` inputs — offer to regenerate it from scratch).
2. Report findings grouped by severity before changing anything.
3. Fix what the user approves; log the pass.

## index.md format

One line per page, grouped by category:

```markdown
## Sources
- [[some-note]] — one-line summary (ingested YYYY-MM-DD)

## Content types
- [[article-content-type]] — one-line summary

## Features
## Syntheses
## Answers
## Derivatives
```

## log.md format

Append-only. Every entry starts with this exact prefix so `grep "^## \[" pages/log.md | tail -5` shows recent history:

```markdown
## [YYYY-MM-DD] ingest | Note title
2-3 lines: what was ingested, which pages were created/updated, anything flagged.

## [YYYY-MM-DD] query | Question asked
## [YYYY-MM-DD] lint | Scope of the pass
```
