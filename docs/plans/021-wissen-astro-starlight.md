# Plan 021: /wissen on Astro Starlight instead of a hand-built Next route

> **Executor instructions**: Phase 0 is a maintainer decision. Nothing
> after it starts until the decisions are recorded in this file. Then one
> PR for Phases 1–3 (the site must not exist twice for long) and one for
> Phase 4. If anything in "STOP conditions" occurs, stop and report. Update
> the status row in `docs/plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat 2c2f228..HEAD -- app/wissen lib/docs scripts/render-diagrams.ts scripts/bake-wissen-hero.ts app/typeset.css e2e/wissen.spec.ts docs/adr/0021-*.md`

## Status

- **Priority**: P3 (simplification; the current site works)
- **Effort**: M (≈ 2–3 days)
- **Risk**: MED. It adds a second site framework (AGENTS.md "ask before
  adding a heavy dependency"), and Astro's type checker does not run on
  TypeScript 7 (see "Tooling").
- **Depends on**: nothing. Independent of plans 019/020.
- **Decision record**: a new ADR that supersedes the rendering half of
  [ADR 0021](../adr/0021-docs-published-under-wissen-with-prerendered-diagrams.md).
  The diagram half (Mermaid rendered once, committed SVGs) stays.
- **Planned at**: commit `2c2f228`, 2026-09-24
- **Status**: TODO. Plan only, not implemented. Phase 0 is waiting on the
  maintainer.

## Why this matters

`/wissen` is a documentation site built by hand inside the viewer's Next
app. It has a route mapping, link rewriting, a menu from the index files, a
Markdown pipeline (unified/remark/rehype + Shiki), a landing page, pager
cards, a language-twin link, `hreflang` alternates, a diagram zoom dialog
and a vendored prose stylesheet:

| Part | Lines |
|---|---|
| `app/wissen/**` (page, layout, landing, nav, icon, markdown, diagram dialog, CSS) | ≈ 1 600 |
| `app/typeset.css` (vendored prose rules) | 492 |
| `lib/docs/` (`routes`, `nav`, `content`, `diagrams`, `files` + tests) | ≈ 700 |
| `scripts/render-diagrams.ts`, `scripts/bake-wissen-hero.ts` | ≈ 300 |

Almost all of it is what a docs framework provides. **Starlight** (Astro's
docs theme; `@astrojs/starlight` 0.42 on `astro` 7.3, September 2026)
covers most of it and adds things the site lacks:

| Need | Today | Starlight |
|---|---|---|
| Markdown → static pages | own remark/rehype pipeline | built in (content collections) |
| Code highlighting | `@shikijs/rehype` | Expressive Code (Shiki), copy button, file titles |
| Sidebar, prev/next | `lib/docs/nav.ts`, `doc-nav.tsx`, pager cards | `sidebar` config, built-in pagination |
| Two languages, twin link, `hreflang` | own twin link + alternates | `locales`, language picker, `hreflang`, a fallback notice for untranslated pages |
| Prose styling | vendored `typeset.css` + preset | theme CSS custom properties (`--sl-*`) |
| Search | none | **Pagefind**, static, no service |
| Table of contents, dark/light, "edit on GitHub", mobile menu | none / partial | built in |
| Broken-link check | none | `starlight-links-validator` (build fails on a dead link) |

Expected balance: about −2 000 lines deleted and +300–400 added (config, a
content loader, two remark plugins wrapping existing pure code, the landing,
a diagram dialog, theme CSS). The unified/remark/rehype/Shiki runtime
dependencies of the Next app go away.

## Target design

- **A workspace package `wissen/`** (Bun workspaces, one `bun.lock`) with
  `astro`, `@astrojs/starlight` and its plugins as its own dependencies. The
  Next app does not depend on any of them.
- **`base: "/wissen"`, static output.** Astro builds `wissen/dist/`.
  `bun run build` runs it before `next build` and copies the result to
  `public/wissen/`. One `rewrites` rule in `next.config.ts` maps
  `/wissen/:path*` to the generated `index.html` files. One deploy, one
  domain, no host configuration. (Alternative in Phase 0: a separate deploy
  on its own subdomain.)
- **Content stays in `docs/`, written for GitHub.** A small custom content
  loader (Astro content layer) reads `../docs/**/*.md` except
  `docs/diagrams/`. It takes each page's `title` from its first `# H1` and
  strips that heading, so no file needs frontmatter (GitHub shows
  frontmatter as a table). It maps file → id with `lib/docs/routes.ts`,
  unchanged.
- **Links**: a remark plugin wraps `lib/docs/routes.ts`'s rewriting
  (`.md` link → route; anything outside `docs/` → GitHub).
  `starlight-links-validator` checks the result.
- **Diagrams**: ADR 0021's pipeline stays as it is: `bun run
  docs:diagrams`, committed `docs/diagrams/<hash>.svg`, sentinel colours
  swapped for CSS variables, and the freshness test. A remark plugin
  replaces each ```` ```mermaid ```` block with its inline SVG (the key
  function is `lib/docs/diagrams.ts`). The zoom becomes an Astro component
  on a native `<dialog>` with a small script. The SVGs must stay inline
  (not `<img>`) so the CSS variables theme them, which rules out image-zoom
  plugins.
- **Menu**: the `sidebar` config is generated at build time from
  `lib/docs/nav.ts`, which already derives the order from
  `docs/guide/README.md` and `docs/README.md`.
- **Look**: the viewer's colour tokens move from `app/globals.css` into one
  shared `styles/tokens.css` that both apps import, and are mapped onto
  Starlight's `--sl-color-*`. Inter and Space Grotesk come from
  `@fontsource-variable/*` (`next/font` is Next-only). The landing is a
  `splash` page with the baked map picture (`bake-wissen-hero.ts` writes it
  into `wissen/src/assets/` instead of `public/data/`). The guide cards use
  Starlight's `CardGrid`/`LinkCard`.

## Phase 0: Maintainer decisions (gate)

1. **A second framework in the repo: yes/no.** It is build-time only for
   the viewer, but it is another toolchain (Astro 7 on Vite 8) to keep
   current.
2. **URL scheme.** Starlight's i18n prefixes every page with its locale.
   The dev docs are English only.
   - **(a) Recommended:** locales `de` + `en`, default `en`. The guide stays
     at `/wissen/de/…` and `/wissen/en/…`. The dev docs move to
     `/wissen/en/dev/…`, and `/wissen/de/dev/…` shows the English text with
     Starlight's "not translated" notice. Redirect the old `/wissen/dev/…`
     URLs permanently. `/wissen` is the German landing (as today) via a root
     page.
   - (b) No Starlight i18n: keep today's URLs exactly and put the twin link
     in a component override (`PageTitle`). This loses the translated UI
     strings, the language picker and the fallback notice.
3. **Integration.** (a) Recommended: copy into `public/wissen/` plus a
   rewrite, as above. (b) A separate deploy on a subdomain.
4. **Look.** Accept Starlight's layout (sidebar left, table of contents
   right) in the viewer's colours and fonts. Today's centred single column
   with cards is not a goal.

## Phase 1: Scaffold and content (M)

1. `wissen/` package: `astro.config.ts` (`site`, `base`, Starlight with
   `title`, `logo`, `social` GitHub link, `editLink.baseUrl` to the repo's
   `docs/`, `lastUpdated: true`), `src/content.config.ts` with the custom
   loader and `docsSchema()`.
2. The loader (`wissen/src/loader.ts`): read files via `lib/docs/files.ts`,
   compute ids via `lib/docs/routes.ts`, extract the H1 as `title` and the
   first paragraph as `description` (the logic in `lib/docs/content.ts`
   moves here), render with the context's `renderMarkdown`.
3. Remark plugins: links (wrapping `routes.ts`) and diagrams (wrapping
   `diagrams.ts`).
4. Build it standalone (`bunx --bun astro build` in `wissen/`; if Astro
   misbehaves under Bun, run the build with Node). Compare the list of
   generated pages with today's `generateStaticParams` output. It must be
   the same set, modulo the URL decision.

## Phase 2: Navigation, languages, look (M)

1. `sidebar` from `lib/docs/nav.ts` (groups: guide DE, guide EN,
   developer docs: overviews, ADRs, plans).
2. `locales` per the Phase 0 decision; redirects for moved URLs in
   `next.config.ts`.
3. `styles/tokens.css` shared; Starlight custom CSS mapping the tokens;
   fonts; the splash landing with the hero picture and the guide as
   `LinkCard`s; the diagram dialog component.
4. `bun run docs:diagrams` is unchanged. Check that the SVGs pick up the
   `--diagram-*` variables in light and dark.

## Phase 3: Wire into the build, delete the old route (S–M)

1. `package.json`: `build` = prepare-data → `bun run --cwd wissen build` →
   copy to `public/wissen/` → `next build`. `dev` runs the Astro dev
   server on its own port for docs work (the viewer does not need it).
   Gitignore `public/wissen/` and `wissen/dist/`.
2. `next.config.ts`: the `/wissen` rewrite, and `Cache-Control` for
   `/wissen/_astro/*` (hashed: immutable) and the HTML (revalidate).
3. Delete `app/wissen/`, `app/typeset.css`, `lib/docs/content.ts` (moved).
   Delete the Next app's `@shikijs/rehype`, `rehype-*`, `remark-*` and
   `hast-util-*` dependencies (check each with `grep`). Delete any shadcn
   component that only `/wissen` used (with its dependency, per AGENTS.md).
4. `e2e/wissen.spec.ts`: keep the five behaviours (entry lists guide and
   dev docs; a guide page carries its prerendered diagram and its twin;
   internal links stay on the site, others go to GitHub; a wide diagram
   opens in a dialog with zoom; an unknown page is a 404) and adapt the
   selectors. Add one test: the search finds "Splatmap".

## Phase 4: Docs (S)

The new ADR (supersedes ADR 0021's page-rendering decision, keeps its
diagram decision). Also update AGENTS.md ("Where things live" → `wissen/`,
commands), `README.md`, `docs/README.md` ("published under /wissen"), and
the city-walker skill's pointers if any.

## Tooling (known conflicts; decide here, not mid-PR)

- **TypeScript 7:** `@astrojs/check` (0.9.x) declares
  `typescript ^5 || ^6` and uses the classic compiler API, which TS 7 does
  not ship. Recommended: no `astro check`. Keep `.astro` files few and thin
  (markup plus props), put logic in `.ts` modules that `bun typecheck`
  covers. Do **not** add a second TypeScript to the repo (AGENTS.md "One
  TypeScript").
- **oxlint / oxfmt:** oxlint lints the script part of `.astro` files; oxfmt
  does not format `.astro`. Either accept that or exclude `.astro` from
  `oxfmt --check`. No Prettier.
- **Bun:** Astro supports running under Bun but is primarily tested on
  Node. Build with `bunx --bun astro build`, and fall back to Node only for
  that step if it fails.
- **Build time:** Astro build plus Pagefind indexing for ≈ 60 pages, about
  10–20 s. Measure it and write the number here.

## Verification

- Every page that exists today exists afterwards (at its new URL per
  Phase 0, with a redirect from the old one). Check with a script that
  diffs the page lists.
- `starlight-links-validator`: zero broken links.
- `lib/docs/diagrams.test.ts` is still green; each diagram renders themed
  in light and dark.
- `bun run verify` and `bun test:e2e` are green, with the adapted
  `wissen.spec.ts` plus the search test.
- JS per page is measured and written here. Starlight ships a little for
  search, theme and the language picker; today there is none beyond the
  zoom button.
- The viewer's own bundle is unchanged or smaller (the remark/rehype chain
  is gone from the Next build).

## STOP conditions

- Phase 0 unanswered, or a second framework declined.
- The loader cannot take titles from the H1 without frontmatter. Report it
  rather than adding frontmatter to every file (GitHub would show it as a
  table).
- Next cannot serve the copied static site under `/wissen` on the deploy
  host with one rewrite: report and take Phase 0 option 3(b).
- The dev-docs URL move (2a) breaks inbound links that cannot be
  redirected.

## Out of scope

- Moving the viewer to Astro. The viewer stays on Next (React shell,
  three.js canvas).
- Translating the dev docs.
- Rendering Mermaid at build time in the browser-less build (ADR 0021's
  reasons still hold).
