---
name: activity-card-spec
description: Use whenever a task involves the overall scope, build phase boundaries, or which features are in or out of MVP for the Effort activity-card app. Read this before adding any feature that could plausibly belong to Step 2 (Strava OAuth, accounts) or Step 3 (B2B events). Also useful when deciding whether a refactor or new dependency is justified at the current phase.
---

# activity-card-spec

Quick reference for what's in scope right now. The canonical source is `SPEC.md` at repo root — this skill exists to give the agent a fast yes/no answer on scope questions.

## The product in one line

A client-side web app that turns one GPX or .fit file into a beautiful, shareable PNG of an activity card.

## What's in MVP (build this)

- GPX + .fit upload, drag-and-drop
- Parsing → unified `Activity` shape
- Six themes, sport-aware (ride / run / swim / triathlon)
- Optional background photo
- Live preview + minimal customisation (accent colour, stat toggles)
- PNG export at 1080×1350 via `html-to-image`
- Web Share API on mobile, direct download fallback
- Static deploy, no backend

## What's NOT in MVP (do not build)

- Strava / komoot OAuth (Step 2)
- User accounts, persistence (Step 2)
- Updating Strava activity from the app (Step 2)
- Event organiser dashboard, route overlap scoring (Step 3)
- Email delivery, PDF export (Step 3)
- Stripe / billing (Step 3)
- Map tiles, Mapbox, Google Maps — ever
- Server-side rendering of cards
- AI-anything for the MVP

If a task seems to require one of these, stop and confirm with the user.

## Decision shortcuts

- "Should I add a backend for X?" — no, MVP is fully client-side.
- "Should I store this in localStorage?" — fine for transient UI prefs (selected theme, accent colour), not for activity data.
- "Should I use a map?" — no. Routes are always abstract SVG polylines.
- "Should I add another theme?" — six is the spec. Improve one of the six rather than adding a seventh.
- "Should I support .tcx files?" — defer. GPX + .fit covers 95% of the market.
- "Should I add server-side rendering for SEO?" — no, this is a tool not a content site.

## Tech choices already made (don't relitigate)

- Next.js App Router + TypeScript strict
- Tailwind v4 for styling
- `html-to-image` (not Satori, not Puppeteer) for rasterisation
- `fast-xml-parser` + `fit-file-parser` for parsing
- Cloudflare Pages (or Vercel) for hosting

Reasoning lives in `SPEC.md`.
