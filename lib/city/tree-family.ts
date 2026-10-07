/**
 * The register's genera grouped by how a crown looks in summer: which way
 * its green leans, and the colour of its bark. The
 * archetype (lib/city/tree-inventory.ts) already decides the silhouette and
 * the genus the year (lib/city/tree-season.ts); a family is what an
 * illustrator would tell apart at a glance in a street of lindens, planes
 * and robinias. An illustrator's table, not botany: the values are the
 * scene's pastel register.
 *
 * Pure: no THREE, no DOM.
 */
import { TREE_GENERA, type TreeGenus } from "./tree-season";

export const TREE_FAMILIES = [
  "generic",
  "lime",
  "maple",
  "oak",
  "plane",
  "chestnut",
  "feather",
  "birch",
  "blossom",
  "hornbeam",
  "conifer",
] as const;
export type TreeFamily = (typeof TREE_FAMILIES)[number];

export interface FamilyLook {
  /** the summer green, shifted: hue (turns), saturation and lightness
   *  offsets on the HSL the crown would otherwise get */
  summer: readonly [number, number, number];
  /** bark colour (sRGB hex), multiplied into the trunk material's own */
  bark: number;
}

/** The trunk material's own colour: a bark of this hex draws as it is. */
export const TRUNK_BASE = 0x8a_7c_68;

export const FAMILY_LOOK: Readonly<Record<TreeFamily, FamilyLook>> = {
  generic: { summer: [0, 0, 0], bark: TRUNK_BASE },
  // dense, a fresh mid green
  lime: { summer: [0.01, 0.04, 0.02], bark: 0x7c_70_62 },
  maple: { summer: [0, 0.02, -0.02], bark: 0x80_76_6a },
  // broad and irregular, dark, a rough dark bark
  oak: { summer: [0.02, -0.02, -0.06], bark: 0x6e_62_56 },
  // open, light green, the pale mottled bark
  plane: { summer: [-0.01, 0.02, 0.05], bark: 0xb8_b0_96 },
  // the densest dome, deep green
  chestnut: { summer: [0.02, 0.04, -0.07], bark: 0x74_68_5c },
  // pinnate leaves: airy, a yellow-green
  feather: { summer: [-0.03, 0.06, 0.06], bark: 0x7a_70_64 },
  // light, flickering crowns; birch's white stem
  birch: { summer: [-0.015, 0.03, 0.06], bark: 0xe4_e0_d6 },
  // small ornamental crowns: cherries, apples, pears, hawthorn, rowan
  blossom: { summer: [0, 0, 0.02], bark: 0x6c_5c_54 },
  // hornbeam, hop-hornbeam, elm, hazel: close, fine-leaved
  hornbeam: { summer: [0.01, 0, -0.02], bark: 0x9a_96_8c },
  // the conifers (evergreen and the larch kin): close, blue-green, a
  // reddish bark
  conifer: { summer: [0.06, -0.04, -0.06], bark: 0x8c_62_4c },
};

const FAMILY_OF: Readonly<Partial<Record<TreeGenus, TreeFamily>>> = {
  Tilia: "lime",
  Acer: "maple",
  "Acer rubrum": "maple",
  Liquidambar: "maple",
  Quercus: "oak",
  "Quercus rubra": "oak",
  Fagus: "oak",
  Castanea: "oak",
  Juglans: "oak",
  Celtis: "oak",
  Platanus: "plane",
  Aesculus: "chestnut",
  Catalpa: "chestnut",
  Robinia: "feather",
  Gleditsia: "feather",
  Sophora: "feather",
  Fraxinus: "feather",
  Ailanthus: "feather",
  Koelreuteria: "feather",
  Betula: "birch",
  Populus: "birch",
  Alnus: "birch",
  Salix: "birch",
  Ginkgo: "birch",
  Prunus: "blossom",
  Malus: "blossom",
  Pyrus: "blossom",
  Crataegus: "blossom",
  Sorbus: "blossom",
  Carpinus: "hornbeam",
  Ostrya: "hornbeam",
  Ulmus: "hornbeam",
  Corylus: "hornbeam",
  Liriodendron: "plane",
  Larix: "conifer",
  Metasequoia: "conifer",
  Taxodium: "conifer",
};

/**
 * A register tree's family: its genus's (a TREE_GENERA index), an
 * evergreen conifer's (the archetype says so; its genus is "other"), or
 * the generic look.
 */
export function familyOf(genus: number, conifer = false): TreeFamily {
  const named = FAMILY_OF[TREE_GENERA[genus] ?? ""];
  if (named) {
    return named;
  }
  return conifer ? "conifer" : "generic";
}

/** The look of a register tree (familyOf's arguments). */
export function familyLook(genus: number, conifer = false): FamilyLook {
  return FAMILY_LOOK[familyOf(genus, conifer)];
}
