/**
 * The data layers (Datenebenen): measured traffic shown over the city, each
 * one switched on and off on its own, declared ONCE. The HUD renders its
 * switches from this table, the look store holds one flag per row
 * (look-state.ts), the snapshot codec persists `snapshotKey`, and the scene
 * shows or hides the layer's objects — nothing is drawn, fetched or polled
 * for a layer that is off. All of them start off: they are overlays on the
 * poetic city, not part of it. No THREE, no DOM.
 */

export type DataLayerKey = "bikeLayer" | "trafficLayer" | "tramLayer";

export interface DataLayerDef {
  /** one line for the HUD (German, like the rest of the HUD) */
  description: string;
  /** DOM id of the switch (stable: tests find controls by it) */
  id: string;
  key: DataLayerKey;
  label: string;
  /** Key inside Snapshot.look. Never rename one. */
  snapshotKey: string;
  /** the credit the HUD shows while the layer is on */
  source: string;
}

/** One row per layer, in the order the HUD lists them. */
export const DATA_LAYERS: readonly DataLayerDef[] = [
  {
    key: "trafficLayer",
    id: "data-traffic",
    label: "Kfz-Verkehr",
    description:
      "Gezählte Kraftfahrzeuge je Tag und Straßenabschnitt als gläserne Ströme auf der Fahrbahn: breiter, höher und röter, wo mehr fährt; Licht läuft in Fahrtrichtung, viel Schwerverkehr färbt sie pflaumenfarben",
    snapshotKey: "trafficLayer",
    source: "Verkehrsmengen © Landeshauptstadt Dresden (dl-de/by-2-0)",
  },
  {
    key: "bikeLayer",
    id: "data-bikes",
    label: "Radverkehr (live)",
    description:
      "Die Dauerzählstellen der Stadt: je Fahrtrichtung eine Glassäule, so hoch wie die Räder der letzten Stunde; die Lichtringe darin steigen umso schneller, je mehr fuhren",
    snapshotKey: "bikeLayer",
    source: "Radzählstellen © Landeshauptstadt Dresden (dl-de/by-2-0)",
  },
  {
    key: "tramLayer",
    id: "data-trams",
    label: "Straßenbahnen (Fahrplan)",
    description:
      "Die Bahnen der DVB auf ihren Gleisen, mit einer Lichtspur hinter sich, wie sie der Fahrplan zur Szenenzeit fahren lässt — keine GPS-Positionen",
    snapshotKey: "tramLayer",
    source:
      "Fahrplan: DELFI e.V. via gtfs.de (CC BY 4.0) · Gleise © OpenStreetMap-Mitwirkende (ODbL)",
  },
];

/** Every layer off: what the scene boots with. */
export const DATA_LAYER_DEFAULTS: Readonly<Record<DataLayerKey, boolean>> =
  Object.freeze(
    Object.fromEntries(DATA_LAYERS.map((def) => [def.key, false])) as Record<
      DataLayerKey,
      boolean
    >
  );

/** The rows of the layers that are on. */
export function activeDataLayers(
  values: Readonly<Record<DataLayerKey, boolean>>
): DataLayerDef[] {
  return DATA_LAYERS.filter((def) => values[def.key]);
}

/** Just the data-layer flags of a look (what the look reset keeps). */
export function dataLayersOf(
  values: Readonly<Record<DataLayerKey, boolean>>
): Record<DataLayerKey, boolean> {
  return Object.fromEntries(
    DATA_LAYERS.map((def) => [def.key, values[def.key]])
  ) as Record<DataLayerKey, boolean>;
}
