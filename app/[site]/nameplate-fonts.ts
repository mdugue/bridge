/**
 * The faces the nameplate is set in (lib/city/nameplate-type.ts names
 * their CSS variables): served from this site, like every face here (no
 * request to a third party), and declared only — not preloaded: a
 * browser fetches a face when the scene first sets a plate in it
 * (app/_components/nameplate-glyphs.ts `loadFaces`), and only the parts
 * its letters need (Latin Extended for a Polish or Czech name). The sans
 * is the HUD's own Inter (app/layout.tsx), the same files: declared here
 * once more for its Latin Extended part and its heavy weights.
 */
import { Bangers, IBM_Plex_Mono, Inter, Oswald } from "next/font/google";

const sans = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-plate-sans",
  preload: false,
});
const comic = Bangers({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--font-plate-comic",
  preload: false,
});
const condensed = Oswald({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
  variable: "--font-plate-condensed",
  preload: false,
});
const mono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext"],
  weight: "400",
  variable: "--font-plate-mono",
  preload: false,
});

/** The class names that declare the faces' variables. */
export const NAMEPLATE_FONT_VARIABLES = [
  sans.variable,
  comic.variable,
  condensed.variable,
  mono.variable,
];
