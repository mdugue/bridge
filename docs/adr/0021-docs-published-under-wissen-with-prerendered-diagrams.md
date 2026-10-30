# ADR 0021: docs/ is published as /wissen, and its diagrams are prerendered SVG

- **Status:** accepted
- **Date:** 2026-09

## Context

The knowledge base exists for two audiences in two languages: the guide
(`docs/guide/{en,de}/`) for people who use the viewer, and everything else
for developers. It was readable only on GitHub. Every extra copy of a text
is a place for a number to rot. Mermaid cannot lay out a diagram without a
live DOM, and running it in the browser ships about 1 MB of script.

## Decision

- **The folder is the site:** `docs/guide/README.md` is `/wissen`, a guide
  page is `/wissen/<de|en>/<page>`, every other file `/wissen/dev/<path>`.
  The menu follows the index READMEs' links.
- **Markdown stays written for GitHub:** relative `.md` links, rewritten at
  render time. Every page is prerendered; nothing of the Markdown chain is
  in the client bundle.
- **Diagrams are rendered once by the real Mermaid and committed**
  (`bun run docs:diagrams`, headless Chrome through `Bun.WebView`), with
  colours as CSS variables. A test fails when a block and its SVG drift.
- **English is the guide's reference**; both languages change in the same
  commit.

## Consequences

- Editing a diagram means rendering it and committing the SVG; the build
  needs no browser.
- Reordering an index reorders the site.

## Alternatives

- **Mermaid in the browser:** 1 MB of script, a flash per diagram, empty
  without JavaScript.
- **A DOM-free Mermaid renderer:** lost content on this repo's diagrams.
- **MDX or a copy under `app/`:** a second source for the same text.
