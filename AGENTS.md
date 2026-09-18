# AGENTS.md

This file is the entrypoint for coding agents working on this repo.

## Conventions

- **TypeScript strict mode.** No `any` without a `// reason:` comment.
- **Tailwind for styling.** No CSS-in-JS, no styled-components. Theme components may use scoped `<style>` for fonts.
- **Components** in `app/_components/` (private to the route) or `components/` (shared).
- **No console.log in committed code.** Use proper error UI for user-facing failures.
- **Commit messages**: Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.).

## When in doubt

Ask before:

- Introducing a backend / API route with state

Small refactors, bug fixes, styling iteration, theme polish — proceed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->
