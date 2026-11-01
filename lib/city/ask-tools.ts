/**
 * *Frag die Stadt*'s tools (ADR 0056), defined once for both sides. The
 * server answers the Stadtwissen ones (`suche_stadt`, `in_der_naehe`,
 * `fakten`, `quellen`), the scenarios' sums (`hochwasser_betroffen`,
 * `schattenwurf`, ADR 0058) and `wo_bin_ich` (from the pose the browser
 * sends with the question), and takes in the follow-up questions
 * (`vorschlaege`, the card's chips). The ones that change the view
 * (`SHOWN_TOOLS`: `zeige`, `setze_zeit`, `setze_stil`, `datenschicht`,
 * `zeige_hochwasser`, `plane_baukoerper`) it acknowledges at once and
 * the card carries out from the stream, so the model writes on without
 * waiting for the browser; only `was_ist_da` — a ray through the
 * crosshair — goes to the browser and back. The server passes all of
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

/** The neighbourhood's radius where the model names none (m). */
export const NEAR_RADIUS = 120;

export const nearTool = toolDefinition({
  name: "in_der_naehe",
  description:
    "Was in der Nähe eines Punkts steht, das Nächste zuerst: Wahrzeichen (bis zum Dreifachen des Umkreises), Denkmale, benannte und adressierte Gebäude, mit Abstand in Metern. Ohne x und y um den Besucher. Sagt, um welchen Punkt und welchen Umkreis es gesucht hat.",
  inputSchema: z.object({
    x: coordinate
      .optional()
      .describe("Rechtswert (m, nach Osten); ohne: wo der Besucher steht"),
    y: coordinate
      .optional()
      .describe("Hochwert (m, nach Norden); ohne: wo der Besucher steht"),
    radius: z
      .number()
      .min(10)
      .max(ASK_LIMITS.radius)
      .default(NEAR_RADIUS)
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

/** The most places one `zeige` shows. */
export const SHOW_TARGETS = 8;

export const showTool = toolDefinition({
  name: "zeige",
  description:
    "Fliegt die Ansicht zu einem oder mehreren Orten, so dass sie ganz und gut sichtbar im Bild stehen: die Kamera rechnet Abstand, Richtung und Neigung aus Grundriss und Höhe selbst. Unter der Antwort erscheint jeder Ort als Knopf, ein Klick fliegt hin. Gib alle Orte an, um die es geht, auch verworfene Kandidaten — den wichtigsten zuerst. Ohne aus_der_luft=false sieht der Besucher von schräg oben darauf; mit aus_der_luft=false steht er auf der Straße vor dem ersten.",
  inputSchema: z.object({
    ziele: z
      .array(
        z.object({
          name: z.string().min(1).max(60).describe("wie der Ort heißt"),
          x: coordinate.describe("Rechtswert"),
          y: coordinate.describe("Hochwert"),
          z: z
            .number()
            .optional()
            .describe("Grund in m über NN (aus den Werkzeugen)"),
          h: z
            .number()
            .min(0)
            .max(400)
            .optional()
            .describe("Höhe über Grund (m)"),
          r: z
            .number()
            .min(0)
            .max(1000)
            .optional()
            .describe("Radius des Grundrisses (m)"),
        })
      )
      .min(1)
      .max(SHOW_TARGETS),
    alle: z
      .boolean()
      .default(true)
      .describe(
        "bei mehreren Orten: alle in einer Ansicht (true) oder nur den ersten (false, wenn er die Antwort ist und die anderen Vergleiche sind)"
      ),
    aus_der_luft: z.boolean().default(true),
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

/** The longest follow-up question a chip carries. */
export const SUGGESTION_CHARS = 70;

export const suggestTool = toolDefinition({
  name: "vorschlaege",
  description:
    "Zeigt unter deiner Antwort bis zu drei kurze Folgefragen als Knöpfe, die der Besucher antippen kann. Rufe es am Ende jeder Antwort einmal auf, im selben Zug wie den Text der Antwort, statt Folgefragen in den Text zu schreiben.",
  inputSchema: z.object({
    fragen: z
      .array(z.string().min(3).max(SUGGESTION_CHARS))
      .min(1)
      .max(3)
      .describe(
        "Folgefragen aus Sicht des Besuchers, z. B. „Wer hat sie gebaut?“"
      ),
  }),
});

/** The tools the browser runs and answers, by name: the card binds each. */
export const BROWSER_TOOLS = [lookTool] as const;

/**
 * The tools that change the view: the server acknowledges each at once
 * (ask-run.ts), the card carries it out when its call arrives
 * (ask-effects.ts) — the model needs nothing back from them.
 */
export const SHOWN_TOOLS = [
  showTool,
  timeTool,
  styleTool,
  layerTool,
  floodShowTool,
  volumeTool,
] as const;

/** The tools the server answers itself. */
export const KNOWLEDGE_TOOLS = [
  searchTool,
  nearTool,
  factsTool,
  sourcesTool,
  whereTool,
  floodTool,
  shadowTool,
  suggestTool,
] as const;
