/**
 * *Frag die Stadt*'s tools (ADR 0056), defined once for both sides: the
 * server binds the Stadtwissen ones (`suche_stadt`, `in_der_naehe`,
 * `fakten`, `quellen`), the card the scene ones (`wo_bin_ich`, `zeige`,
 * `setze_zeit`, `setze_stil`, `datenschicht`). The server passes all of
 * them to the model and never takes a tool list from the request: what
 * the model can do is fixed here.
 */
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { ASK_LIMITS } from "./ask-city";
import { DATA_LAYERS, type DataLayerKey } from "./data-layers";
import { RENDER_STYLES, type RenderStyle } from "./render-style";

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
    "Stellt die Szenenzeit: die Sonne, die Schatten, Tag oder Nacht. Ohne datum bleibt der Tag.",
  inputSchema: z.object({
    stunde: z.number().min(0).max(24).describe("Uhrzeit, z. B. 18.5 für 18:30"),
    datum: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("JJJJ-MM-TT"),
  }),
});

const STYLE_IDS = RENDER_STYLES.map((s) => s.id) as [
  RenderStyle,
  ...RenderStyle[],
];

export const styleTool = toolDefinition({
  name: "setze_stil",
  description: `Wählt den Bildstil: ${RENDER_STYLES.map((s) => `${s.id} (${s.label})`).join(", ")}.`,
  inputSchema: z.object({ stil: z.enum(STYLE_IDS) }),
});

const LAYER_KEYS = DATA_LAYERS.map((d) => d.key) as [
  DataLayerKey,
  ...DataLayerKey[],
];

export const layerTool = toolDefinition({
  name: "datenschicht",
  description: `Schaltet eine Datenebene ein oder aus: ${DATA_LAYERS.map((d) => `${d.key} (${d.label})`).join(", ")}. Nicht jede Stadt hat jede.`,
  inputSchema: z.object({ schicht: z.enum(LAYER_KEYS), an: z.boolean() }),
});

/** The tools the browser runs, by name: the card binds each. */
export const SCENE_TOOLS = [
  whereTool,
  showTool,
  timeTool,
  styleTool,
  layerTool,
] as const;

/** The tools the server runs on the Stadtwissen. */
export const KNOWLEDGE_TOOLS = [
  searchTool,
  nearTool,
  factsTool,
  sourcesTool,
] as const;
