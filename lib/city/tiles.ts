/**
 * The 2×2 block of Saxon tiles the viewer loads. Single source of truth shared
 * by the build-time asset copier (scripts/prepare-data.ts) and the client that
 * fetches them (app/_components/city-walk-client.tsx) — keeping them in lockstep
 * so a tile can never be requested at runtime without also being copied to
 * public/. Index 0 is the primary (spawn) tile; the rest are visual context.
 */
export const TILE_NAMES = [
  "33412_5656_2_sn",
  "33410_5656_2_sn",
  "33410_5658_2_sn",
  "33412_5658_2_sn",
] as const;
