# e2e

- Headless specs run `/dresden?scene=lite` (SwiftShader through WebGL2)
  and assert presence, never pixels (ADR 0018). Budget them in frames, share
  one booted page per group, wrap HUD-only steps in `withFramesHeld`, and
  give a spec without a sidebar a small viewport. An untagged spec lands
  in the whole-site CI shard, already the longest; tag it
  (`@desktop-hud`, `@phone`, `@desktop-render`, `@desktop-look`) where it
  fits.
