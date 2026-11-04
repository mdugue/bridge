/**
 * Step 2 of scripts/prepare-data.ts, the buildings: a tile's CityJSON with
 * its OSM facts, landmarks, scans and street-photo readings baked into the
 * footprints, the glTF and its far twin (bake-entries.ts `city`).
 */
import { existsSync } from "node:fs";
import type { FacadeMaterial, RoofColours } from "../../lib/city/building-tint";
import { withoutTrafficStructures } from "../../lib/city/city-mesh";
import type { OsmBuildingLut, WallMaterial } from "../../lib/city/city-mesh";
import type { LandmarkFile } from "../../lib/city/landmarks";
import type {
  DoorFeature,
  ShopfrontFile,
  PlinthFeature,
  DormerFeature,
  PassageFeature,
  FeatureCollection,
  MeasuredRoofFeature,
  SmallBuildingFeature,
  StructureFeature,
} from "../../lib/city/features";
import { onFormations } from "../../lib/city/track-formation";
import { cityMeshSourceFiles } from "../../lib/city/tile";
import { FAR_CITY_SIMPLIFY } from "../../lib/city/tileset";
import type { CityExtras } from "../../lib/city/tileset";
import type { CityJsonDocument } from "../../lib/city/types";
import type { WindowFile } from "../../lib/city/windows";
import { bakeCityMesh, cityMesh } from "../bake-city-mesh";
import type { BakedCityMesh } from "../bake-city-mesh";
import { BAKE_ENTRIES } from "../bake-entries";
import { simplifyGlb, writeMeshGlb } from "../tile-glb";
import {
  HINT,
  SITE,
  TILES,
  at,
  cacheKey,
  cached,
  fail,
  gz,
  log,
  parse,
  publish,
  readJson,
  utf8,
} from "./context";
import { bedsIn, shapeDigest } from "./lines";
import { landmarkFile } from "./landmarks";
import { sideFiles } from "./side-files";
import { offset, spawnFrame } from "./frame";
import { groundFile, heightOver } from "./ground";

// --- 2. content -----------------------------------------------------------------

/**
 * The OSM facts per object with the tile's landmarks folded in: each of a
 * landmark's objects is marked, and takes the wall material Wikidata names
 * where OSM names none.
 */
function withLandmarks(
  lut: OsmBuildingLut | undefined,
  file: LandmarkFile | undefined
): OsmBuildingLut | undefined {
  if (!file?.landmarks.length) {
    return lut;
  }
  const out: OsmBuildingLut = { ...lut };
  for (const lm of file.landmarks) {
    for (const id of lm.objects) {
      const own = out[id];
      out[id] = {
        ...own,
        landmark: 1,
        wikidata: lm.id,
        material: own?.material ?? (lm.material as WallMaterial | undefined),
        ...(!own?.material && lm.material
          ? { materialFrom: "wikidata" as const }
          : {}),
      };
    }
  }
  return out;
}

function parseCity(
  tile: string,
  groundAt?: (x: number, y: number) => number | null
): BakedCityMesh {
  const src = cityMeshSourceFiles(SITE, tile);
  if (!existsSync(at(src.city))) {
    fail(`missing source file ${src.city}${HINT}`);
  }
  // a top a track runs on, lowered to its bed (lib/city/track-formation.ts)
  // (the bridges' slabs left out first: bakeCityMesh drops them anyway)
  const formed = onFormations(
    withoutTrafficStructures(readJson(at(src.city)) as CityJsonDocument),
    bedsIn(tile)
  );
  if (formed.lowered.length > 0) {
    log(
      `${tile}: ${formed.lowered.length} tops under tracks lowered to their beds`
    );
  }
  const { doc } = formed;
  const lowered = new Set(formed.lowered);
  const roofColours = existsSync(at(src.roofColor))
    ? (readJson(at(src.roofColor)) as RoofColours)
    : undefined;
  const osmDoc = existsSync(at(src.osmBuild))
    ? (readJson(at(src.osmBuild)) as {
        context?: FacadeMaterial;
        objects?: OsmBuildingLut;
      })
    : undefined;
  const osmLut = withLandmarks(osmDoc?.objects, landmarkFile(tile));
  const scan = existsSync(at(src.smallBuild))
    ? (readJson(at(src.smallBuild)) as FeatureCollection<SmallBuildingFeature>)
        .features
    : undefined;
  const gaps = existsSync(at(src.structures))
    ? (readJson(at(src.structures)) as FeatureCollection<StructureFeature>)
        .features
    : undefined;
  const measured = existsSync(at(src.measuredRoofs))
    ? (
        readJson(
          at(src.measuredRoofs)
        ) as FeatureCollection<MeasuredRoofFeature>
      ).features?.filter(
        // a lowered top keeps its new height, not the scan's over it
        (f) => !f.properties || !lowered.has(f.properties.id)
      )
    : undefined;
  const plinths = existsSync(at(src.plinths))
    ? (readJson(at(src.plinths)) as FeatureCollection<PlinthFeature>).features
    : undefined;
  const doors = existsSync(at(src.doors))
    ? (readJson(at(src.doors)) as FeatureCollection<DoorFeature>).features
    : undefined;
  const dormers = existsSync(at(src.dormers))
    ? (readJson(at(src.dormers)) as FeatureCollection<DormerFeature>).features
    : undefined;
  const passages = existsSync(at(src.passages))
    ? (readJson(at(src.passages)) as FeatureCollection<PassageFeature>).features
    : undefined;
  const shopfronts = existsSync(at(src.shopfronts))
    ? Object.values(
        (readJson(at(src.shopfronts)) as ShopfrontFile).buildings
      ).flat()
    : undefined;
  const windows = existsSync(at(src.windows))
    ? Object.values((readJson(at(src.windows)) as WindowFile).buildings).flat()
    : undefined;
  return bakeCityMesh(
    tile,
    doc,
    roofColours,
    tile === TILES[0] ? null : spawnFrame().matrix,
    osmLut,
    scan,
    osmDoc?.context ?? "render",
    gaps,
    measured,
    { doors, dormers, groundAt, passages, plinths, shopfronts, windows }
  );
}

/** A tile's buildings: footprints JSON + glTF, both from one parse. */
export async function bakeCity(
  tile: string
): Promise<{ far: string; file: string; footprints: string; maxZ: number }> {
  const src = cityMeshSourceFiles(SITE, tile);
  // the ground-floor windows clear the tile's fine ground
  const ground = await groundFile(tile);
  const inputs = [
    ground,
    at(src.city),
    at(src.roofColor),
    at(src.osmBuild),
    at(src.smallBuild),
    at(src.structures),
    at(src.landmarks),
    at(src.measuredRoofs),
    at(src.doors),
    at(src.passages),
    at(src.plinths),
    at(src.dormers),
    at(src.shopfronts),
    at(src.windows),
  ];
  const bake = BAKE_ENTRIES.city;
  // the beds reaching into the tile lower the tops the tracks run on
  const key = cacheKey(inputs, bake, offset, shapeDigest(bedsIn(tile)));
  let mesh: ReturnType<typeof cityMesh> | null = null;
  const built = () => {
    if (!mesh) {
      mesh = cityMesh(parseCity(tile, heightOver(tile, ground)));
      // the parse's documents and dressing, gone before the glb is written
      Bun.gc(true);
    }
    return mesh;
  };
  const footprintsFile = `footprints_${tile}.json`;
  const footprints = publish(
    footprintsFile,
    await cached(footprintsFile, key, () => utf8(built().footprints))
  );
  const { maxZ } = parse(
    await cached(`city_${tile}.json`, key, () =>
      utf8({ maxZ: built().maxElevation })
    )
  ) as { maxZ: number };
  const svf = sideFiles.get(tile)?.svf;
  const facades = sideFiles.get(tile)?.facades;
  const extras: CityExtras = {
    kind: "city",
    tileId: tile,
    // The facades' ambient light reads the terrain's sky-view raster.
    ...(svf ? { svf } : {}),
    // ...and their relief and tone what street photos saw of them.
    ...(facades ? { facades } : {}),
  };
  const name = `city_${tile}.glb.gz`;
  const glbKey = cacheKey(
    inputs,
    bake,
    offset,
    shapeDigest(bedsIn(tile)),
    extras
  );
  const glb = await cached(name, glbKey, async () =>
    gz(
      await writeMeshGlb({
        ...built().input,
        name: "city",
        extras: { ...extras },
      })
    )
  );
  // the glb's writer's copies, gone before the far glb is simplified
  if (mesh) {
    Bun.gc(true);
  }
  // the same buildings for far off: every vertex the shape does not need
  // dropped (lib/city/tileset.ts `FAR_CITY_SIMPLIFY`)
  const farName = `city_${tile}_far.glb.gz`;
  const farGlb = await cached(
    farName,
    cacheKey(inputs, bake, glbKey, FAR_CITY_SIMPLIFY),
    async () =>
      gz(
        await simplifyGlb(
          Bun.gunzipSync(glb as Uint8Array<ArrayBuffer>),
          FAR_CITY_SIMPLIFY,
          built().input.table
        )
      )
  );
  // the simplifier's copies, gone before the tile's terrain is written
  if (mesh) {
    Bun.gc(true);
  }
  return {
    far: publish(farName, farGlb),
    file: publish(name, glb),
    footprints,
    maxZ,
  };
}
