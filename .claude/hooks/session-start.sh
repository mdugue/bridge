#!/usr/bin/env bash
# SessionStart hook for Claude Code on the web.
#
# Two things have to be true before an agent can run this repo's checks, and
# neither is true in a fresh container:
#
#   1. Bun matches `packageManager` in package.json (the same pin CI reads via
#      `bun-version-file`). The image ships whatever Bun was current when it
#      was built, and that has been behind: on 1.3.11 `bun run docs:diagrams`
#      cannot start at all, because it drives Chrome through `Bun.WebView`,
#      which exists from 1.4, and the first `bun install` may rewrite
#      `bun.lock` to the older lockfile format.
#   2. node_modules exists. Bun can auto-install into its global cache, so
#      some scripts run without it and `tsc` does not, which reads as
#      "TypeScript is broken" rather than "nothing is installed".
#
# Ported from the sibling repo mdugue/alpen, which reads a floor from
# `engines.bun`; here the pin is exact, so the pinned version is installed
# rather than whatever release is current.
#
# Idempotent and quiet: on a container that is already right it does nothing.
set -euo pipefail

# Local machines manage their own toolchain; this is about the web container.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# The pin is whatever package.json already promises – one source of truth.
want=$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"bun@\([0-9.]*\)".*/\1/p' package.json | head -1)
have=$(bun --version 2>/dev/null || echo 0)

# sort -V puts the lower version first; `have` is new enough when `want` leads.
if [ -n "$want" ] && [ "$(printf '%s\n%s\n' "$want" "$have" | sort -V | head -1)" != "$want" ]; then
  echo "Bun $have is older than the pinned $want – installing $want."
  curl -fsSL https://bun.sh/install | bash -s "bun-v$want"
  # The installer writes to $BUN_INSTALL/bin, which today is where the image's
  # own Bun sits – but only today. Put it in front rather than trusting that:
  # if a future image keeps its Bun somewhere else on PATH, `hash -r` alone
  # would clear Bash's cache and still resolve the old binary, and everything
  # below would run on the version we just replaced.
  bin="${BUN_INSTALL:-$HOME/.bun}/bin"
  export PATH="$bin:$PATH"
  hash -r
  # The hook is a subprocess: without this the session's own commands would go
  # on resolving whatever Bun they resolved before it ran.
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"$bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
  fi
  echo "Bun is now $(bun --version) ($(command -v bun))."
fi

# --frozen-lockfile so a session start can never rewrite a committed lockfile.
# No fallback to a plain install: that would catch a network or disk failure
# just as readily as a real mismatch and "fix" it by resolving a different
# dependency graph into the committed lockfile. Bun auto-installs into its
# global cache, so the session still runs; what it must not do is edit the repo.
bun install --frozen-lockfile || {
  echo "bun install --frozen-lockfile failed – dependencies are NOT installed."
  echo "If bun.lock and package.json disagree, fix them; the hook will not."
}
