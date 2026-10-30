/**
 * `bun scripts/open-data-watch.ts [site…] [--json]`: the Open-Data-Wächter
 * (docs/routines.md). What changed at the sources since the committed data
 * was fetched, and whether the sources answer at all:
 *
 * - **Editions** — for Saxony, the download-links service's `Stand` per
 *   2 km tile and product (DGM1, DOM1, LoD2, DOP) against the one
 *   `data/<site>/provenance.json` records; the statewide Basis-DLM's
 *   `Last-Modified` against its recorded date. Where a site records no
 *   edition, the current one is listed to record.
 * - **Services** — each provider's download endpoints, answered or not
 *   (one request each, a 20 s budget).
 * - **OSM** — how old the latest OSM date in the site's provenance is,
 *   and the BBBike city extract's `Last-Modified` where there is one.
 *
 * It downloads no data and changes nothing: it prints a report (German
 * Markdown, or JSON) for the scheduled task to turn into an issue or a
 * re-bake. Exit code 0 whatever it finds; 2 on a usage error.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tileExtentOf, tileIdOf } from "../lib/city/site";
import { isSiteId, SITES, type SiteId } from "../sites";

const ROOT = join(import.meta.dir, "..");
const TIMEOUT_MS = 20_000;
/** OSM data older than this is a finding (days). */
export const OSM_STALE_DAYS = 60;

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
    { name: "GeoCloud (Basis-DLM)", url: SN_BASIS_DLM },
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
      name: "Transparenzportal Hamburg",
      url: "https://www.daten-hamburg.de/opendata/",
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

/** The latest YYYY-MM-DD anywhere in a JSON value, or null. */
export function latestDate(value: unknown): string | null {
  const dates = JSON.stringify(value ?? null).match(/\b20\d\d-\d\d-\d\d\b/g);
  return dates ? dates.sort().at(-1)! : null;
}

/** Whole days from `from` (YYYY-MM-DD) to `now`. */
export function daysSince(from: string, now: Date): number {
  return Math.floor(
    (now.getTime() - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  );
}

/** A recorded `Stand` ("2024-11-27, 2024-11-30") is older than the current one. */
export function newerStand(
  recorded: string | undefined,
  current: string
): boolean {
  if (!recorded) {
    return false;
  }
  const last = (s: string) => s.split(/,\s*/).sort().at(-1) ?? s;
  return last(current) > last(recorded);
}

interface Provenance {
  geosn?: Record<string, { tiles?: Record<string, { stand?: string }> }>;
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

async function serviceFindings(providers: Set<string>): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const id of providers) {
    for (const s of SERVICES[id] ?? []) {
      const r = await probe(s.url);
      const ok = !(r instanceof Error) && r.status < 400;
      out.push({
        kind: "service",
        act: !ok,
        text: `${id.toUpperCase()} · ${s.name}: ${
          r instanceof Error
            ? `keine Antwort (${r.message})`
            : `HTTP ${r.status}`
        }`,
      });
    }
  }
  return out;
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

async function editionFindings(site: SiteId): Promise<Finding[]> {
  const config = SITES[site];
  if (config.provider.id !== "sn") {
    return [];
  }
  const record = provenanceOf(site)?.geosn;
  // one query per product over the site's whole extent
  const extents = config.tiles.map(tileExtentOf);
  const extent: [number, number, number, number] = [
    Math.min(...extents.map((e) => e[0])),
    Math.min(...extents.map((e) => e[1])),
    Math.max(...extents.map((e) => e[2])),
    Math.max(...extents.map((e) => e[3])),
  ];
  const out: Finding[] = [];
  for (const [product, layer] of Object.entries(SN_LAYERS)) {
    const stands = await snStands(extent, layer);
    if (stands instanceof Error) {
      out.push({
        site,
        kind: "service",
        act: true,
        text: `${product}: Download-Links-Dienst antwortet nicht (${stands.message})`,
      });
      continue;
    }
    // the editions no record holds, per product: one line, not one a tile
    const unrecorded = new Map<string, number>();
    for (const cell of config.tiles) {
      const tile = tileIdOf(config, cell);
      const current = stands.get(snKachel(cell));
      if (!current) {
        continue;
      }
      const recorded = record?.[product]?.tiles?.[tile]?.stand;
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
  }
  return out;
}

async function basisDlmFinding(): Promise<Finding> {
  const r = await probe(SN_BASIS_DLM);
  if (r instanceof Error) {
    return {
      kind: "service",
      act: true,
      text: `SN · Basis-DLM: keine Antwort (${r.message})`,
    };
  }
  const modified = r.headers.get("last-modified");
  const day = modified ? new Date(modified).toISOString().slice(0, 10) : null;
  // the edition recorded in docs/data-pipeline.md and providers/sn.py
  const recorded = "2026-07-28";
  return {
    kind: "edition",
    act: day !== null && day > recorded,
    text: `SN · Basis-DLM: Last-Modified ${day ?? "?"} (eingecheckt: ${recorded})`,
  };
}

async function osmFindings(site: SiteId, now: Date): Promise<Finding[]> {
  const out: Finding[] = [];
  const latest = latestDate(provenanceOf(site)?.openstreetmap);
  if (latest) {
    const age = daysSince(latest, now);
    out.push({
      site,
      kind: "osm",
      act: age > OSM_STALE_DAYS,
      text: `OSM-Stand der Bakes: ${latest} (${age} Tage alt)`,
    });
  } else {
    out.push({
      site,
      kind: "osm",
      act: false,
      text: "OSM-Stand: in provenance.json kein Datum",
    });
  }
  const city = BBBIKE[site];
  if (city) {
    const r = await request(
      `https://download.bbbike.org/osm/bbbike/${city}/${city}.osm.pbf`,
      { method: "HEAD" }
    );
    out.push({
      site,
      kind: "osm",
      act: r instanceof Error || r.status >= 400,
      text:
        r instanceof Error || r.status >= 400
          ? `BBBike-Auszug ${city}: nicht erreichbar`
          : `BBBike-Auszug ${city}: ${r.headers.get("last-modified") ?? "ohne Datum"}`,
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
  const findings: Finding[] = [];
  const providers = new Set(sites.map((s) => SITES[s].provider.id));
  findings.push(...(await serviceFindings(providers)));
  if (providers.has("sn")) {
    findings.push(await basisDlmFinding());
  }
  for (const site of sites) {
    findings.push(...(await editionFindings(site)));
    findings.push(...(await osmFindings(site, now)));
  }
  process.stdout.write(
    json ? `${JSON.stringify(findings, null, 2)}\n` : report(findings, now)
  );
}

if (import.meta.main) {
  await main();
}
