/**
 * Step 2 of scripts/prepare-data.ts, the buildings: a tile's CityJSON with
 * its OSM facts, landmarks, scans and street-photo readings baked into the
 * footprints, the glTF and its far twin (bake-entries.ts `city`).
 */
import { existsSync } from "node:fs";
import type { z } from "zod";
import { parseBakeFile } from "../../lib/city/bake-file";
import type { BakeFile } from "../../lib/city/bake-file";
import { withoutTrafficStructures } from "../../lib/city/city-mesh";
import { DOORS_FILE } from "../../lib/city/doors-file";
import { DORMERS_FILE } from "../../lib/city/dormers-file";
import { packFootprints } from "../../lib/city/footprint-pack";
import { withLandmarks } from "../../lib/city/landmark-lut";
import { MEASURED_ROOFS_FILE } from "../../lib/city/measured-roofs-file";
import { OSM_BUILDINGS_FILE } from "../../lib/city/osm-buildings-file";
import { PASSAGES_FILE } from "../../lib/city/passages-file";
import { PLINTHS_FILE } from "../../lib/city/plinths-file";
import { ROOF_COLOURS_FILE } from "../../lib/city/roof-colours-file";
import { SHOPFRONTS_FILE } from "../../lib/city/shopfronts-file";
import { SMALL_BUILDINGS_FILE } from "../../lib/city/small-buildings-file";
import { STRUCTURES_FILE } from "../../lib/city/structures-file";
import { onFormations } from "../../lib/city/track-formation";
import { withPhotoGlass } from "../../lib/city/photo-glass";
import { WINDOWS_FILE } from "../../lib/city/windows-file";
import { cityMeshSourceFiles } from "../../lib/city/tile";
import { FAR_CITY_SIMPLIFY } from "../../lib/city/tileset";
import type { CityContent, CityFiles } from "../../lib/city/tileset";
import type { CityJsonDocument } from "../../lib/city/types";
import { bakeCityMesh, cityMesh } from "../bake-city-mesh";
import type { BakedCityMesh } from "../city-bake";
import { BAKE_ENTRIES } from "../bake-entries";
import { simplifyGlb, writeMeshGlb } from "../tile-glb";
import type { PropertyTable } from "../tile-glb";
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
import { bakeFigure } from "./figure";
import { offset, spawnFrame } from "./frame";
import { groundFile, heightOver } from "./ground";

// --- 2. content -----------------------------------------------------------------

/** A tile's source file as its schema describes it, or none (ADR 0059). */
function tileSource<S extends z.ZodType>(
  spec: BakeFile<S>,
  file: string
): z.infer<S> | undefined {
  return existsSync(at(file))
    ? parseBakeFile(spec, readJson(at(file)), file)
    : undefined;
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
  const roofColours = tileSource(ROOF_COLOURS_FILE, src.roofColor);
  const osmDoc = tileSource(OSM_BUILDINGS_FILE, src.osmBuild);
  const osmLut = withLandmarks(osmDoc?.objects, landmarkFile(tile));
  const scan = tileSource(SMALL_BUILDINGS_FILE, src.smallBuild)?.features;
  const gaps = tileSource(STRUCTURES_FILE, src.structures)?.features;
  // a lowered top keeps its new height, not the scan's over it
  const measured = tileSource(
    MEASURED_ROOFS_FILE,
    src.measuredRoofs
  )?.features.filter((f) => !lowered.has(f.properties.id));
  const plinths = tileSource(PLINTHS_FILE, src.plinths)?.features;
  const doors = tileSource(DOORS_FILE, src.doors)?.features;
  const dormers = tileSource(DORMERS_FILE, src.dormers)?.features;
  const passages = tileSource(PASSAGES_FILE, src.passages)?.features;
  const shopfrontFile = tileSource(SHOPFRONTS_FILE, src.shopfronts);
  const shopfronts = shopfrontFile
    ? Object.values(shopfrontFile.buildings).flat()
    : undefined;
  const windowFile = tileSource(WINDOWS_FILE, src.windows);
  const windows = windowFile
    ? Object.values(windowFile.buildings).flat()
    : undefined;
  // the walls the street photos read as glass, where no source names one
  const lut = withPhotoGlass(osmLut, windowFile);
  return bakeCityMesh(
    tile,
    doc,
    roofColours,
    tile === TILES[0] ? null : spawnFrame().matrix,
    lut,
    scan,
    osmDoc?.context ?? "render",
    gaps,
    measured,
    { doors, dormers, groundAt, passages, plinths, shopfronts, windows }
  );
}

/** A tile's buildings: packed footprints + glTF, both from one parse. */
export async function bakeCity(tile: string): Promise<{
  far: string;
  file: string;
  files: CityFiles;
  figure: string;
  footprints: string;
  maxZ: number;
}> {
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
  // the mesh's table, kept for the far glb when the writer has the mesh
  let table: PropertyTable | undefined;
  const built = () => {
    if (!mesh) {
      mesh = cityMesh(parseCity(tile, heightOver(tile, ground)));
      // the parse's documents and dressing, gone before the glb is written
      Bun.gc(true);
    }
    return mesh;
  };
  // Packed, not JSON (lib/city/footprint-pack.ts): the minimap read 11 MB
  // of it at every start. Pre-gzipped like the glTF (static hosts do not
  // compress binary types).
  const footprintsFile = `footprints_${tile}.fpr.gz`;
  const packed = await cached(footprintsFile, key, () =>
    gz(packFootprints(built().footprints))
  );
  const footprints = publish(footprintsFile, packed);
  // what the minimap draws of them (scripts/prepare/figure.ts)
  const figure = await bakeFigure(tile, packed);
  const { maxZ } = parse(
    await cached(`city_${tile}.json`, key, () =>
      utf8({ maxZ: built().maxElevation })
    )
  ) as { maxZ: number };
  // The side files the buildings are dressed with are named on their
  // tiles in the tileset (lib/city/tileset.ts `CityFiles`), not in the
  // glb: a sky-view raster or a facade reading that changes re-bakes no
  // building. The facades' ambient light reads the terrain's sky-view
  // raster, their relief and tone what street photos saw of them.
  const svf = sideFiles.get(tile)?.svf;
  const facades = sideFiles.get(tile)?.facades;
  const files: CityFiles = {
    ...(svf ? { svf } : {}),
    ...(facades ? { facades } : {}),
  };
  const extras: CityContent = { kind: "city", tileId: tile };
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
        // nothing reads the mesh after it: the far glb is made of the glb
        owned: true,
      })
    )
  );
  // the mesh and its writer's copies, gone before the far glb is
  // simplified: only its table goes back on that one
  if (mesh) {
    ({ table } = (mesh as ReturnType<typeof cityMesh>).input);
    mesh = null;
    Bun.gc(true);
  }
  const parsed = table !== undefined;
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
          table ?? built().input.table
        )
      )
  );
  // the simplifier's copies, gone before the tile's terrain is written
  if (mesh || parsed) {
    mesh = null;
    Bun.gc(true);
  }
  return {
    far: publish(farName, farGlb),
    file: publish(name, glb),
    files,
    figure,
    footprints,
    maxZ,
  };
}
