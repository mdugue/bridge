/**
 * The inquiry card's shape and the German line builders every kind of card
 * shares (ADR 0041): numbers, dates, a position as the thing's key, and
 * the source lines with their editions and licences. No THREE, no DOM.
 */
import type { OsmProduct, SiteProvenance, SourceKey } from "./provenance";

export interface CardFact {
  label: string;
  value: string;
}

export interface InquiryCard {
  /** the address or location line(s), "" when none is known */
  address: string;
  facts: CardFact[];
  /** the key another dataset finds the thing by, shown so it can be copied */
  id: string;
  /** what the key is ("Kennung", "Wikidata", "Lage") */
  idLabel: string;
  /** a small line above the title: what kind of thing this is */
  kicker: string;
  /** one line per source the card quotes, with its edition and licence */
  sources: string[];
  title: string;
}

const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
export const whole = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 0,
});

/** "18,1 m" (heights to the decimetre). */
export function metres(value: number): string {
  return `${decimal.format(value)} m`;
}

/** "1.234 m²" (areas to the square metre). */
export function squareMetres(value: number): string {
  return `${whole.format(value)} m²`;
}

/** Every ISO date in a text as a German date ("2024-11-30" → "30.11.2024"). */
export function germanDates(text: string): string {
  return text.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$3.$2.$1");
}

/** A position as a key to copy: UTM easting and northing to the decimetre
 *  ("412089.7 5656000.4"; the site's CRS, EPSG:25833 for Dresden). */
export function positionKey([x, y]: readonly [number, number]): string {
  return `${x.toFixed(1)} ${y.toFixed(1)}`;
}

/** The first of the texts that says something ("" when none does). */
export function firstText(...texts: (string | null | undefined)[]): string {
  return texts.find((t) => typeof t === "string" && t !== "") ?? "";
}

/** The facts with a value, in order ("" leaves a line out). */
export function factLines(lines: readonly [string, string][]): CardFact[] {
  return lines
    .filter(([, value]) => value !== "")
    .map(([label, value]) => ({ label, value }));
}

/**
 * A source line: what the card took from it, the source, its edition and
 * its credit — "Name: Basis-DLM · Quelle: GeoSN, dl-de/by-2-0". `stand` is
 * the edition to name (a site-wide one by default).
 */
export function sourceLine(
  provenance: SiteProvenance | null,
  key: SourceKey,
  what: readonly string[],
  fallback: { credit: string; label: string },
  stand = provenance?.sources[key]?.stand
): string {
  const source = provenance?.sources[key];
  const label = source?.label ?? fallback.label;
  return [
    what.length > 0 ? `${what.join(", ")}: ${label}` : label,
    stand ? `Stand ${germanDates(stand)}` : "",
    source?.credit ?? fallback.credit,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The OSM source line for one product, naming what the card took. */
export function osmSource(
  provenance: SiteProvenance | null,
  what: readonly string[],
  product: OsmProduct
): string {
  const source = provenance?.sources.osm;
  return [
    `${what.join(", ")}: ${source?.label ?? "OpenStreetMap"}`,
    (source?.stands?.[product] ?? source?.stand)
      ? `Stand ${germanDates(source?.stands?.[product] ?? source?.stand ?? "")}`
      : "",
    `${source?.credit ?? "© OpenStreetMap-Mitwirkende"}, ${source?.licence ?? "ODbL"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const GEOSN_CREDIT = "Quelle: GeoSN, dl-de/by-2-0";
