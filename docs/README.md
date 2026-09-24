# docs/ — the project knowledge base

Durable, version-controlled documentation for the 3D city walker (one site
per build; Dresden is the one site so far): what it shows, where the data
comes from, how it is built, which decisions were taken and why, and what
is still open. It lives in the repository so it
survives across chat threads and contributors.

The site publishes this folder as it is: the guide under `/wissen`, the rest
under `/wissen/dev` ([ADR 0021](./adr/0021-docs-published-under-wissen-with-prerendered-diagrams.md)).
Write for GitHub – relative `.md` links, Mermaid in fenced blocks – and the
pages follow.

## Start here

| You are… | Read |
|---|---|
| a **user** or a curious non-developer | the [guide](./guide/README.md) — in English and German: [how it works](./guide/en/how-it-works.md), [where the data comes from](./guide/en/data-sources.md), [from download to browser](./guide/en/data-journey.md), [using the viewer](./guide/en/using-the-viewer.md), [glossary](./guide/en/glossary.md) |
| a **developer** new to the repo | [AGENTS.md](../AGENTS.md) for stack, commands and gotchas, then [rendering.md](./rendering.md) and [data-pipeline.md](./data-pipeline.md); the current architecture is recorded in ADRs [0023](./adr/0023-land-cover-colours-painted-at-runtime.md) (runtime palette), [0024](./adr/0024-site-streams-as-3d-tiles.md) (3D Tiles streaming), [0025](./adr/0025-bakes-are-one-python-package.md) (the Python bakes) and [0026](./adr/0026-one-site-config-per-build.md) (the site config) |
| about to **change a data → feature transformation** | [data-flow.md](./data-flow.md) + [transformations.md](./transformations.md) (and the rule below) |
| about to **render another place** | [portability.md](./portability.md), the site config ([ADR 0026](./adr/0026-one-site-config-per-build.md)) and [plan 017](./plans/017-germany-wide-sites.md) |
| wondering **why** something is the way it is | [adr/](./adr/README.md), the architecture decision records — including the proposed move to WebGPU + TSL ([ADR 0027](./adr/0027-webgpu-renderer-and-tsl.md)) |
| looking for **what is planned or was rejected** | [plans/](./plans/README.md), the implementation plans, backlog and audit history — open now: [019](./plans/019-gpu-verification.md) (verify the 3D Tiles branch on a real GPU), [020](./plans/020-webgpu-tsl.md) (WebGPU + TSL spike), [021](./plans/021-wissen-astro-starlight.md) (`/wissen` on Astro Starlight) |
| a **coding agent** doing rendering, data or perf work | the [city-walker skill](../.claude/skills/city-walker/SKILL.md) |

## Map

```
docs/
├── README.md              this page
├── guide/                 user-facing, EN + DE (no jargon; every term in the glossary)
│   ├── en/  how-it-works · data-sources · data-journey · using-the-viewer · glossary
│   └── de/  the same five pages in German
├── rendering.md           how data becomes pixels: scene graph, visual-encoding codebook, light, post, budget, streaming boot
├── data-pipeline.md       the Python bakes, the tileset build step, artifact contracts, sizes, provenance, regeneration
├── data-flow.md           source → feature provenance diagram + feature table
├── transformations.md     the ledger: every transformation built / experimental / planned / discontinued, with why
├── portability.md         degradation matrix + porting checklist for other locations
├── adr/                   architecture decision records (one decision per file, numbered)
├── plans/                 implementation plans: open work, condensed history, backlog, audit findings
└── diagrams/              the Mermaid blocks above, rendered to SVG (generated: bun run docs:diagrams)
```

Roles at a glance: **AGENTS.md** = orientation for developers and agents,
the **skill** = how the tricky parts are built (recipes and dead ends),
**docs/** = what it shows, what maps to what, why, and what is next. Personal
agent memory is a scratchpad; anything durable belongs here.

## Keeping these docs current

Docs are only useful if they do not rot. Treat them as part of "done":

> **Definition of Done** — a change that **adds, alters, or drops a
> data → feature transformation** is not complete until:
> 1. [transformations.md](./transformations.md) has the entry with the right
>    status (✅ active · 🧪 experimental · 📋 planned · 🗃️ discontinued —
>    and *why*, especially for discontinued);
> 2. [data-flow.md](./data-flow.md)'s diagram and table reflect any new
>    source, feature or edge;
> 3. [portability.md](./portability.md) records the fallback if a new
>    optional source was introduced;
> 4. the [visual-encoding table](./rendering.md#visual-encoding--which-data-drives-which-pixel)
>    in rendering.md and, if a user can see the difference, the guide's
>    layer table (EN and DE) follow.

> A change that **adds a dataset or edition** updates the guide's
> [data-sources](./guide/en/data-sources.md) page (both languages: download
> route, strengths and weaknesses, edition, licence) and
> [data-pipeline.md](./data-pipeline.md).

> A decision that **constrains future work** (a dependency, a format, a
> rendering approach, a rejected alternative) gets an
> [ADR](./adr/README.md). A rejected idea is worth as much as a shipped
> feature: write it down as 🗃️ discontinued in the ledger so the next thread
> does not retry it blindly.

> Numbers in the guide (download sizes, feature counts, dates) are measured,
> not estimated; [data-pipeline.md](./data-pipeline.md#measuring-what-the-browser-downloads)
> says how.

> A change to a **Mermaid diagram** re-renders it: `bun run docs:diagrams`
> writes the SVG the site shows into `diagrams/` and prunes the old one;
> commit both. `bun run verify` fails while they disagree.

Plans follow their own lifecycle, described in
[plans/README.md](./plans/README.md).
