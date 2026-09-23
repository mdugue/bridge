# ADR 0021: docs/ is published as /wissen, and its diagrams are prerendered SVG

- **Status:** accepted
- **Date:** 2026-09

## Context

The knowledge base already existed in two audiences and two languages: the
guide (`docs/guide/{en,de}/`, paired page by page) for people who use the
viewer, and the developer documentation (everything else under `docs/`).
It was only readable on GitHub. The site was to show it too, in the
viewer's own type and colours, without a second copy of any text: every
extra copy is one more place for a number or a dataset edition to rot.

Nine of the pages carry fourteen Mermaid diagrams. Mermaid cannot run on the
server: it lays a diagram out by measuring text in a live DOM. Rendering it
in the browser instead would ship ~1 MB of script to every reader, flash an
empty box before each diagram, show nothing without JavaScript and keep the
diagram text away from anything that indexes the page. A DOM-free renderer
(`beautiful-mermaid`, pure TypeScript) was tried on these diagrams and a
sibling project's: fast and themeable, but it laid out the large provenance
graph far worse than Mermaid itself, and on the sibling's it dropped ER
attribute comments and broke a label containing `[…]`.

## Decision

- **The folder is the site.** `docs/guide/README.md` is `/wissen`,
  `docs/guide/<de|en>/<page>.md` is `/wissen/<de|en>/<page>`, and every
  other file is `/wissen/dev/<path>` (a folder's `README.md` is the folder).
  The mapping, the link rewriting and the menu order live in `lib/docs/`;
  the menu follows the links of `docs/guide/README.md` and
  `docs/README.md`, so reordering an index reorders the site.
- **Markdown stays written for GitHub.** Links remain relative `.md` links;
  at render time a link to another page becomes its route, a link to
  anything outside `docs/` becomes the file on GitHub.
- **Every page is prerendered at build time** (`app/wissen/[[...slug]]`,
  `generateStaticParams`, one `"use cache"` component): remark/rehype on the
  server, Shiki for code, nothing of it in the client bundle. The only
  script on a page is the zoom button of a diagram that is wider than the
  column.
- **Diagrams are rendered once, by the real Mermaid, and committed.**
  `bun run docs:diagrams` (`scripts/render-diagrams.ts`) opens a headless
  Chrome through `Bun.WebView`, loads the page font (Inter), renders every
  ```` ```mermaid ```` block and writes `docs/diagrams/<hash of the
  source>.svg`. Mermaid is handed sentinel colours, which the script then
  swaps for CSS variables (`--diagram-*`, mapped onto the viewer's tokens in
  `app/wissen/wissen.css`), so the SVGs carry no palette of their own. The
  script refuses a diagram that paints any other colour than the theme's
  or the diagram's own `classDef`s, judged on Chrome's computed styles.
- **A freshness test guards the pairing.** `lib/docs/diagrams.test.ts`
  (part of `bun run verify`) fails when a Mermaid block has no SVG, when an
  SVG has no block, or when a sentinel or the measured font name leaked
  into a committed file; the page build fails on a missing SVG as well.

## Consequences

- Editing a diagram means running `bun run docs:diagrams` and committing
  the SVG with it; CI says so if it is forgotten. The build machine needs
  no browser.
- The script needs Bun ≥ 1.4 (`Bun.WebView`) and a Chrome. It uses the
  Chrome backend on every platform, never WebKit, because the measurement
  decides the layout and one engine keeps the committed files from churning
  between machines.
- Restyling the diagrams is a CSS change; changing the Mermaid config, the
  font or the sentinel table is a `RENDER_VERSION` bump in
  `lib/docs/diagrams.ts` followed by a re-render.
- The guide's rule stays: English is the reference, both languages change
  in the same commit. The site shows the twin link and the `hreflang`
  alternates; it does not translate.
- Mermaid is a dev dependency only. The shipped dependencies are the
  unified/remark/rehype chain and Shiki, all server-side.

## Alternatives

- **Mermaid in the browser:** ~1 MB of script, a flash per diagram, empty
  without JavaScript; rejected.
- **`beautiful-mermaid` at build time without a browser:** lost content on
  this repo's diagrams (see Context); rejected for now, worth a second look
  as it matures.
- **MDX or a copy of the pages under `app/`:** a second source for the same
  text, and MDX renders poorly on GitHub; rejected.
- **Rendering diagrams inside `next build`:** needs a Chrome on the build
  machine; rejected in favour of committed SVGs, like the other derived
  artifacts (ADR 0004).

## References

- `lib/docs/` (routes, links, menu, diagram keys and theming, with tests),
  `app/wissen/`, `scripts/render-diagrams.ts`, `docs/diagrams/`,
  `e2e/wissen.spec.ts`
- ADR 0003 (bake heavy inputs at build time), ADR 0004 (commit derived
  artifacts)
