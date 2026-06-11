# AGENTS.md

This file is the entrypoint for coding agents working on this repo.

## What this project is

**Effort** is a client-side web app where endurance athletes upload a GPX or .fit file from an activity (ride, run, swim, triathlon) and download a beautifully designed shareable image — the "activity card".

Single-page, fully client-side, no backend, no auth (for MVP). The card is a React component rasterised to PNG via `html-to-image`.

## Read these before any non-trivial work

1. [`SPEC.md`](./SPEC.md) — product vision, architecture decisions, data model, build phases. This is the source of truth for _what_ and _why_.
2. Skills in `.claude/skills/` — focused technical references:
   - `activity-card-spec/` — quick reference to scope and phases
   - `card-rendering/` — `html-to-image` gotchas, route SVG math, theme component contract
   - `sport-data/` — sport-specific metrics, units, parsing normalisation

If a decision is in SPEC.md, follow it. If you want to deviate, raise it and ask.

## Tech stack

- Next.js (App Router) + TypeScript
- Tailwind v4
- `html-to-image` for DOM-to-PNG
- `fast-xml-parser` for GPX, `fit-file-parser` for .fit
- Deployed as a static site (Cloudflare Pages or Vercel)
- No database, no API routes that hold state (MVP)

## Commands

```bash
bun install
bun dev          # local dev server
bun build        # production build
bun lint
bun typecheck
```

## Conventions

- **TypeScript strict mode.** No `any` without a `// reason:` comment.
- **Tailwind for styling.** No CSS-in-JS, no styled-components. Theme components may use scoped `<style>` for fonts.
- **Components** in `app/_components/` (private to the route) or `components/` (shared).
- **Themes** live in `app/_components/themes/`, one file per theme, all exporting a component with the same `<ActivityCardProps>` interface.
- **No console.log in committed code.** Use proper error UI for user-facing failures.
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.).

## Non-goals (MVP)

To keep the agent focused, these are explicitly out of scope right now:

- Strava / komoot OAuth integration
- User accounts, persistence, saved cards
- Event organiser / B2B verification flow
- PDF export
- Email delivery
- Server-side rendering of cards
- Map tiles (route is always rendered as an abstract SVG silhouette)

If you find yourself reaching for any of these, stop and confirm.

## When in doubt

Ask before:

- Introducing a backend / API route with state
- Changing the data model in SPEC.md
- Adding a seventh theme or removing one of the six
- Bringing in a map library

Small refactors, bug fixes, styling iteration, theme polish — proceed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->
