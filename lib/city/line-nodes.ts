/**
 * The nodes the fine terrain glTF carries for the lines baked into it
 * (plan 074 part A, ADR 0029): the rails, the trams and the riverside,
 * each part a node of its own (scripts/bake-lines.ts) that the viewer
 * finds by name and gives its material (app/_components/line-looks.ts),
 * counted under its layer in the HUD's census. No THREE, no DOM.
 */

/** Every baked line node → the layer it is part of. */
export const LINE_NODES = {
  "rail-ballast": "rail",
  "rail-tracks": "rail",
  "rail-platforms": "rail",
  "rail-span-top": "rail",
  "rail-span-stone": "rail",
  "tram-rails": "tram",
  "tram-street-rails": "tram",
  "tram-grass": "tram",
  "tram-ballast": "tram",
  "tram-span-top": "tram",
  "tram-span-stone": "tram",
  "tram-masts": "tram",
  "tram-wires": "tram",
  "riverside-pier": "riverside",
  "riverside-hull": "riverside",
  "riverside-pontoon-deck": "riverside",
  "riverside-hut": "riverside",
  "riverside-roof": "riverside",
  "riverside-gangway": "riverside",
  "riverside-railing": "riverside",
  "riverside-groyne": "riverside",
  "riverside-piles": "riverside",
  "riverside-posts": "riverside",
  "riverside-ferry": "riverside",
} as const;

export type LineNode = keyof typeof LINE_NODES;
export type LineLayer = (typeof LINE_NODES)[LineNode];

export const LINE_LAYERS: readonly LineLayer[] = ["rail", "tram", "riverside"];

export function isLineNode(name: string): name is LineNode {
  return Object.hasOwn(LINE_NODES, name);
}

/**
 * The custom vertex attributes of the baked lines: three's glTF loader
 * names them by lower-casing the glTF name (`_WIREDIR` → `_wiredir`); the
 * materials read them by these names (wire-ribbons.ts, riverside-layer.ts).
 */
export const LINE_ATTRIBUTES = {
  _wiredir: "wireDir",
  _wireside: "wireSide",
  _wirehalf: "wireHalf",
  _wakealong: "wakeAlong",
} as const;
