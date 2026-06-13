import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from "three";

/** Recenter offset + ground lookup shared with the terrain. */
export interface VegetationContext {
  /** optional canopy GeoJSON (points with an "h" height) from DOM1 */
  canopyUrl?: string;
  heightAt: (x: number, y: number) => number | null;
  offset: { cx: number; cy: number };
  signal?: AbortSignal;
}

interface LineFeature {
  geometry: { coordinates: [number, number][]; type: "LineString" };
  properties: { kind: "hedge" | "treerow" };
}

interface PointFeature {
  geometry: { coordinates: [number, number]; type: "Point" };
  properties: { h: number };
}

const TREE_SPACING = 9; // metres between trees along a row
const HEDGE_SPACING = 1.1; // metres between hedge segments
const TRUNK_H = 2.4;
const CROWN_R = 2.1;
const HEDGE_H = 1.3;
const HEDGE_W = 0.9;
/** Approx visual height of an unscaled tree; canopy scale = h / this. */
const BASE_TREE_H = 5.8;

/** Deterministic [0,1) jitter so the layer rebuilds identically. */
function hash(i: number): number {
  const s = Math.sin(i * 12.9898) * 43_758.5453;
  return s - Math.floor(s);
}

/** Walks a polyline emitting points every `spacing` metres (EPSG coords). */
function sampleLine(
  coords: [number, number][],
  spacing: number
): [number, number][] {
  const out: [number, number][] = [];
  // Distance from the current segment's start to the next sample to emit.
  let dist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      continue;
    }
    while (dist < len) {
      const t = dist / len;
      out.push([x0 + dx * t, y0 + dy * t]);
      dist += spacing;
    }
    dist -= len; // carry the remainder into the next segment
  }
  return out;
}

interface Placement {
  rot: number;
  s: number;
  x: number;
  y: number;
  z: number;
}

/** Resamples every line and drops each point onto the terrain (EPSG -> world). */
function collectPlacements(
  features: LineFeature[],
  ctx: VegetationContext
): { hedges: Placement[]; trees: Placement[] } {
  const { cx, cy } = ctx.offset;
  const trees: Placement[] = [];
  const hedges: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const isHedge = f.properties?.kind === "hedge";
    const pts = sampleLine(
      f.geometry.coordinates,
      isHedge ? HEDGE_SPACING : TREE_SPACING
    );
    for (let i = 0; i < pts.length; i++) {
      const [ex, ey] = pts[i];
      const ground = ctx.heightAt(ex, ey);
      if (ground === null) {
        continue; // off-tile or NoData
      }
      const seed = ex * 0.13 + ey * 0.07 + i;
      const place: Placement = {
        x: ex - cx,
        y: ground,
        z: -(ey - cy),
        rot: isHedge ? hash(seed) * 0.3 : hash(seed * 1.7) * Math.PI,
        s: isHedge ? 1 : 0.8 + hash(seed) * 0.6,
      };
      (isHedge ? hedges : trees).push(place);
    }
  }
  return { trees, hedges };
}

function writeInstances(mesh: InstancedMesh, items: Placement[]): void {
  const dummy = new Object3D();
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Without this the cull test uses the (origin-centred) geometry sphere and
  // wrongly culls the whole spread-out instance cloud whenever the world
  // origin is off-screen.
  mesh.computeBoundingSphere();
}

/**
 * Soft poetic tree: a slim trunk and a rounded, smooth-shaded crown in muted
 * sage. The crown is a higher-subdivision sphere so its contour reads as round
 * (matching the soft shading rather than fighting it) and stays opaque — the
 * earlier translucency read as noise. Each crown gets a gentle per-tree colour
 * nudge so a row never reads as a uniform clone stamp. One shared transform
 * drives trunk + crown.
 */
function buildTrees(trees: Placement[]): InstancedMesh[] {
  const trunkGeo = new CylinderGeometry(0.1, 0.16, TRUNK_H, 6);
  trunkGeo.translate(0, TRUNK_H / 2, 0);
  // detail 1 keeps a round-enough contour at a quarter of detail 2's triangles
  // (≈80 vs 320) — a big saving across tens of thousands of canopy trees.
  const crownGeo = new IcosahedronGeometry(CROWN_R, 1);
  crownGeo.scale(1, 1.12, 1);
  crownGeo.translate(0, TRUNK_H + CROWN_R * 0.5, 0);

  const trunks = new InstancedMesh(
    trunkGeo,
    new MeshStandardMaterial({ color: 0x8a_7c_68, roughness: 1 }),
    trees.length
  );
  const crowns = new InstancedMesh(
    crownGeo,
    new MeshStandardMaterial({ color: 0xa6_bf_92, roughness: 1 }),
    trees.length
  );
  trunks.castShadow = true;
  crowns.castShadow = true;
  crowns.receiveShadow = true;
  writeInstances(trunks, trees);
  writeInstances(crowns, trees);

  // Per-tree pastel sage variation (hue + value), deterministic.
  const col = new Color();
  for (let i = 0; i < trees.length; i++) {
    const v = hash(trees[i].x * 0.3 + trees[i].z * 0.7) - 0.5;
    col.setHSL(0.26 + v * 0.05, 0.27, 0.62 + v * 0.12);
    crowns.setColorAt(i, col);
  }
  if (crowns.instanceColor) {
    crowns.instanceColor.needsUpdate = true;
  }
  return [trunks, crowns];
}

function buildHedges(hedges: Placement[]): InstancedMesh {
  const geo = new BoxGeometry(HEDGE_W, HEDGE_H, HEDGE_W * 1.4);
  geo.translate(0, HEDGE_H / 2, 0);
  const mesh = new InstancedMesh(
    geo,
    new MeshStandardMaterial({ color: 0x55_6b_3e, roughness: 1 }),
    hedges.length
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  writeInstances(mesh, hedges);
  return mesh;
}

async function fetchFeatures<T>(
  url: string,
  signal?: AbortSignal
): Promise<T[]> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { features?: T[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}

/** Canopy points (DOM1-derived) → height-scaled tree placements. */
function collectCanopy(
  features: PointFeature[],
  ctx: VegetationContext
): Placement[] {
  const { cx, cy } = ctx.offset;
  const out: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point") {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    const seed = ex * 0.13 + ey * 0.07;
    out.push({
      x: ex - cx,
      y: ground,
      z: -(ey - cy),
      rot: hash(seed * 1.7) * Math.PI,
      // Scale the whole tree to the measured canopy height (± a touch).
      s:
        Math.min(Math.max(f.properties.h / BASE_TREE_H, 0.5), 7) *
        (0.9 + hash(seed) * 0.2),
    });
  }
  return out;
}

/**
 * Builds stylized vegetation from the ATKIS veg04 rows GeoJSON (hedges + tree
 * rows) and, when given, the DOM1-derived canopy GeoJSON (area trees scaled to
 * their measured height). Everything is drawn with InstancedMeshes so tens of
 * thousands of plants stay cheap; each is dropped onto the terrain via
 * `heightAt` and points off the tile are skipped.
 *
 * Non-fatal: any failure resolves to an empty group so the scene still loads.
 */
export async function loadVegetation(
  url: string,
  ctx: VegetationContext
): Promise<Group> {
  const group = new Group();
  group.name = "vegetation";

  const [rowFeatures, canopyFeatures] = await Promise.all([
    fetchFeatures<LineFeature>(url, ctx.signal),
    ctx.canopyUrl
      ? fetchFeatures<PointFeature>(ctx.canopyUrl, ctx.signal)
      : Promise.resolve([]),
  ]);

  const { trees, hedges } = collectPlacements(rowFeatures, ctx);
  trees.push(...collectCanopy(canopyFeatures, ctx));
  if (trees.length > 0) {
    group.add(...buildTrees(trees));
  }
  if (hedges.length > 0) {
    group.add(buildHedges(hedges));
  }
  return group;
}
