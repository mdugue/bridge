import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  SRGBColorSpace,
} from "three/webgpu";
import { detectGeoreference, utmZone } from "@/lib/city/design-placement";
import { readDxf } from "@/lib/city/dxf";
import { readLandXml } from "@/lib/city/landxml";
import { PLAN_LOOKS, type PlanClass } from "@/lib/city/plan-classes";
import {
  type PlanFeature,
  type PlanPoint,
  planMesh,
} from "@/lib/city/plan-geometry";
import { recordFeatures } from "@/lib/city/plan-records";
import { type GeoRecord, readShapefile } from "@/lib/city/shapefile";
import { readGpkgGeometry } from "@/lib/city/wkb";

/**
 * A landscape plan as a design (ADR 0054): a DXF, a Shapefile (with its
 * .dbf, .cpg and .prj picked together), a GeoPackage or a LandXML file,
 * read on the device into plan features (lib/city/dxf.ts, shapefile.ts,
 * wkb.ts, landxml.ts) and built as surfaces on the ground, trees, planned
 * buildings and a planned ground (lib/city/plan-geometry.ts). A
 * GeoPackage's tables are read with sql.js (SQLite as WebAssembly, from
 * the site's own `/wasm/`, loaded only for it).
 *
 * A plan in the site's UTM coordinates lies on the ground the tiles
 * already loaded have there; one in other coordinates is laid flat and
 * placed by hand. Its surfaces are ground: they press the city's ground
 * and clear its trees (design-site.ts), but take no house away — only a
 * planned building does (`userData.planGround`).
 */

/** Where the site serves sql.js's .wasm (scripts/copy-wasm.ts). */
export const SQL_WASM_PATH = "/wasm/sql-wasm-browser.wasm";

/** Thrown with a sentence for the panel. */
export class PlanError extends Error {}

/** The plan formats by the main file's extension. */
export const PLAN_FORMATS = /\.(dxf|shp|gpkg|xml|landxml)$/i;

/** The words the panel uses for a class. */
const CLASS_WORDS: Record<PlanClass, string> = {
  lawn: "Rasen",
  planting: "Pflanzung",
  wood: "Gehölz",
  paving: "Pflaster",
  path: "Wege",
  road: "Fahrbahn",
  water: "Wasser",
  sand: "Sand",
  gravel: "Kies",
  building: "Gebäude",
  tree: "Bäume",
  terrain: "Gelände",
};

/** A file picked with `main` by its extension (same name first). */
function sibling(main: File, files: readonly File[], ext: string) {
  const stem = main.name.replace(/\.[^.]+$/, "").toLowerCase();
  const all = files.filter((f) => f.name.toLowerCase().endsWith(ext));
  return (
    all.find((f) => f.name.toLowerCase() === `${stem}${ext}`) ?? all[0] ?? null
  );
}

/** The EPSG code a .prj's WKT names, where it says one. */
function prjEpsg(wkt: string): number | null {
  const code = /AUTHORITY\["EPSG",\s*"?(\d{4,5})"?\]\s*\]\s*$/.exec(wkt.trim());
  if (code) {
    return Number(code[1]);
  }
  const zone = /UTM[_ ]?zone[_ ]?(\d{2})N/i.exec(wkt);
  if (zone && /ETRS|GRS[_ ]?1980|ETRF/i.test(wkt)) {
    return 25_800 + Number(zone[1]);
  }
  if (/DHDN|Gauss|Gauß|Kruger|Krüger/i.test(wkt)) {
    return 31_468;
  }
  return null;
}

/** A GeoPackage's feature tables as records, with their SRS. */
async function readGpkg(file: File): Promise<{
  layers: { name: string; records: GeoRecord[] }[];
  epsg: number | null;
}> {
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs({ locateFile: () => SQL_WASM_PATH });
  const db = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
  try {
    const columns = db.exec(
      "SELECT c.table_name, c.column_name, s.organization, s.organization_coordsys_id FROM gpkg_geometry_columns c LEFT JOIN gpkg_spatial_ref_sys s ON s.srs_id = c.srs_id"
    )[0];
    const layers: { name: string; records: GeoRecord[] }[] = [];
    let epsg: number | null = null;
    for (const row of columns?.values ?? []) {
      const [table, column, organization, code] = row.map(String);
      if (organization.toUpperCase() === "EPSG") {
        epsg = Number(code);
      }
      const result = db.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`)[0];
      if (!result) {
        continue;
      }
      const g = result.columns.indexOf(column);
      const records: GeoRecord[] = [];
      for (const values of result.values) {
        const blob = values[g];
        if (!(blob instanceof Uint8Array)) {
          continue;
        }
        const attributes: GeoRecord["attributes"] = {};
        result.columns.forEach((name, i) => {
          const v = values[i];
          if (i !== g && (typeof v === "string" || typeof v === "number")) {
            attributes[name] = v;
          }
        });
        for (const shape of readGpkgGeometry(blob).shapes) {
          records.push({ ...shape, attributes });
        }
      }
      layers.push({ name: table, records });
    }
    return { layers, epsg };
  } finally {
    db.close();
  }
}

/** The plan's features, the EPSG code it names (if it does) and a word on
 *  its layers. */
async function readFeatures(
  main: File,
  files: readonly File[]
): Promise<{
  features: PlanFeature[];
  epsg: number | null;
  unclassified: string[];
}> {
  const name = main.name.toLowerCase();
  if (name.endsWith(".dxf")) {
    const text = await main.text();
    if (text.startsWith("AutoCAD Binary DXF")) {
      throw new PlanError(
        "Binäres DXF wird nicht gelesen. Bitte als ASCII-DXF exportieren."
      );
    }
    const plan = readDxf(text);
    return {
      features: plan.features,
      epsg: null,
      unclassified: plan.unclassified,
    };
  }
  if (name.endsWith(".shp")) {
    const dbf = sibling(main, files, ".dbf");
    const cpg = sibling(main, files, ".cpg");
    const prj = sibling(main, files, ".prj");
    const records = readShapefile(
      await main.arrayBuffer(),
      dbf ? await dbf.arrayBuffer() : null,
      cpg ? await cpg.text() : null
    );
    const layer = main.name.replace(/\.shp$/i, "");
    const { features, classes } = recordFeatures(records, layer);
    return {
      features,
      epsg: prj ? prjEpsg(await prj.text()) : null,
      unclassified: classes.has(null) ? [layer] : [],
    };
  }
  if (name.endsWith(".gpkg")) {
    const { layers, epsg } = await readGpkg(main);
    const features: PlanFeature[] = [];
    const unclassified: string[] = [];
    for (const layer of layers) {
      const read = recordFeatures(layer.records, layer.name);
      features.push(...read.features);
      if (read.classes.has(null)) {
        unclassified.push(layer.name);
      }
    }
    return { features, epsg, unclassified };
  }
  const plan = readLandXml(await main.text());
  return { features: plan.features, epsg: plan.epsg, unclassified: [] };
}

/** Every point of the plan's features. */
function* pointsOf(features: readonly PlanFeature[]): Generator<PlanPoint> {
  for (const f of features) {
    if (f.kind === "tree") {
      yield f.at;
    } else if (f.kind === "area") {
      for (const ring of f.rings) {
        yield* ring;
      }
    } else {
      for (const tri of f.triangles) {
        yield* tri;
      }
    }
  }
}

/** The features with `dx` taken off every easting (a zone prefix). */
function shiftEast(features: PlanFeature[], dx: number): PlanFeature[] {
  if (dx === 0) {
    return features;
  }
  const s = (p: PlanPoint): PlanPoint =>
    p[2] === undefined ? [p[0] - dx, p[1]] : [p[0] - dx, p[1], p[2]];
  return features.map((f) => {
    if (f.kind === "tree") {
      return { ...f, at: s(f.at) };
    }
    if (f.kind === "area") {
      return { ...f, rings: f.rings.map((r) => r.map(s)) };
    }
    return {
      ...f,
      triangles: f.triangles.map(([a, b, c]) => [s(a), s(b), s(c)] as const),
    };
  });
}

/** The plan's box in plan (x, y). */
function planBox(features: readonly PlanFeature[]) {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pointsOf(features)) {
    box.x0 = Math.min(box.x0, x);
    box.y0 = Math.min(box.y0, y);
    box.x1 = Math.max(box.x1, x);
    box.y1 = Math.max(box.y1, y);
  }
  return box;
}

/** What the panel says about the plan, in one or two sentences. */
function planNote(
  counts: Map<PlanClass | "other", number>,
  unclassified: readonly string[],
  georeferenced: boolean,
  undraped: number
): string {
  const parts = [...counts.entries()]
    .filter(([cls]) => cls !== "other")
    .map(([cls, n]) =>
      cls === "tree" ? `${n} Bäume` : CLASS_WORDS[cls as PlanClass]
    )
    .filter((v, i, all) => all.indexOf(v) === i);
  let note = `Landschaftsplan: ${parts.join(", ") || "Flächen"}.`;
  if (unclassified.length > 0) {
    const shown = unclassified.slice(0, 4).join(", ");
    note += ` Ohne Zuordnung (grau): ${shown}${unclassified.length > 4 ? " …" : ""}.`;
  }
  if (!georeferenced) {
    note += " Ohne Landeskoordinaten: flach gelegt, bitte platzieren.";
  } else if (undraped > 0) {
    note +=
      " Wo das Gelände noch nicht geladen war, liegt der Plan auf der tiefsten bekannten Höhe; neu laden, wenn du dort warst.";
  }
  return note;
}

/**
 * Reads a landscape plan among `files` for the site's `epsg`, its surfaces
 * laid on the ground `heightAt` (EPSG x, y → m NHN) has where it lies in
 * the site's coordinates.
 */
export async function readPlan(
  main: File,
  files: readonly File[],
  epsg: number,
  heightAt: (x: number, y: number) => number | null
): Promise<{ root: Object3D; note: string }> {
  let read: Awaited<ReturnType<typeof readFeatures>>;
  try {
    read = await readFeatures(main, files);
  } catch (error) {
    if (error instanceof PlanError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new PlanError(`Der Plan ließ sich nicht lesen (${message}).`);
  }
  if (read.epsg !== null && read.epsg !== epsg && utmZone(read.epsg) === null) {
    throw new PlanError(
      `Der Plan ist in EPSG:${read.epsg}; city walk liest ETRS89/UTM (EPSG:${epsg}). Bitte in EPSG:${epsg} exportieren.`
    );
  }
  let features = read.features;
  if (features.length === 0) {
    throw new PlanError(
      "Im Plan fand sich nichts Darstellbares: keine Schraffuren, Flächen, Bäume oder Geländedreiecke."
    );
  }
  const box = planBox(features);
  const geo = detectGeoreference(
    { min: [box.x0, 0, -box.y1], max: [box.x1, 0, -box.y0] },
    epsg
  );
  const zone = utmZone(epsg) ?? 0;
  if (geo?.zonePrefixed) {
    features = shiftEast(features, zone * 1e6);
  }
  const origin: [number, number] = geo
    ? [Math.round(geo.east), Math.round(geo.north)]
    : [Math.round((box.x0 + box.x1) / 2), Math.round((box.y0 + box.y1) / 2)];
  const mesh = planMesh(features, origin, geo ? heightAt : () => null);
  const root = new Group();
  const counts = new Map<PlanClass | "other", number>();
  for (const f of features) {
    const cls = f.kind === "tree" ? "tree" : (f.cls ?? "other");
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  for (const group of mesh.groups) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(group.positions, 3));
    geometry.computeVertexNormals();
    const [r, g, b] = PLAN_LOOKS[group.cls].srgb;
    const material = new MeshStandardMaterial({
      color: new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace),
      roughness: group.cls === "water" ? 0.35 : 0.9,
    });
    material.name = group.cls;
    // ground: it does not stand in for a house (design-cover.ts)
    material.userData.planGround = group.cls !== "building";
    root.add(new Mesh(geometry, material));
  }
  // the plan's origin in the design frame (x east, z south); doubles
  root.matrixAutoUpdate = false;
  root.matrix.makeTranslation(origin[0], 0, -origin[1]);
  return {
    root,
    note: planNote(counts, read.unclassified, geo !== null, mesh.undraped),
  };
}
