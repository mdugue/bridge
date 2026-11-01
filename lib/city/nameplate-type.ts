/**
 * How the nameplate is set in each picture style (lib/city/render-style.ts)
 * and by night: its faces, cases and tracking, its ink and halo, the
 * comic's caption box, the leader's kind. The plate itself is placed the
 * same in every style (lib/city/nameplate-place.ts); only Schwarzplan
 * lays it on the ground from every view above the building, the plan's
 * own place for lettering. Colours are sRGB (0…1): the plate is drawn after the output
 * transform. No THREE, no DOM.
 */
import type { NameplateRank } from "./nameplate";
import type { CapRange } from "./nameplate-place";
import type { RenderStyle } from "./render-style";

/** The faces the plates are set in (app/[site]/page.tsx loads them, self
 *  hosted, as CSS variables of these names). */
export type NameplateFace =
  | "serif"
  | "serifCaps"
  | "comic"
  | "condensed"
  | "grotesk"
  | "mono";

export const NAMEPLATE_FACE_VARS: Record<NameplateFace, string> = {
  serif: "--font-plate-serif",
  serifCaps: "--font-plate-serif-caps",
  comic: "--font-plate-comic",
  condensed: "--font-plate-condensed",
  grotesk: "--font-heading",
  mono: "--font-plate-mono",
};

export type Rgb = readonly [number, number, number];

export interface NameplateSetting {
  face: NameplateFace;
  /** tracking, in ems */
  tracking: number;
  upper: boolean;
  weight: number;
}

/** A colour by day and by night (the scene's night factor blends them). */
export interface DayNight {
  day: Rgb;
  night: Rgb;
}

export interface NameplateType {
  /** the leader's foot: the selection's accent, or a colour of its own */
  accent: Rgb;
  /** the comic's caption box behind the text */
  box?: {
    edge: DayNight;
    fill: DayNight;
    /** the box's padding around the text, in caps */
    pad: number;
    /** its hard shadow's offset (right, down), in caps */
    shadow: number;
    /** its tilt (degrees, positive turns it anticlockwise) */
    tilt: number;
  };
  /** the halo round the letters: its colour, opacity and width (a share of
   *  the field's reach, 0…1) */
  halo: DayNight & { alpha: number; width: number };
  ink: DayNight;
  /** a hairline, a dimension line with ticks, a caption box's tail */
  leader: "hair" | "dimension" | "tail";
  /** the small lines' setting and ink */
  lines: NameplateSetting & { ink: DayNight; size: number };
  /** laid on the ground from every view above the building */
  onGround: boolean;
  title: NameplateSetting;
}

const hex = (n: number): Rgb => [
  ((n >> 16) & 0xff) / 255,
  ((n >> 8) & 0xff) / 255,
  (n & 0xff) / 255,
];
const dn = (day: number, night: number): DayNight => ({
  day: hex(day),
  night: hex(night),
});

/** The selection's accent (lib/city/outline.ts `SELECTION_ACCENT.line`) in
 *  sRGB. */
const ACCENT = hex(0xc6_00_de);

const SERIF_TITLE: NameplateSetting = {
  face: "serif",
  weight: 600,
  upper: false,
  tracking: 0.01,
};
const SERIF_LINES = {
  face: "serifCaps",
  weight: 600,
  upper: false,
  tracking: 0.12,
} as const;

export const NAMEPLATE_TYPES: Readonly<Record<RenderStyle, NameplateType>> = {
  pastel: {
    title: SERIF_TITLE,
    lines: { ...SERIF_LINES, size: 0.42, ink: dn(0x5b_52_4a, 0xe2_d6_c2) },
    ink: dn(0x3d_38_33, 0xf4_ea_d8),
    halo: { ...dn(0xf6_ef_e4, 0x1d_24_33), alpha: 0.85, width: 0.55 },
    accent: ACCENT,
    leader: "hair",
    onGround: false,
  },
  comic: {
    title: { face: "comic", weight: 400, upper: true, tracking: 0.03 },
    lines: {
      face: "comic",
      weight: 400,
      upper: true,
      tracking: 0.05,
      size: 0.45,
      ink: dn(0x1d_3f_8f, 0xf3_ea_d0),
    },
    ink: dn(0x11_11_11, 0xff_d2_3f),
    halo: { ...dn(0xff_e1_4d, 0x0b_12_33), alpha: 0, width: 0 },
    box: {
      fill: dn(0xff_e1_4d, 0x0b_12_33),
      edge: dn(0x11_11_11, 0xff_d2_3f),
      pad: 0.45,
      shadow: 0.16,
      tilt: 2,
    },
    accent: hex(0x11_11_11),
    leader: "tail",
    onGround: false,
  },
  noir: {
    title: { face: "condensed", weight: 600, upper: true, tracking: 0.06 },
    lines: {
      face: "mono",
      weight: 400,
      upper: false,
      tracking: 0.02,
      size: 0.4,
      ink: dn(0xd6_d6_d6, 0xd6_d6_d6),
    },
    ink: dn(0xf4_f4_f4, 0xf4_f4_f4),
    halo: { ...dn(0x0a_0a_0a, 0x0a_0a_0a), alpha: 0.65, width: 0.5 },
    accent: hex(0xf4_f4_f4),
    leader: "hair",
    onGround: false,
  },
  sincity: {
    title: { face: "condensed", weight: 600, upper: true, tracking: 0.08 },
    lines: {
      face: "condensed",
      weight: 500,
      upper: true,
      tracking: 0.14,
      size: 0.4,
      ink: dn(0xff_ff_ff, 0xff_ff_ff),
    },
    ink: dn(0xff_ff_ff, 0xff_ff_ff),
    halo: { ...dn(0x00_00_00, 0x00_00_00), alpha: 0.9, width: 0.6 },
    accent: hex(0xd0_1a_1a),
    leader: "hair",
    onGround: false,
  },
  paper: {
    title: SERIF_TITLE,
    lines: { ...SERIF_LINES, size: 0.42, ink: dn(0x4a_4f_57, 0xdc_dd_e0) },
    ink: dn(0x2b_2f_36, 0xf2_f0_ea),
    halo: { ...dn(0xfb_fa_f6, 0x22_26_30), alpha: 0.7, width: 0.45 },
    accent: ACCENT,
    leader: "hair",
    onGround: false,
  },
  line: {
    title: { face: "grotesk", weight: 500, upper: true, tracking: 0.18 },
    lines: {
      face: "mono",
      weight: 400,
      upper: true,
      tracking: 0.1,
      size: 0.4,
      ink: dn(0x3a_3a_3a, 0xe6_e2_d8),
    },
    ink: dn(0x1a_1a_1a, 0xf2_ee_e4),
    halo: { ...dn(0xff_ff_ff, 0x1c_22_30), alpha: 0.9, width: 0.5 },
    accent: hex(0x1a_1a_1a),
    leader: "dimension",
    onGround: false,
  },
  figure: {
    title: { face: "grotesk", weight: 500, upper: true, tracking: 0.3 },
    lines: {
      face: "mono",
      weight: 400,
      upper: true,
      tracking: 0.16,
      size: 0.42,
      ink: dn(0xc2_26_1f, 0xc2_26_1f),
    },
    ink: dn(0x11_11_11, 0x11_11_11),
    halo: { ...dn(0xff_fd_f6, 0xff_fd_f6), alpha: 1, width: 0.75 },
    accent: hex(0xc2_26_1f),
    leader: "hair",
    onGround: true,
  },
};

/** How large a plate's capitals show (CSS px), by rank, on a phone and
 *  elsewhere. */
export const NAMEPLATE_CAPS: Record<
  NameplateRank,
  { desktop: CapRange; phone: CapRange }
> = {
  landmark: { desktop: { min: 26, max: 72 }, phone: { min: 22, max: 48 } },
  named: { desktop: { min: 16, max: 40 }, phone: { min: 14, max: 30 } },
  address: { desktop: { min: 11, max: 22 }, phone: { min: 10, max: 18 } },
};

/** The small lines' size against the title's, by rank (an address has
 *  none; a name's one line is a little larger than a landmark's facts):
 *  at the smallest landmark plate the facts stay above ~11 CSS px. */
export function linesSize(type: NameplateType, rank: NameplateRank): number {
  return rank === "named" ? type.lines.size * 1.2 : type.lines.size;
}

/** A colour at the scene's night factor (0 day … 1 night). */
export function atNight(c: DayNight, night: number): Rgb {
  const t = Math.min(Math.max(night, 0), 1);
  return [
    c.day[0] + (c.night[0] - c.day[0]) * t,
    c.day[1] + (c.night[1] - c.day[1]) * t,
    c.day[2] + (c.night[2] - c.day[2]) * t,
  ];
}

/** The plate's own dimming by night: like every unlit layer, a little
 *  quieter (its colours already turn light on dark). */
export function nightDim(night: number): number {
  return 1 - 0.18 * Math.min(Math.max(night, 0), 1);
}
