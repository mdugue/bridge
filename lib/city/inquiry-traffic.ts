/**
 * The inquiry cards of the data layers (ADR 0040's layers, asked like the
 * rest of the twin, ADR 0042): a counted road section of the motor-traffic
 * layer and a live bicycle counter. Each says what its source counted —
 * vehicles a day per direction, the heavy-goods share, the year and how it
 * was counted; bicycles in the last hour — and names the source; the
 * hour's estimate is labelled as one (the typical day's curve, not a
 * count). No THREE, no DOM.
 */
import type { BikeDirection } from "./bike-counts";
import {
  factLines,
  firstText,
  type InquiryCard,
  positionKey,
  whole,
} from "./card-lines";
import type { TrafficFeature, TrafficMethod } from "./features";
import type { TrafficDayKind, TrafficHourStatus } from "./traffic-hours";

type TrafficProps = NonNullable<TrafficFeature["properties"]>;

/** A counted road section someone asked about. */
export interface TrafficInquiry {
  /** the direction the section's line is drawn in, degrees clockwise from
   *  grid north (`f` flows this way, `b` against it) */
  bearing: number;
  /** the layer's credit line (the site's, lib/city/site.ts) */
  credit?: string;
  /** the scene's hour when asked, for the estimate */
  hour?: TrafficHourStatus;
  /** its index in the tile's traffic file */
  index: number;
  kind: "traffic";
  /** the section's middle (the site's CRS) */
  position: [number, number];
  properties: TrafficProps;
  tile: string;
}

/** A live bicycle counter someone asked about. */
export interface BikeInquiry {
  /** the layer's credit line (the site's) */
  credit?: string;
  directions: readonly BikeDirection[];
  id: string;
  kind: "bikes";
  /** the hour counted (local time), null when the feed gave none */
  measuredAt: Date | null;
  name: string;
  /** when the card was asked: a count older than `staleAfterMs` says so */
  now: Date;
  position: [number, number];
  staleAfterMs: number;
  /** where on its street */
  where: string;
}

/** The eight compass points a direction is named by. */
const COMPASS = [
  "Norden",
  "Nordosten",
  "Osten",
  "Südosten",
  "Süden",
  "Südwesten",
  "Westen",
  "Nordwesten",
] as const;

/** "Nordosten" for a bearing (degrees clockwise from north). */
export function towardCompass(bearing: number): string {
  const i = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return COMPASS[i];
}

/** The bearing (degrees clockwise from grid north) from a line's first
 *  point to its last. */
export function lineBearing(coords: readonly (readonly number[])[]): number {
  const a = coords[0] ?? [0, 0];
  const b = coords.at(-1) ?? a;
  return (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
}

const METHOD: Record<TrafficMethod, string> = {
  census: "Straßenverkehrszählung, beide Richtungen zusammen",
  detector: "Detektor, Jahresmittel",
  estimate: "Schätzung des Amts",
  loop: "Induktionsschleife, Jahresmittel",
  man: "Handzählung, auf den Durchschnittstag hochgerechnet",
};

const DAY: Record<TrafficDayKind, string> = {
  weekday: "Werktag",
  saturday: "Samstag",
  sunday: "Sonntag",
};

const percent = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
  style: "percent",
});

/** "9.000 Kfz/Tag · 7,3 % Schwerverkehr" */
function perDay(count: number, heavy: number | undefined): string {
  const share =
    heavy !== undefined && heavy > 0
      ? ` · ${percent.format(heavy)} Schwerverkehr`
      : "";
  return `${whole.format(count)} Kfz/Tag${share}`;
}

/** The hour's estimate, rounded to tens: the day's count spread along the
 *  typical day's curve (lib/city/traffic-hours.ts). */
export function hourEstimate(daily: number, factor: number): number {
  return Math.round(((daily / 24) * factor) / 10) * 10;
}

/** The directions as counted: per direction where both were, the total
 *  where only that is known (or the split is not measured). */
function directionLines(p: TrafficProps, bearing: number): [string, string][] {
  const measured = p.sp !== 1;
  const lines: [string, string][] = [];
  if (measured && p.f !== undefined) {
    lines.push([`Richtung ${towardCompass(bearing)}`, perDay(p.f, p.hf)]);
  }
  if (measured && p.b !== undefined) {
    lines.push([`Richtung ${towardCompass(bearing + 180)}`, perDay(p.b, p.hb)]);
  }
  return lines;
}

/** The counted section's card. */
export function trafficCard(t: TrafficInquiry): InquiryCard {
  const p = t.properties;
  const counted = [p.y ? String(p.y) : "", p.m ? METHOD[p.m] : ""]
    .filter(Boolean)
    .join(" · ");
  const hour = t.hour
    ? [
        `Um ${t.hour.time} (${DAY[t.hour.kind]})`,
        `≈ ${whole.format(hourEstimate(p.t, t.hour.factor))} Kfz/Stunde`,
      ]
    : null;
  const facts = factLines([
    ["Beide Richtungen", `${whole.format(p.t)} Kfz/Tag`],
    ...directionLines(p, t.bearing),
    [
      "Aufteilung",
      p.sp === 1 ? "je zur Hälfte, nicht je Richtung gezählt" : "",
    ],
    ["Gezählt", counted],
    [hour?.[0] ?? "", hour?.[1] ?? ""],
  ]);
  const sources = [
    t.credit ?? "",
    hour
      ? "Stundenwert geschätzt nach dem typischen Tagesgang: Freie und Hansestadt Hamburg, dl-de/by-2-0"
      : "",
  ].filter(Boolean);
  return {
    kicker: p.br === 1 ? "Kfz-Verkehr · Brücke" : "Kfz-Verkehr",
    title: firstText(p.n, "Straßenabschnitt"),
    address: "",
    facts,
    id: positionKey(t.position),
    idLabel: "Lage",
    sources,
  };
}

const clock = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
});

/** The live counter's card. */
export function bikeCard(b: BikeInquiry): InquiryCard {
  const stale =
    b.measuredAt === null ||
    b.now.getTime() - b.measuredAt.getTime() > b.staleAfterMs;
  const facts = factLines([
    ...b.directions.map((d): [string, string] => [
      d.toward ? `Richtung ${d.toward}` : "Räder",
      `${whole.format(d.count)} Räder in der Stunde`,
    ]),
    [
      "Gezählt",
      b.measuredAt
        ? `${clock.format(b.measuredAt)} Uhr${stale ? " (älter als drei Stunden)" : ""}`
        : "ohne Zeitangabe",
    ],
  ]);
  return {
    kicker: "Radzählstelle · live",
    title: b.name || "Radzählstelle",
    address: b.where,
    facts,
    id: b.id || positionKey(b.position),
    idLabel: b.id ? "Zählstelle" : "Lage",
    sources: b.credit ? [b.credit] : [],
  };
}
