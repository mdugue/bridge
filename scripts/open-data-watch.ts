/**
 * `bun scripts/open-data-watch.ts [site…] [--json]`: the Open-Data-Wächter
 * (docs/routines.md). What changed at the sources since the committed data
 * was fetched, and whether the sources answer at all:
 *
 * - **Editions** — for Saxony, the download-links service's `Stand` per
 *   2 km tile and product (DGM1, DOM1, LoD2, DOP) against the one
 *   `data/<site>/provenance.json` records; the statewide Basis-DLM's
 *   `Last-Modified` against the recorded one. Where a site records no
 *   edition, the current one is listed to record.
 * - **Services** — each provider's download endpoints, answered or not
 *   (one request each, a 20 s budget, all at once).
 * - **OSM** — how old the OSM data the bakes used is (the `dataAsOf` days
 *   in the site's provenance), and the BBBike city extract's
 *   `Last-Modified` where there is one.
 *
 * It downloads no data and changes nothing: it prints a report (German
 * Markdown, or JSON) for the scheduled task to turn into an issue or a
 * re-bake. Exit code 0 whatever it finds; 2 on a usage error.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { siteExtentOf, tileIdOf } from "../lib/city/site";
import { isSiteId, SITES, type SiteId } from "../sites";

const ROOT = join(import.meta.dir, "..");
const TIMEOUT_MS = 20_000;
/** OSM data older than this is a finding (days). */
export const OSM_STALE_DAYS = 60;
/** The Basis-DLM package current at the last download (Last-Modified,
 *  docs/data-pipeline.md), where no provenance records `lastModified`. */
const BASIS_DLM_FALLBACK = "2026-07-28";

/** GeoSN's download-links service: one feature per tile and product. */
const SN_LINKS =
  "https://geodienste.sachsen.de/ags-relay/ArcGISServer/guest/arcgis/rest/services/geosn/rest_geosn_downloadlinks/MapServer";
/** Its layers, by the product name provenance.json uses. */
export const SN_LAYERS = { DGM1: 6, DOM1: 4, LoD2: 3, DOP_RGBI: 17 } as const;
const SN_BASIS_DLM =
  "https://geocloud.landesvermessung.sachsen.de/public.php/dav/files/DtPWngtLEJP8K3k/basisdlm_sn_shape.zip";

/** The endpoints each provider's fetch adapter reads (pipeline/bake/providers/). */
export const SERVICES: Record<string, { name: string; url: string }[]> = {
  sn: [
    {
      name: "Batch-Download-Seite",
      url: "https://www.geodaten.sachsen.de/batch-download-4719.html",
    },
    { name: "Download-Links-Dienst", url: `${SN_LINKS}?f=json` },
    // the GeoCloud is probed with the Basis-DLM's edition (basisDlmFinding)
  ],
  nw: [
    {
      name: "OpenGeodata.NRW",
      url: "https://www.opengeodata.nrw.de/produkte/geobasis/",
    },
  ],
  by: [
    {
      name: "Basis-DLM Bayern",
      url: "https://geodaten.bayern.de/odd/m/2/basisdlm/bkg_shape/bkg_shape_712.zip",
    },
    {
      name: "Laserdaten Bayern",
      url: "https://geodaten.bayern.de/odd_data/laser/",
    },
  ],
  hh: [
    {
      // the folder answers 403; the LoD2 package the adapter reads does not
      name: "Transparenzportal Hamburg (LoD2)",
      url: "https://www.daten-hamburg.de/opendata/3d_stadtmodell_lod2/LoD2-DE_HH_2026-04-28.zip",
    },
  ],
  be: [{ name: "GDI Berlin (Atom)", url: "https://gdi.berlin.de/data/" }],
};

/** BBBike's city extract per site, where there is one. */
export const BBBIKE: Partial<Record<SiteId, string>> = {
  berlin: "Berlin",
  dresden: "Dresden",
  hamburg: "Hamburg",
  leipzig: "Leipzig",
  muenchen: "Muenchen",
};

/** A GeoSN `Kachel` ("4125656": easting and northing km) for a tile cell. */
export function snKachel(cell: { e: number; n: number }): string {
  return `${cell.e}${cell.n}`;
}

/**
 * The OSM data the bakes use, by the first day of every `dataAsOf` in the
 * record (the day of the data, not of a re-bake), past the `overpass`
 * history: the oldest and the newest, or null where none is recorded.
 */
export function osmDataDays(
  record: unknown
): { newest: string; oldest: string } | null {
  const days: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (key === "overpass") {
      return;
    }
    if (key === "dataAsOf" && typeof value === "string") {
      const day = /\b20\d\d-\d\d-\d\d\b/.exec(value)?.[0];
      if (day) {
        days.push(day);
      }
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        walk(v, k);
      }
    }
  };
  walk(record, "");
  days.sort((a, b) => a.localeCompare(b));
  return days.length > 0 ? { oldest: days[0], newest: days.at(-1)! } : null;
}

/** Whole days from `from` (YYYY-MM-DD) to `now`. */
export function daysSince(from: string, now: Date): number {
  return Math.floor(
    (now.getTime() - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  );
}

/**
 * The edition a `Stand` names: the latest of its days ("2024-11-27,
 * 2024-11-30"), or the year it starts with (LoD2's "2024( LSC: 2016, …)",
 * whose inner years are its sources', not its own).
 */
export function standEdition(stand: string): string {
  if (/^\s*\d{4}-\d\d-\d\d/.test(stand)) {
    const days = stand.match(/\b\d{4}-\d\d-\d\d\b/g) ?? [];
    return days.sort((a, b) => a.localeCompare(b)).at(-1)!;
  }
  return /^\s*(\d{4})/.exec(stand)?.[1] ?? stand.trim();
}

/** A recorded `Stand` is older than the current one. */
export function newerStand(
  recorded: string | undefined,
  current: string
): boolean {
  return (
    recorded !== undefined && standEdition(current) > standEdition(recorded)
  );
}

/** An HTTP date as YYYY-MM-DD, or null where it does not parse. */
export function httpDay(header: string | null): string | null {
  const t = header ? Date.parse(header) : Number.NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

interface Provenance {
  geosn?: Record<
    string,
    { lastModified?: string; tiles?: Record<string, { stand?: string }> }
  >;
  openstreetmap?: unknown;
}

export interface Finding {
  site?: string;
  kind: "edition" | "record" | "service" | "osm";
  /** something to act on (a new edition, a service down, stale OSM) */
  act: boolean;
  text: string;
}

async function request(
  url: string,
  init: RequestInit = {}
): Promise<Response | Error> {
  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/** One byte of a URL: whether it answers, without fetching a gigabyte. */
async function probe(url: string): Promise<Response | Error> {
  const r = await request(url, {
    // a range of a compressed body does not inflate
    headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" },
  });
  if (!(r instanceof Error)) {
    await r.body?.cancel().catch(() => undefined);
  }
  return r;
}

const answer = (r: Response | Error) =>
  r instanceof Error ? `keine Antwort (${r.message})` : `HTTP ${r.status}`;

function serviceFindings(providers: Set<string>): Promise<Finding[]> {
  return Promise.all(
    [...providers].flatMap((id) =>
      (SERVICES[id] ?? []).map(async (s): Promise<Finding> => {
        const r = await probe(s.url);
        return {
          kind: "service",
          act: r instanceof Error || r.status >= 400,
          text: `${id.toUpperCase()} · ${s.name}: ${answer(r)}`,
        };
      })
    )
  );
}

async function snStands(
  extent: [number, number, number, number],
  layer: number
): Promise<Map<string, string> | Error> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({
      xmin: extent[0] + 1,
      ymin: extent[1] + 1,
      xmax: extent[2] - 1,
      ymax: extent[3] - 1,
      spatialReference: { wkid: 25_833 },
    }),
    geometryType: "esriGeometryEnvelope",
    inSR: "25833",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "Kachel,Stand",
    returnGeometry: "false",
    f: "json",
  });
  const r = await request(`${SN_LINKS}/${layer}/query?${params}`);
  if (r instanceof Error) {
    return r;
  }
  const body = (await r.json().catch(() => null)) as {
    features?: { attributes: { Kachel: string; Stand: string } }[];
  } | null;
  if (!body?.features) {
    return new Error(`HTTP ${r.status}`);
  }
  return new Map(
    body.features.map((f) => [f.attributes.Kachel, f.attributes.Stand])
  );
}

function provenanceOf(site: SiteId): Provenance | null {
  const file = join(ROOT, "data", site, "provenance.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Provenance)
    : null;
}

/** One product's editions over a site: what is new, what is unrecorded. */
function productFindings(
  site: SiteId,
  product: string,
  stands: Map<string, string>
): Finding[] {
  const config = SITES[site];
  const record = provenanceOf(site)?.geosn?.[product]?.tiles;
  const out: Finding[] = [];
  // the editions no record holds: one line per edition, not one a tile
  const unrecorded = new Map<string, number>();
  for (const cell of config.tiles) {
    const tile = tileIdOf(config, cell);
    const current = stands.get(snKachel(cell));
    const recorded = record?.[tile]?.stand;
    if (!current) {
      continue;
    }
    if (newerStand(recorded, current)) {
      out.push({
        site,
        kind: "edition",
        act: true,
        text: `${product} ${tile}: neuer Stand ${current} (eingecheckt: ${recorded})`,
      });
    } else if (!recorded) {
      unrecorded.set(current, (unrecorded.get(current) ?? 0) + 1);
    }
  }
  for (const [stand, tiles] of unrecorded) {
    out.push({
      site,
      kind: "record",
      act: false,
      text: `${product}: Stand ${stand} (${tiles} ${tiles === 1 ? "Kachel" : "Kacheln"}, nicht in provenance.json)`,
    });
  }
  return out;
}

async function editionFindings(site: SiteId): Promise<Finding[]> {
  if (SITES[site].provider.id !== "sn") {
    return [];
  }
  const extent = siteExtentOf(SITES[site]);
  const per = await Promise.all(
    Object.entries(SN_LAYERS).map(async ([product, layer]) => {
      const stands = await snStands(extent, layer);
      return stands instanceof Error
        ? [
            {
              site,
              kind: "service" as const,
              act: true,
              text: `${product}: Download-Links-Dienst antwortet nicht (${stands.message})`,
            },
          ]
        : productFindings(site, product, stands);
    })
  );
  return per.flat();
}

/** The Basis-DLM package the bakes used: the latest `lastModified` any
 *  site's provenance records, else the fallback. */
function recordedBasisDlm(): string {
  const days = (Object.keys(SITES) as SiteId[]).flatMap((site) => {
    const day = provenanceOf(site)?.geosn?.["Basis-DLM"]?.lastModified;
    return day ? [day] : [];
  });
  return days.sort((a, b) => a.localeCompare(b)).at(-1) ?? BASIS_DLM_FALLBACK;
}

async function basisDlmFinding(): Promise<Finding> {
  const r = await probe(SN_BASIS_DLM);
  if (r instanceof Error || r.status >= 400) {
    return {
      kind: "service",
      act: true,
      text: `SN · GeoCloud (Basis-DLM): ${answer(r)}`,
    };
  }
  const day = httpDay(r.headers.get("last-modified"));
  const recorded = recordedBasisDlm();
  return {
    kind: "edition",
    act: day !== null && day > recorded,
    text: `SN · Basis-DLM: Last-Modified ${day ?? "?"} (eingecheckt: ${recorded})`,
  };
}

async function osmFindings(site: SiteId, now: Date): Promise<Finding[]> {
  const out: Finding[] = [];
  const days = osmDataDays(provenanceOf(site)?.openstreetmap);
  if (days) {
    const age = daysSince(days.oldest, now);
    out.push({
      site,
      kind: "osm",
      act: age > OSM_STALE_DAYS,
      text: `OSM-Daten der Bakes: ältester Stand ${days.oldest} (${age} Tage alt), neuester ${days.newest}`,
    });
  } else {
    out.push({
      site,
      kind: "osm",
      act: false,
      text: "OSM-Stand: in provenance.json kein dataAsOf",
    });
  }
  const city = BBBIKE[site];
  if (city) {
    const r = await request(
      `https://download.bbbike.org/osm/bbbike/${city}/${city}.osm.pbf`,
      { method: "HEAD" }
    );
    const down = r instanceof Error || r.status >= 400;
    out.push({
      site,
      kind: "osm",
      act: down,
      text: down
        ? `BBBike-Auszug ${city}: nicht erreichbar`
        : `BBBike-Auszug ${city}: ${httpDay(r.headers.get("last-modified")) ?? "ohne Datum"}`,
    });
  }
  return out;
}

/** The report as German Markdown: what to act on first, then the rest. */
export function report(findings: readonly Finding[], now: Date): string {
  const line = (f: Finding) =>
    `- ${f.site ? `**${SITES[f.site as SiteId]?.name ?? f.site}** · ` : ""}${f.text}`;
  const act = findings.filter((f) => f.act);
  const rest = findings.filter((f) => !f.act);
  return [
    `# Open-Data-Wächter, ${now.toISOString().slice(0, 10)}`,
    "",
    act.length > 0 ? "## Zu tun" : "## Nichts zu tun",
    ...act.map(line),
    "",
    "## Stand",
    ...rest.map(line),
    "",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const asked = args.filter((a) => !a.startsWith("--"));
  const bad = asked.filter((a) => !isSiteId(a));
  if (bad.length > 0) {
    process.stderr.write(`unbekannte Stadt: ${bad.join(", ")}\n`);
    process.exit(2);
  }
  // the sites whose data is committed (an uncommitted one has no record)
  const sites = (asked.length > 0 ? asked : Object.keys(SITES)).filter((s) =>
    existsSync(join(ROOT, "data", s, "provenance.json"))
  ) as SiteId[];
  const now = new Date();
  const providers = new Set(sites.map((s) => SITES[s].provider.id));
  const parts = await Promise.all([
    serviceFindings(providers),
    providers.has("sn") ? basisDlmFinding().then((f) => [f]) : [],
    ...sites.map(async (site) => [
      ...(await editionFindings(site)),
      ...(await osmFindings(site, now)),
    ]),
  ]);
  const findings = parts.flat();
  process.stdout.write(
    json ? `${JSON.stringify(findings, null, 2)}\n` : report(findings, now)
  );
}

if (import.meta.main) {
  await main();
}
