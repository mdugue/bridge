/**
 * *Frag die Stadt*'s tools (ADR 0056), defined once for both sides. The
 * server answers the Stadtwissen ones (`suche_stadt`, `in_der_naehe`,
 * `fakten`, `quellen`) and `wo_bin_ich` (from the pose the browser sends
 * with the question), and takes in the follow-up questions
 * (`vorschlaege`, the card's chips). The ones that change the view
 * (`SHOWN_TOOLS`: `zeige`, `setze_zeit`, `setze_stil`, `datenschicht`)
 * it acknowledges at once and the card carries out from the stream, so
 * the model writes on without waiting for the browser; only
 * `was_ist_da` — a ray through the crosshair — goes to the browser and
 * back. The server passes them to the model (`datenschicht` only where
 * the city has a layer) and never takes a tool list from the request:
 * what the model can do is fixed here.
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
    "Fragt das Stadtmodell, was dort steht, wohin die Ansicht zeigt (die Bildmitte; im Modell der Ort, auf den es ausgerichtet ist) — das Gebäude, den Baum, das Denkmal oder die Brücke — und öffnet dessen Karte im Viewer. Liefert Art, Name, Adresse, gemessene Fakten und Quellen. Für „Was ist das da vorne?“.",
  inputSchema: z.object({}),
});

/** The most places one `zeige` shows. */
export const SHOW_TARGETS = 8;
/** The widest footprint radius a place may name (m): what
 *  `knowledgeOf` caps a landmark's at. */
export const SHOW_RADIUS = 1000;

export const showTool = toolDefinition({
  name: "zeige",
  description:
    "Fliegt die Ansicht zu einem oder mehreren Orten, so dass sie ganz und gut sichtbar im Bild stehen: die Kamera rechnet Abstand, Richtung und Neigung aus Grundriss und Höhe selbst. Unter der Antwort erscheint jeder Ort als Knopf, ein Klick fliegt hin. Gib alle Orte an, um die es geht, auch verworfene Kandidaten — den wichtigsten zuerst. Ohne aus_der_luft=false sieht der Besucher von schräg oben darauf; mit aus_der_luft=false steht er auf der Straße vor dem ersten.",
  inputSchema: z.object({
    ziele: z
      .array(
        z.object({
          name: z.string().min(1).max(200).describe("wie der Ort heißt"),
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
            .max(SHOW_RADIUS)
            .optional()
            .describe("Radius des Grundrisses (m)"),
        })
      )
      .min(1)
      .max(ASK_LIMITS.results), // a search's whole list; the first eight are shown
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
    "Stellt die Szenenzeit: die Sonne, die Schatten, Tag oder Nacht. Gib uhrzeit, datum oder beides an; was fehlt, bleibt, wie es ist.",
  inputSchema: z.object({
    // plain patterns: the OpenAI-shaped adapters send this tool in strict
    // mode, and no provider has been tried with zod's long ISO ones
    // (`timeProblem` checks the values)
    uhrzeit: z
      .string()
      .regex(/^\d{2}:\d{2}$/u)
      .optional()
      .describe("HH:MM, Ortszeit der Stadt, z. B. 18:30"),
    datum: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional()
      .describe("JJJJ-MM-TT"),
  }),
});

const CLOCK_TIME = z.iso.time({ precision: -1 });
const CALENDAR_DAY = z.iso.date();

/** A change of the scene's time, as `setze_zeit` takes it. */
export interface TimeChange {
  /** YYYY-MM-DD */
  datum?: string;
  /** HH:MM */
  uhrzeit?: string;
}

/** What the model hears for a change that sets nothing, or a time no clock
 *  or calendar has (25:00, 2026-02-31); null for a good one. 24:00 is good:
 *  the day's last minute. The first century is refused, and the year 100
 *  with it, which an offset can tip back into it: `Date` reads those years
 *  as 19xx. */
export function timeProblem({ datum, uhrzeit }: TimeChange): string | null {
  if (!(uhrzeit || datum)) {
    return "Gib eine Uhrzeit oder ein Datum an.";
  }
  if (
    uhrzeit &&
    uhrzeit !== "24:00" &&
    !CLOCK_TIME.safeParse(uhrzeit).success
  ) {
    return "Diese Uhrzeit gibt es nicht.";
  }
  if (!datum) {
    return null;
  }
  if (!CALENDAR_DAY.safeParse(datum).success) {
    return "Dieses Datum gibt es nicht.";
  }
  return datum < "0101" ? "So weit reicht die Szenenzeit nicht zurück." : null;
}

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
export function layerToolOf(layers: readonly AskLayer[]) {
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
 *  own city's (`layerToolOf`), a subset the card's schema also takes. */
export const layerTool = layerToolOf(DATA_LAYERS);

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
 * (ask-effects.ts) — the model needs nothing back from them. The server
 * offers the layer tool with its city's layers (`layerToolOf`).
 */
export const SHOWN_TOOLS = [showTool, timeTool, styleTool, layerTool] as const;

/** The tools the server answers itself. */
export const KNOWLEDGE_TOOLS = [
  searchTool,
  nearTool,
  factsTool,
  sourcesTool,
  whereTool,
  suggestTool,
] as const;
