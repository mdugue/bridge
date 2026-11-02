/**
 * How the nameplate is set in each picture style (lib/city/render-style.ts)
 * and by night: its faces, cases and tracking, its ink, its letters'
 * returns (the sides of built letters: they stand a little deep) and the
 * shadow they cast, a halo where a style draws one, the comic's caption
 * box, the leader's kind. The plate itself is placed the
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
export type NameplateFace = "sans" | "comic" | "condensed" | "grotesk" | "mono";

export const NAMEPLATE_FACE_VARS: Record<NameplateFace, string> = {
  sans: "--font-plate-sans",
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
    /** its tilt (degrees, positive turns it anticlockwise) */
    tilt: number;
  };
  /** the halo round the letters: its colour, opacity and width (a share of
   *  the field's reach, 0…1) */
  halo: DayNight & { alpha: number; width: number };
  ink: DayNight;
  /** the letters' returns: their sides, lit by the sun */
  side: DayNight;
  /** the shadow the letters cast on the city: its colour and strength in
   *  full sun */
  shadow: { colour: Rgb; alpha: number };
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

/** A built sign's lettering: the HUD's Inter, heavy and set tight; its
 *  facts in small tracked capitals. */
const SANS_TITLE: NameplateSetting = {
  face: "sans",
  weight: 800,
  upper: false,
  tracking: -0.02,
};
const SANS_LINES = {
  face: "sans",
  weight: 600,
  upper: true,
  tracking: 0.1,
} as const;
/** No halo: built letters read by their returns and their shadow. */
const NO_HALO = { alpha: 0, width: 0 } as const;

export const NAMEPLATE_TYPES: Readonly<Record<RenderStyle, NameplateType>> = {
  pastel: {
    title: SANS_TITLE,
    // the selection's magenta, deep plum returns: loud on the pastel city
    lines: { ...SANS_LINES, size: 0.44, ink: dn(0x5a_14_70, 0xf3_c6_f5) },
    ink: dn(0xc6_00_de, 0xf0_7a_f5),
    side: dn(0x6a_10_82, 0x5a_1a_70),
    shadow: { colour: hex(0x3a_1a_55), alpha: 0.42 },
    halo: { ...dn(0xf6_ef_e4, 0x1d_24_33), ...NO_HALO },
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
    side: dn(0x11_11_11, 0x11_11_11),
    shadow: { colour: hex(0x11_11_11), alpha: 0.45 },
    halo: { ...dn(0xff_e1_4d, 0x0b_12_33), ...NO_HALO },
    box: {
      fill: dn(0xff_e1_4d, 0x0b_12_33),
      edge: dn(0x11_11_11, 0xff_d2_3f),
      pad: 0.45,
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
    side: dn(0x8a_8a_8a, 0x5a_5a_5a),
    shadow: { colour: hex(0x00_00_00), alpha: 0.5 },
    halo: { ...dn(0x0a_0a_0a, 0x0a_0a_0a), alpha: 0.5, width: 0.4 },
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
    // the one colour Sin City keeps
    side: dn(0xd0_1a_1a, 0xd0_1a_1a),
    shadow: { colour: hex(0x00_00_00), alpha: 0.8 },
    halo: { ...dn(0x00_00_00, 0x00_00_00), alpha: 0.9, width: 0.5 },
    accent: hex(0xd0_1a_1a),
    leader: "hair",
    onGround: false,
  },
  paper: {
    title: SANS_TITLE,
    // a printer's vermilion on the paper, its returns burnt
    lines: { ...SANS_LINES, size: 0.44, ink: dn(0x3a_2a_26, 0xf2_d8_cc) },
    ink: dn(0xe4_3d_12, 0xff_8a_5c),
    side: dn(0x7a_1e_08, 0x6a_24_14),
    shadow: { colour: hex(0x30_34_3c), alpha: 0.22 },
    halo: { ...dn(0xfb_fa_f6, 0x22_26_30), ...NO_HALO },
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
    side: dn(0xb4_b4_b4, 0x60_60_60),
    shadow: { colour: hex(0x1a_1a_1a), alpha: 0.18 },
    halo: { ...dn(0xff_ff_ff, 0x1c_22_30), alpha: 0.6, width: 0.4 },
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
    side: dn(0x88_88_88, 0x88_88_88),
    shadow: { colour: hex(0x11_11_11), alpha: 0.15 },
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
  landmark: { desktop: { min: 36, max: 96 }, phone: { min: 26, max: 56 } },
  named: { desktop: { min: 20, max: 50 }, phone: { min: 16, max: 34 } },
  address: { desktop: { min: 12, max: 24 }, phone: { min: 11, max: 19 } },
  object: { desktop: { min: 13, max: 30 }, phone: { min: 12, max: 22 } },
};

/** The small lines' size against the title's, by rank (an address has
 *  none; a name's or a thing's one line is a little larger than a
 *  landmark's facts):
 *  at the smallest landmark plate the facts stay above ~11 CSS px. */
export function linesSize(type: NameplateType, rank: NameplateRank): number {
  return rank === "landmark" ? type.lines.size : type.lines.size * 1.2;
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
