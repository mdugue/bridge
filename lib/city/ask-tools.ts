/**
 * *Frag die Stadt*'s tools (ADR 0056), defined once for both sides: the
 * server binds the Stadtwissen ones (`suche_stadt`, `in_der_naehe`,
 * `fakten`, `quellen`) and the scenarios' sums (`hochwasser_betroffen`,
 * `schattenwurf`, ADR 0058), the card the scene ones (`wo_bin_ich`,
 * `was_ist_da`, `zeige`, `setze_zeit`, `setze_stil`, `datenschicht`,
 * `zeige_hochwasser`, `plane_baukoerper`). The server passes all of
 * them to the model and never takes a tool list from the request: what
 * the model can do is fixed here.
 */
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { ASK_LIMITS } from "./ask-city";
import { DATA_LAYERS, type DataLayerKey } from "./data-layers";
import { RENDER_STYLES, type RenderStyle } from "./render-style";
import { FLOOD_CM, isCalendarDay, VOLUME_LIMITS } from "./scenario";

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
    "Fragt das Stadtmodell, was in der Bildmitte steht — das Gebäude, den Baum, das Denkmal oder die Brücke unter dem Fadenkreuz, wohin der Besucher gerade schaut — und öffnet dessen Karte im Viewer. Liefert Art, Name, Adresse, gemessene Fakten und Quellen. Für „Was ist das da vorne?“.",
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

// --- the Szenario-Assistent (ADR 0058) -----------------------------------------

const floodAsk = {
  ereignis: z
    .string()
    .max(12)
    .optional()
    .describe(
      "ein bekanntes Hochwasser der Stadt (die Liste steht in deinen Anweisungen), z. B. „2002“"
    ),
  pegel_cm: z
    .number()
    .min(FLOOD_CM.min)
    .max(FLOOD_CM.max)
    .optional()
    .describe("ein Wasserstand am Stadtpegel in cm, statt eines Ereignisses"),
};

export const floodTool = toolDefinition({
  name: "hochwasser_betroffen",
  description:
    "Rechnet aus, welche Gebäude bei einem Wasserstand des Flusses mit dem Fuß unter dem Wasserspiegel stünden: Anzahl nach Wassertiefe, die tiefsten benannten Gebäude und Wahrzeichen. Optional nur im Umkreis eines Punkts. Ohne Deiche und Schutzwände, eine Modellrechnung — nur für Städte mit Pegeldaten.",
  inputSchema: z.object({
    ...floodAsk,
    x: coordinate.optional().describe("Mittelpunkt (Rechtswert)"),
    y: coordinate.optional().describe("Mittelpunkt (Hochwert)"),
    radius: z
      .number()
      .min(50)
      .max(3000)
      .optional()
      .describe("Umkreis in Metern"),
  }),
});

export const floodShowTool = toolDefinition({
  name: "zeige_hochwasser",
  description:
    "Zeigt im Stadtmodell den Wasserspiegel des Flusses bei einem Hochwasser oder Wasserstand (eine Wasserfläche über dem Gelände) oder blendet ihn mit aus aus.",
  inputSchema: z.object({
    ...floodAsk,
    aus: z.boolean().default(false),
  }),
});

const side = z.number().min(VOLUME_LIMITS.side[0]).max(VOLUME_LIMITS.side[1]);
const volume = {
  x: coordinate.describe("Mitte (Rechtswert)"),
  y: coordinate.describe("Mitte (Hochwert)"),
  breite: side.describe("Seite in Ost-West-Richtung vor der Drehung (m)"),
  tiefe: side.describe("Seite in Nord-Süd-Richtung vor der Drehung (m)"),
  hoehe: z
    .number()
    .min(VOLUME_LIMITS.height[0])
    .max(VOLUME_LIMITS.height[1])
    .describe("Höhe über Gelände (m); ein Geschoss sind etwa 3 m"),
  drehung: z
    .number()
    .min(-360)
    .max(360)
    .default(0)
    .describe("Drehung im Uhrzeigersinn (Grad)"),
};

export const shadowTool = toolDefinition({
  name: "schattenwurf",
  description:
    "Rechnet für einen geplanten Baukörper (Quader) an einem Tag Stunde für Stunde Sonnenhöhe, Schattenrichtung und -länge aus und welche bekannten Nachbargebäude (nach ihrem Mittelpunkt) im Schatten liegen. Ebenes Gelände, ohne die Schatten der Nachbarn; eine Modellrechnung.",
  inputSchema: z.object({
    ...volume,
    datum: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isCalendarDay, "kein Kalendertag zwischen 1900 und 2100")
      .describe("JJJJ-MM-TT, z. B. 2026-12-21 für den kürzesten Tag"),
  }),
});

export const volumeTool = toolDefinition({
  name: "plane_baukoerper",
  description:
    "Stellt einen geplanten Baukörper als hellen Quader ins Stadtmodell, mit echtem Schattenwurf (die Zeit stellt setze_zeit), oder nimmt ihn mit aus wieder heraus. Bestehende Gebäude an der Stelle bleiben stehen.",
  // every field optional: taking the box away needs only `aus`
  inputSchema: z.object({
    ...z.object(volume).partial().shape,
    aus: z.boolean().default(false),
  }),
});

/** The tools the browser runs, by name: the card binds each. */
export const SCENE_TOOLS = [
  whereTool,
  lookTool,
  showTool,
  timeTool,
  styleTool,
  layerTool,
  floodShowTool,
  volumeTool,
] as const;

/** The tools the server runs on the Stadtwissen. */
export const KNOWLEDGE_TOOLS = [
  searchTool,
  nearTool,
  factsTool,
  sourcesTool,
  floodTool,
  shadowTool,
] as const;
