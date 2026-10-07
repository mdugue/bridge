/**
 * The sources by city: for every site and every thing the viewer draws,
 * where it comes from and how good that source is — derived from the site
 * and provider configs (what a Land publishes openly, which city has a
 * street-tree register), so the knowledge base's table cannot drift from
 * what the pipeline actually reads. `scripts/docs-matrix.ts` writes it to
 * docs/guide/{en,de}/sources-by-city.md; its test fails when the committed
 * pages differ. Pure.
 */
import type { Site } from "./site";

export type Lang = "de" | "en";

/** How good a cell's source is (the symbol and the legend). */
export type Quality = "best" | "osm" | "substitute" | "none";

/** Why a cell is not the best source (its footnote). */
export type Reason =
  | "noCadastre"
  | "noDlm"
  | "noDom"
  | "noHeight"
  | "noLsc"
  | "noNir"
  | "scanNotRead"
  | "censusOnly"
  | "noTrafficCounts"
  | "noLiveBikes"
  | "noTrams";

export interface Cell {
  quality: Quality;
  reason?: Reason;
  source: Record<Lang, string>;
}

interface Row {
  cell: (site: Site) => Cell;
  label: Record<Lang, string>;
}

const SYMBOL: Record<Quality, string> = {
  best: "🟢",
  osm: "🔵",
  substitute: "🟡",
  none: "⚪",
};

const LEGEND: Record<Lang, Record<Quality, string>> = {
  en: {
    best: "official or measured — the best source there is",
    osm: "OpenStreetMap — the only source for it (community-mapped, as complete as the city's mappers made it)",
    substitute:
      "a substitute — the better source is missing for this city (the footnote says why)",
    none: "not drawn — no open source (the footnote says why)",
  },
  de: {
    best: "amtlich oder gemessen — die beste Quelle, die es gibt",
    osm: "OpenStreetMap — die einzige Quelle dafür (von Freiwilligen erfasst, so vollständig wie die Kartierer der Stadt sie gemacht haben)",
    substitute:
      "Ersatz — die bessere Quelle fehlt für diese Stadt (die Fußnote sagt, warum)",
    none: "nicht dargestellt — keine offene Quelle (die Fußnote sagt, warum)",
  },
};

const REASONS: Record<Lang, Record<Reason, string>> = {
  en: {
    noDlm:
      "The Land publishes no open Basis-DLM (the official landscape model), so OpenStreetMap stands in.",
    noNir:
      "The open aerial photograph has no infrared band: the vegetation index is computed from its visible colours (the Green Leaf Index), which tells green from grey well but vigour less well.",
    noLsc:
      "The Land publishes no open classified laser scan (Hamburg declined to, citing privacy).",
    scanNotRead:
      "The pipeline does not read this Land's laser scan yet (no adapter for it).",
    noCadastre:
      "The city publishes no open street-tree register; its street trees come from the canopy and the laser scan only.",
    noHeight:
      "The register has no tree heights: each tree's height is taken from the surface model where it stands, else from its crown.",
    noDom:
      "The Land publishes no open surface model: no measured heights above the ground.",
    censusOnly:
      "The city publishes no counts of its own: the road census counts the federal, state and district roads only, both directions together (shown split evenly).",
    noTrafficCounts:
      "No open counts per road section: the city publishes none, and the road census does not reach its centre.",
    noLiveBikes:
      "No open bicycle counter the browser can read live (counts published yearly, monthly or daily only, or none).",
    noTrams: "The city has no trams.",
  },
  de: {
    noDlm:
      "Das Land veröffentlicht kein offenes Basis-DLM (das amtliche Landschaftsmodell), also springt OpenStreetMap ein.",
    noNir:
      "Das offene Luftbild hat keinen Infrarotkanal: Der Vegetationsindex wird aus seinen sichtbaren Farben berechnet (Green Leaf Index) — er unterscheidet Grün von Grau gut, die Vitalität weniger gut.",
    noLsc:
      "Das Land veröffentlicht keinen offenen klassifizierten Laserscan (Hamburg lehnt das mit Verweis auf den Datenschutz ab).",
    scanNotRead:
      "Die Pipeline liest den Laserscan dieses Landes noch nicht (kein Adapter dafür).",
    noCadastre:
      "Die Stadt veröffentlicht kein offenes Baumkataster; ihre Straßenbäume kommen nur aus dem Kronendach und dem Laserscan.",
    noHeight:
      "Das Kataster kennt keine Baumhöhen: Die Höhe eines Baums kommt aus dem Oberflächenmodell an seinem Standort, sonst aus seiner Krone.",
    noDom:
      "Das Land veröffentlicht kein offenes Oberflächenmodell: keine gemessenen Höhen über dem Boden.",
    censusOnly:
      "Die Stadt veröffentlicht keine eigenen Zählungen: Die Straßenverkehrszählung zählt nur Bundes-, Landes- und Kreisstraßen, beide Richtungen zusammen (je zur Hälfte gezeigt).",
    noTrafficCounts:
      "Keine offenen Zählwerte je Straßenabschnitt: Die Stadt veröffentlicht keine, und die Straßenverkehrszählung reicht nicht bis in ihre Mitte.",
    noLiveBikes:
      "Keine offene Radzählstelle, die der Browser live lesen kann (Zählwerte nur jährlich, monatlich oder täglich, oder gar keine).",
    noTrams: "Die Stadt hat keine Straßenbahn.",
  },
};

const both = (s: string): Record<Lang, string> => ({ de: s, en: s });
const best = (source: string | Record<Lang, string>): Cell => ({
  quality: "best",
  source: typeof source === "string" ? both(source) : source,
});
const osm = (source: Record<Lang, string> = both("OSM")): Cell => ({
  quality: "osm",
  source,
});
const substitute = (
  source: string | Record<Lang, string>,
  reason: Reason
): Cell => ({
  quality: "substitute",
  reason,
  source: typeof source === "string" ? both(source) : source,
});
const none = (reason: Reason): Cell => ({
  quality: "none",
  reason,
  source: { de: "—", en: "—" },
});

/** Lands without a laser scan: not published openly, or not read yet. */
const SCAN_GAPS: Partial<Record<string, Reason>> = { hh: "noLsc" };

/** Registers whose records lack something the viewer then derives. */
const CADASTRE_GAPS: Partial<Record<string, Reason>> = { hamburg: "noHeight" };

const ROWS: Row[] = [
  {
    label: { en: "Terrain", de: "Gelände" },
    cell: () => best("DGM1"),
  },
  {
    label: { en: "Buildings", de: "Gebäude" },
    cell: () => best("LoD2"),
  },
  {
    label: {
      en: "Surfaces (roads, water, meadow …)",
      de: "Flächen (Straße, Wasser, Wiese …)",
    },
    cell: (s) =>
      s.provider.products.dlm ? best("Basis-DLM") : substitute("OSM", "noDlm"),
  },
  {
    label: { en: "Railway tracks", de: "Bahngleise" },
    cell: (s) =>
      s.provider.products.dlm ? best("Basis-DLM") : substitute("OSM", "noDlm"),
  },
  {
    label: { en: "Bridge decks", de: "Brückendecks" },
    cell: (s) => {
      const height = s.provider.products.dom ? "DOM1" : "DGM1";
      return s.provider.products.dlm
        ? best(`Basis-DLM + ${height}`)
        : substitute(`OSM + ${height}`, "noDlm");
    },
  },
  {
    label: {
      en: "Bridge arches, trusses, pylons",
      de: "Brückenbögen, Fachwerke, Pylone",
    },
    cell: (s) =>
      s.provider.products.dom ? best("DOM1 + OSM/Wikidata") : none("noDom"),
  },
  {
    label: { en: "Tree canopy", de: "Baumkronen (Kronendach)" },
    cell: (s) =>
      s.provider.products.dom ? best("DOM1 − DGM1") : none("noDom"),
  },
  {
    label: {
      en: "Street trees (species, crown)",
      de: "Straßenbäume (Art, Krone)",
    },
    cell: (s) => {
      const id = s.treeCadastre?.id;
      if (!id) {
        return none("noCadastre");
      }
      const gap = CADASTRE_GAPS[id];
      const source = { en: "tree register", de: "Baumkataster" };
      return gap ? substitute(source, gap) : best(source);
    },
  },
  {
    label: { en: "Tree rows, hedges", de: "Baumreihen, Hecken" },
    cell: (s) =>
      s.provider.products.dlm
        ? best("Basis-DLM + OSM")
        : substitute("OSM", "noDlm"),
  },
  {
    label: {
      en: "Sheds, extra trees, hedge heights",
      de: "Schuppen, weitere Bäume, Heckenhöhen",
    },
    cell: (s) =>
      s.provider.products.lsc
        ? best({ en: "laser scan", de: "Laserscan" })
        : none(SCAN_GAPS[s.provider.id] ?? "scanNotRead"),
  },
  {
    label: {
      en: "Vegetation colour (vigour)",
      de: "Vegetationsfarbe (Vitalität)",
    },
    cell: (s) => {
      const dop = s.provider.products.dop;
      if (dop === "rgbi") {
        return best("DOP (NDVI)");
      }
      return dop === "rgb"
        ? substitute("DOP RGB (GLI)", "noNir")
        : none("noNir");
    },
  },
  {
    label: { en: "Roof colours", de: "Dachfarben" },
    cell: (s) => (s.provider.products.dop ? best("DOP") : osm()),
  },
  {
    label: { en: "Facade materials", de: "Fassadenmaterial" },
    cell: () => osm({ en: "OSM + neighbourhood", de: "OSM + Nachbarschaft" }),
  },
  {
    label: {
      en: "Towers, chimneys, missing buildings",
      de: "Türme, Schornsteine, fehlende Gebäude",
    },
    cell: (s) => (s.provider.products.dom ? best("DOM1 + OSM") : none("noDom")),
  },
  {
    label: { en: "Landmarks", de: "Wahrzeichen" },
    cell: () => best("Wikidata + OSM"),
  },
  {
    label: {
      en: "Monuments, fountains",
      de: "Denkmäler, Brunnen",
    },
    cell: (s) =>
      s.provider.products.dlm
        ? best("Basis-DLM + OSM")
        : substitute("OSM", "noDlm"),
  },
  {
    label: {
      en: "Street furniture, lamps, stairs, walls, fences, markings, paving, sports grounds, trams, landing stages",
      de: "Stadtmobiliar, Lampen, Treppen, Mauern, Zäune, Markierungen, Beläge, Sportplätze, Straßenbahn, Anleger",
    },
    // Mapillary fills in the lamps and bins OSM lacks (Site.mapillary)
    cell: (s) => (s.mapillary ? osm(both("OSM + Mapillary")) : osm()),
  },
  {
    label: {
      en: "Data layer: motor traffic",
      de: "Datenebene: Kfz-Verkehr",
    },
    cell: (s) => {
      const traffic = s.dataLayers?.traffic;
      if (!traffic) {
        return none("noTrafficCounts");
      }
      if (traffic.source === "dresden" || traffic.source === "berlin") {
        return best({ en: "city counts", de: "Zählungen der Stadt" });
      }
      if (traffic.source === "hamburg") {
        return best({
          en: "city counts (main roads)",
          de: "Zählungen der Stadt (Hauptstraßen)",
        });
      }
      return substitute(
        { en: "road census", de: "Straßenverkehrszählung" },
        "censusOnly"
      );
    },
  },
  {
    label: {
      en: "Data layer: cycling, live",
      de: "Datenebene: Radverkehr live",
    },
    cell: (s) =>
      s.dataLayers?.bikes
        ? best({ en: "city counters", de: "Zählstellen der Stadt" })
        : none("noLiveBikes"),
  },
  {
    label: {
      en: "Data layer: trams by timetable",
      de: "Datenebene: Straßenbahnen (Fahrplan)",
    },
    cell: (s) =>
      s.dataLayers?.trams ? best("GTFS (DELFI) + OSM") : none("noTrams"),
  },
  {
    label: {
      en: "Sky light, far shadows",
      de: "Himmelslicht, Fernschatten",
    },
    cell: () => best("DGM1 + LoD2"),
  },
];

const SUPERSCRIPT = [
  "¹",
  "²",
  "³",
  "⁴",
  "⁵",
  "⁶",
  "⁷",
  "⁸",
  "⁹",
  "¹⁰",
  "¹¹",
  "¹²",
];

const TEXT = {
  en: {
    title: "Sources by city",
    twin: "*Deutsch: [Quellen nach Stadt](../de/sources-by-city.md)*",
    intro: [
      "Every city is drawn the same way, but not every Land publishes the same",
      "data openly. This table shows, for each city and each thing the viewer",
      "draws, where it comes from — and whether that is the best source there",
      "is, the only one, or a stand-in for a better one the Land or city does",
      "not publish. The datasets themselves (downloads, strengths, licences) are",
      "described in [Where the data comes from](./data-sources.md).",
    ],
    generated: [
      "*This page is generated from the site and provider configurations",
      "(`bun run docs:matrix`, `lib/city/source-matrix.ts`), so it always says",
      "what the pipeline actually reads.*",
    ],
    what: "What is drawn",
    legend: "Legend",
    notes: "Why not the best source",
    notBuilt: "configured, not built yet",
    land: "Land",
    score: "from the best source",
    shared: "The same in every city",
    sharedIntro: [
      "These come from the same kind of source everywhere — every Land",
      "publishes them openly, or OpenStreetMap is the one source for them:",
    ],
  },
  de: {
    title: "Quellen nach Stadt",
    twin: "*English: [Sources by city](../en/sources-by-city.md)*",
    intro: [
      "Jede Stadt wird gleich dargestellt, aber nicht jedes Land veröffentlicht",
      "dieselben Daten offen. Diese Tabelle zeigt für jede Stadt und alles, was",
      "der Viewer zeichnet, woher es kommt — und ob das die beste Quelle ist,",
      "die es gibt, die einzige, oder ein Ersatz für eine bessere, die Land oder",
      "Stadt nicht veröffentlichen. Die Datensätze selbst (Download, Stärken,",
      "Lizenzen) beschreibt [Woher die Daten kommen](./data-sources.md).",
    ],
    generated: [
      "*Diese Seite wird aus den Standort- und Anbieter-Konfigurationen erzeugt",
      "(`bun run docs:matrix`, `lib/city/source-matrix.ts`) und sagt deshalb",
      "immer, was die Pipeline tatsächlich liest.*",
    ],
    what: "Was gezeichnet wird",
    legend: "Legende",
    notes: "Warum nicht die beste Quelle",
    notBuilt: "konfiguriert, noch nicht gebaut",
    land: "Land",
    score: "aus der besten Quelle",
    shared: "In jeder Stadt gleich",
    sharedIntro: [
      "Diese Darstellungen kommen überall aus derselben Art Quelle — jedes",
      "Land veröffentlicht sie offen, oder OpenStreetMap ist die eine Quelle",
      "dafür:",
    ],
  },
} as const;

/** One cell for every row and site. */
export function sourceMatrix(sites: readonly Site[]): Cell[][] {
  return ROWS.map((row) => sites.map((s) => row.cell(s)));
}

/** The page in one language. `built` names the sites whose data is in the
 *  repository (the others are marked). */
export function sourceMatrixPage(
  sites: readonly Site[],
  lang: Lang,
  built: ReadonlySet<string>
): string {
  const t = TEXT[lang];
  const matrix = sourceMatrix(sites);
  const cellText = (c: Cell) => `${SYMBOL[c.quality]} ${c.source[lang]}`;
  // rows every city shares go below the table; the table shows differences
  const same = (i: number) =>
    matrix[i].every((c) => cellText(c) === cellText(matrix[i][0]) && !c.reason);
  const differ = ROWS.map((_, i) => i).filter((i) => !same(i));
  const shared = ROWS.map((_, i) => i).filter(same);
  const reasons: Reason[] = [];
  for (const i of differ) {
    for (const c of matrix[i]) {
      if (c.reason && !reasons.includes(c.reason)) {
        reasons.push(c.reason);
      }
    }
  }
  const mark = (c: Cell) =>
    c.reason ? ` ${SUPERSCRIPT[reasons.indexOf(c.reason)]}` : "";
  const head = sites.map((s) =>
    built.has(s.id) ? s.name : `${s.name} (${t.notBuilt})`
  );
  // how many of everything drawn come from the best source, per city
  const score = sites.map((_, j) => {
    const n = ROWS.filter((_, i) => matrix[i][j].quality === "best").length;
    return `**${n}** / ${ROWS.length}`;
  });
  const lines = [
    `# ${t.title}`,
    "",
    t.twin,
    "",
    ...t.intro,
    "",
    `| ${t.what} | ${head.join(" | ")} |`,
    `|---|${sites.map(() => "---").join("|")}|`,
    `| *${t.land}* | ${sites.map((s) => `*${s.provider.land}*`).join(" | ")} |`,
    ...differ.map(
      (i) =>
        `| ${ROWS[i].label[lang]} | ${matrix[i]
          .map((c) => `${cellText(c)}${mark(c)}`)
          .join(" | ")} |`
    ),
    `| ${SYMBOL.best} ${t.score} | ${score.join(" | ")} |`,
    "",
    `## ${t.legend}`,
    "",
    ...(["best", "osm", "substitute", "none"] as const).map(
      (q) => `- ${SYMBOL[q]} ${LEGEND[lang][q]}`
    ),
    "",
    `## ${t.notes}`,
    "",
    ...reasons.map((r, i) => `${i + 1}. ${REASONS[lang][r]}`),
    "",
    `## ${t.shared}`,
    "",
    ...t.sharedIntro,
    "",
    ...shared.map(
      (i) => `- **${ROWS[i].label[lang]}**: ${cellText(matrix[i][0])}`
    ),
    "",
    ...t.generated,
    "",
  ];
  return lines.join("\n");
}
