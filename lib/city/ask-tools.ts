/**
 * *Frag die Stadt*'s tools (ADR 0056), defined once for both sides: the
 * server binds the Stadtwissen ones (`suche_stadt`, `in_der_naehe`,
 * `fakten`, `quellen`), the card the scene ones (`wo_bin_ich`,
 * `was_ist_da`, `zeige`, `setze_zeit`, `setze_stil`, `datenschicht`). The
 * server passes them to the model (`datenschicht` only where the city has
 * a layer) and never takes a tool list from the request: what the model
 * can do is fixed here.
 */
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { ASK_LIMITS } from "./ask-city";
import { DATA_LAYERS } from "./data-layers";
import type { DataLayerDef, DataLayerKey } from "./data-layers";
import { RENDER_STYLES } from "./render-style";
import type { RenderStyle } from "./render-style";

const coordinate = z.number();

export const searchTool = toolDefinition({
  name: "suche_stadt",
  description:
    "Sucht Wahrzeichen, Denkmale, Brunnen und Gebäude dieser Stadt nach Name oder Adresse. Liefert Position (x, y, z), Höhe, id und Quelle; die id nimmt fakten.",
  inputSchema: z.object({
    anfrage: z
      .string()
      .min(2)
      .max(80)
      .describe(
        "Name oder Adresse, z. B. „Frauenkirche“ oder „Augustusstraße 1“"
      ),
  }),
});

export const nearTool = toolDefinition({
  name: "in_der_naehe",
  description:
    "Was in der Nähe eines Punkts steht, das Nächste zuerst: Wahrzeichen, Denkmale, benannte und adressierte Gebäude, mit Abstand in Metern.",
  inputSchema: z.object({
    x: coordinate.describe("Rechtswert (m, nach Osten)"),
    y: coordinate.describe("Hochwert (m, nach Norden)"),
    radius: z
      .number()
      .min(10)
      .max(ASK_LIMITS.radius)
      .default(120)
      .describe("Umkreis in Metern"),
  }),
});

export const factsTool = toolDefinition({
  name: "fakten",
  description:
    "Alles, was das Stadtmodell zu einer id weiß: bei einem Wahrzeichen (Q…) Wikidatas Aussagen (Architekt, Baustil, Entstehung, Ereignisse …) mit Quellen, bei einem Gebäude Nutzung, Dach, Höhe, Geschosse, Denkmalschutz.",
  inputSchema: z.object({
    id: z
      .string()
      .min(2)
      .max(80)
      .describe("die id aus suche_stadt oder in_der_naehe"),
  }),
});

export const sourcesTool = toolDefinition({
  name: "quellen",
  description:
    "Wer die Daten des Stadtmodells herausgibt, unter welcher Lizenz und mit welchem Stand.",
  inputSchema: z.object({}),
});

export const whereTool = toolDefinition({
  name: "wo_bin_ich",
  description:
    "Wo der Besucher gerade steht und wohin er schaut: Position (x, y), Augenhöhe über Normalnull, Blickrichtung (Grad, 0 = Norden, im Uhrzeigersinn), ob er geht, fliegt oder im Modell ist, die Szenenzeit, der Bildstil und die eingeschalteten Datenebenen.",
  inputSchema: z.object({}),
});

export const lookTool = toolDefinition({
  name: "was_ist_da",
  description:
    "Fragt das Stadtmodell, was dort steht, wohin die Ansicht zeigt (die Bildmitte; im Modell der Ort, auf den es ausgerichtet ist) — das Gebäude, den Baum, das Denkmal oder die Brücke — und öffnet dessen Karte im Viewer. Liefert Art, Name, Adresse, gemessene Fakten und Quellen. Für „Was ist das da vorne?“.",
  inputSchema: z.object({}),
});

export const showTool = toolDefinition({
  name: "zeige",
  description:
    "Fliegt die Ansicht zu einem Ort und richtet den Blick darauf. Ohne aus_der_luft steht der Besucher auf der Straße davor, mit aus_der_luft sieht er von schräg oben darauf.",
  inputSchema: z.object({
    x: coordinate.describe("Rechtswert des Ziels"),
    y: coordinate.describe("Hochwert des Ziels"),
    h: z
      .number()
      .min(0)
      .max(400)
      .optional()
      .describe("Höhe des Ziels über Grund (m)"),
    aus_der_luft: z.boolean().default(false),
  }),
});

export const timeTool = toolDefinition({
  name: "setze_zeit",
  description:
    "Stellt die Szenenzeit: die Sonne, die Schatten, Tag oder Nacht. Gib uhrzeit, datum oder beides an; was fehlt, bleibt, wie es ist.",
  inputSchema: z.object({
    uhrzeit: z.iso
      .time({ precision: -1 })
      .optional()
      .describe("HH:MM, Ortszeit der Stadt, z. B. 18:30"),
    datum: z.iso.date().optional().describe("JJJJ-MM-TT"),
  }),
});

const STYLE_IDS = RENDER_STYLES.map((s) => s.id) as [
  RenderStyle,
  ...RenderStyle[],
];

export const styleTool = toolDefinition({
  name: "setze_stil",
  description: "Wählt den Bildstil.",
  inputSchema: z.object({
    stil: z
      .enum(STYLE_IDS)
      .describe(
        RENDER_STYLES.map((s) => `${s.id}: ${s.label}. ${s.description}`).join(
          "\n"
        )
      ),
  }),
});

/** What the model is told of a data layer. */
export type AskLayer = Pick<DataLayerDef, "description" | "key" | "label">;

/** The layer tool, with these layers to choose from. */
function layerToolOf(layers: readonly AskLayer[]) {
  const keys = layers.map((d) => d.key) as [DataLayerKey, ...DataLayerKey[]];
  return toolDefinition({
    name: "datenschicht",
    description: "Schaltet eine Datenebene ein oder aus.",
    inputSchema: z.object({
      schicht: z
        .enum(keys)
        .describe(
          layers.map((d) => `${d.key}: ${d.label}. ${d.description}`).join("\n")
        ),
      an: z.boolean(),
    }),
  });
}

/** Every layer of any city: what the card binds. The model is offered its
 *  own city's (`sceneToolsFor`), a subset the card's schema also takes. */
export const layerTool = layerToolOf(DATA_LAYERS);

/** The tools the browser runs, by name: the card binds each. */
export const SCENE_TOOLS = [
  whereTool,
  lookTool,
  showTool,
  timeTool,
  styleTool,
  layerTool,
] as const;

/**
 * The scene tools as the model is offered them in a city with these
 * layers: the layer tool with that city's layers and words, none where it
 * has no layer. The same for every request of a site, so the provider's
 * prompt cache holds.
 */
export function sceneToolsFor(layers: readonly AskLayer[]) {
  return [
    whereTool,
    lookTool,
    showTool,
    timeTool,
    styleTool,
    ...(layers.length > 0 ? [layerToolOf(layers)] : []),
  ];
}

/** The tools the server runs on the Stadtwissen. */
export const KNOWLEDGE_TOOLS = [
  searchTool,
  nearTool,
  factsTool,
  sourcesTool,
] as const;
