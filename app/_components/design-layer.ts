import type { Intersection, Object3D } from "three/webgpu";
import {
  Box3,
  DoubleSide,
  Mesh,
  MeshStandardNodeMaterial,
  Raycaster,
  Vector3,
} from "three/webgpu";
import type { AskHit, AskSet, Xyz } from "@/lib/city/ask-solids";
import type { DesignTier } from "@/lib/city/design-budget";
import {
  coveredObjects,
  designMasks,
  type PlanMask,
  planHull,
  siteFloor,
} from "@/lib/city/design-cover";
import {
  type DesignPlacement,
  type DesignScale,
  designSize,
  elsewhereNote,
  groundBase,
  normalizeRotation,
  type PlacementSource,
  parsePlacementFile,
  placeAhead,
  METRES,
  placementFile,
  scaleBox,
  scaleHint,
  scaleMetres,
  SITE_REACH_M,
  validFactor,
  standingBase,
  trustedBase,
} from "@/lib/city/design-placement";
import type { RecenterOffset } from "@/lib/city/ground-clamp";
import { DEG2RAD, type PlayerPose } from "@/lib/city/pose";
import {
  releaseDesignSite,
  SITE_BYTES,
  SITE_SIDE,
  SITE_UNDER_M,
  setDesignSite,
} from "./design-site";
import {
  type DesignModel,
  type DesignParts,
  partOfVertex,
  readDesign,
} from "./design-read";
import type { DesignInquiry } from "@/lib/city/inquiry-design";
import { releaseRenderState, sceneMaterial } from "./three-utils";

/**
 * A planner's design in the city (ADR 0054, the first stage of the
 * assessment "Entwürfe in city walk"): a glTF read on the device
 * (design-read.ts), placed by what its coordinates say or in front of the
 * player, turned and lifted in the sidebar's *Entwurf* panel, drawn in a
 * model-maker's white or in the file's own colours, casting and taking the
 * sun's shadows, walked against like a building. The LoD2 buildings whose
 * footprints its plan covers step aside (city-layer.ts `setHidden`) and
 * come back when it moves or goes.
 *
 * One design at a time. It lives in the Y-up scene frame under the city's
 * clipping group (Modell's Ausschnitt cuts it with the city) and is built
 * only when a file is loaded; the module ships with the scene (ADR 0040).
 * Its bytes are taken from the tile cache while it is loaded (`reserve`,
 * lib/city/design-budget.ts), so a phone's page holds no more than before.
 */

/** What the panel shows of the loaded design. */
export interface DesignStatus {
  name: string;
  triangles: number;
  /** what it holds (bytes), taken from the tile cache */
  bytes: number;
  texturesDropped: boolean;
  /** what the file said about its place (design-read.ts) */
  note: string | null;
  placement: DesignPlacement;
  source: PlacementSource;
  /** the LoD2 objects it stands in for */
  hidden: number;
  /** the unit its file is read in, times a factor */
  scale: DesignScale;
  /** its size as scaled (m): width, depth, height */
  size: [number, number, number];
  /** its size suggests another unit (`scaleHint`), null where not */
  scaleHint: string | null;
  replaceExisting: boolean;
  fileColours: boolean;
  /** the file carries textures or colours of its own */
  hasLooks: boolean;
}

export interface DesignLayerDeps {
  /** the group it hangs in (the Y-up scene frame) */
  parent: Object3D;
  offset: RecenterOffset;
  epsg: number;
  tier: DesignTier;
  /** the ground's elevation at EPSG (x, y), where a tile has it */
  heightAt: (x: number, y: number) => number | null;
  /** how far (m) EPSG (x, y) lies beyond the site's tiles; 0 on one */
  beyondSite: (x: number, y: number) => number;
  /** caps the walked ground (projected x, y → m NHN, null: not there) */
  capGround: (cap: ((x: number, y: number) => number | null) | null) => void;
  pose: () => PlayerPose;
  /** builds an object's programs before it shows (PostStack.compile) */
  compile: (object: Object3D) => Promise<void>;
  /** every tile's building footprints by object (EPSG rings) */
  footprints: () => ReadonlyMap<string, [number, number][][][]>;
  /** the design came, moved or went: hidden sets, shadows, the map */
  changed: () => void;
  /** the bytes the tile cache leaves to the design (0: none) */
  reserve: (bytes: number) => void;
  /** the panel's status, null without a design */
  report: (status: DesignStatus | null) => void;
}

export interface DesignLayer {
  /** reads the design among `files` (a placement file among them is
   *  applied); rejects with the reason in words */
  load: (files: readonly File[]) => Promise<void>;
  /** applies a placement file; the reason in words when it is refused */
  applyPlacementFile: (text: string) => string | null;
  /** moves, turns or lifts it */
  setPlacement: (patch: Partial<DesignPlacement>) => void;
  /** reads it in another unit, or times a factor, about its foot */
  setScale: (scale: DesignScale) => void;
  /** sets it down in front of the player, on the ground */
  placeHere: () => void;
  /** sets its lowest point on the ground under it */
  setOnGround: () => void;
  /** whether the buildings its plan covers step aside */
  setReplaceExisting: (on: boolean) => void;
  /** the file's colours, or the model-maker's white */
  setFileColours: (on: boolean) => Promise<void>;
  /** the placement as a file to keep beside the design */
  placementText: () => string | null;
  remove: () => void;
  /** the objects of a tile it stands in for */
  hiddenFor: (tile: string) => ReadonlySet<number>;
  /** what it covers asked again (the footprints of a tile came) */
  refresh: () => void;
  /** its plan's outline (EPSG), for the minimap */
  outline: () => [number, number][] | null;
  /** what the collider walks against */
  meshes: () => Mesh[];
  /** what a question meets of it: its parts (lib/city/ask-solids.ts) */
  asks: () => AskSet<DesignInquiry>[];
  /** a part's own triangles in world positions (its outline): none when
   *  another design came since it was asked (`file`) */
  partShape: (file: string, part: number) => Float32Array;
  status: () => DesignStatus | null;
  dispose: () => void;
}

/** How long the plan waits for a drag to end before it is redrawn (ms). */
const PLAN_DELAY_MS = 250;
const NONE: ReadonlySet<number> = new Set();

/** The model-maker's white: one build for the site. Two-sided, in the
 *  shadow pass too: an export's single faces (a canopy, a pergola, a
 *  roof plane) and its mixed winding would otherwise draw or cast only
 *  from one side — at the price of the clay's back-face-only casting. */
function whiteMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("design-white", () => {
    const m = new MeshStandardNodeMaterial({
      color: 0xf4_f1_eb,
      roughness: 0.85,
      metalness: 0,
      side: DoubleSide,
    });
    // the figure of a figure-ground plan, as the clay (paper-scene.ts)
    m.userData.figure = true;
    return m;
  });
}

/** The file's own looks, one material per group. */
function fileMaterials(model: DesignModel): MeshStandardNodeMaterial[] {
  return model.looks.map((look) => {
    const m = new MeshStandardNodeMaterial({
      color: look.color,
      map: look.map,
      roughness: look.roughness,
      metalness: look.metalness,
      opacity: look.opacity,
      transparent: look.transparent,
      alphaTest: look.alphaTest,
      side: DoubleSide,
    });
    m.name = "design-file";
    m.userData.figure = true;
    return m;
  });
}

/** Whether a file carries anything the white would hide. */
function hasLooks(model: DesignModel): boolean {
  return model.looks.some(
    (l) => l.map !== null || l.color.getHex() !== 0xff_ff_ff
  );
}

interface Loaded {
  model: DesignModel;
  mesh: Mesh;
  placement: DesignPlacement;
  source: PlacementSource;
  /** why it is not where its file says (the panel's note in place of
   *  the reader's), null where it is or the file says nothing */
  placeNote: string | null;
  /** the scale its geometry and box are in now (read in metres) */
  scale: DesignScale;
  files: MeshStandardNodeMaterial[] | null;
  fileColours: boolean;
  mask: PlanMask | null;
  outline: [number, number][] | null;
  hidden: Map<string, Set<number>>;
  /** what a question meets of it, made on the first question after a
   *  pose (`askSet`) */
  ask: AskSet<DesignInquiry> | null;
}

/** A part's triangles of the loaded design in world positions. */
function partTriangles(loaded: Loaded, part: number): Float32Array {
  const { geometry } = loaded.mesh;
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index) {
    return new Float32Array();
  }
  // the triangles whose vertices are the part's (the BVH reordered them)
  const mine: number[] = [];
  let first = -1;
  let last = -1;
  let own = false;
  for (let i = 0; i < index.count; i += 3) {
    const v = index.getX(i);
    if (v < first || v >= last) {
      [first, last, own] = partRun(loaded.model.parts, v, part);
    }
    if (own) {
      mine.push(i);
    }
  }
  loaded.mesh.updateWorldMatrix(true, false);
  const out = new Float32Array(mine.length * 9);
  const v = new Vector3();
  let at = 0;
  for (const t of mine) {
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(position, index.getX(t + k)).applyMatrix4(
        loaded.mesh.matrixWorld
      );
      out[at++] = v.x;
      out[at++] = v.y;
      out[at++] = v.z;
    }
  }
  return out;
}

/** The run of vertices `vertex` lies in, and whether it is `part`'s. */
function partRun(
  parts: DesignParts,
  vertex: number,
  part: number
): [number, number, boolean] {
  const { starts, of } = parts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= vertex) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const end = lo + 1 < starts.length ? starts[lo + 1] : Number.MAX_SAFE_INTEGER;
  return [starts[lo] ?? 0, end, of[lo] === part];
}

/** What a question meets of the loaded design: one ask set over its
 *  mesh (its BVH), a hit by the part its triangle belongs to. */
function askSet(loaded: Loaded, offset: RecenterOffset): AskSet<DesignInquiry> {
  const { mesh, model } = loaded;
  mesh.updateWorldMatrix(true, false);
  const box = new Box3().setFromObject(mesh);
  const raycaster = new Raycaster();

  const hitOf = (hit: Intersection): AskHit<DesignInquiry> => {
    const vertex = mesh.geometry.index?.getX((hit.faceIndex ?? 0) * 3) ?? 0;
    const partIndex = partOfVertex(model.parts, vertex);
    return {
      distance: hit.distance,
      solids: [],
      target: {
        kind: "design",
        file: model.name,
        part: model.parts.info[partIndex] ?? {
          name: null,
          type: null,
          id: null,
          material: null,
        },
        partIndex,
        placement: { ...loaded.placement },
        source: loaded.source,
        triangles: model.weight.triangles,
        position: [hit.point.x + offset.cx, offset.cy - hit.point.z],
      },
    };
  };
  const cast = (o: Xyz, d: Xyz, far: number, first: boolean) => {
    raycaster.set(new Vector3(o.x, o.y, o.z), new Vector3(d.x, d.y, d.z));
    raycaster.far = far;
    raycaster.firstHitOnly = first;
    return raycaster.intersectObject(mesh, false);
  };
  return {
    box: { min: box.min, max: box.max },
    nearest: (o, d, far) => {
      const [hit] = cast(o, d, far, true);
      return hit ? hitOf(hit) : null;
    },
    along: (o, d, far) => {
      const seen = new Set<number>();
      const out: AskHit<DesignInquiry>[] = [];
      for (const hit of cast(o, d, far, false)) {
        const found = hitOf(hit);
        if (!seen.has(found.target.partIndex)) {
          seen.add(found.target.partIndex);
          out.push(found);
        }
      }
      return out;
    },
  };
}

export function createDesignLayer(deps: DesignLayerDeps): DesignLayer {
  let current: Loaded | null = null;
  let replaceExisting = true;
  let planTimer: ReturnType<typeof setTimeout> | null = null;
  /** counts loads: a load overtaken by the next is dropped */
  let loads = 0;

  const status = (): DesignStatus | null => {
    if (!current) {
      return null;
    }
    let hidden = 0;
    for (const set of current.hidden.values()) {
      hidden += set.size;
    }
    return {
      name: current.model.name,
      triangles: current.model.weight.triangles,
      bytes: current.model.bytes,
      texturesDropped: current.model.texturesDropped,
      note: current.placeNote ?? current.model.note,
      placement: { ...current.placement },
      source: current.source,
      hidden,
      scale: { ...current.scale },
      size: designSize(current.model.box),
      scaleHint: scaleHint(current.model.box),
      replaceExisting,
      fileColours: current.fileColours,
      hasLooks: hasLooks(current.model),
    };
  };
  const report = () => deps.report(status());

  /** the mesh where the placement says (the Y-up scene frame) */
  const pose = (loaded: Loaded) => {
    const { east, north, base, rotation } = loaded.placement;
    loaded.mesh.position.set(
      east - deps.offset.cx,
      base,
      -(north - deps.offset.cy)
    );
    loaded.mesh.rotation.set(0, -rotation * DEG2RAD, 0);
    loaded.mesh.updateMatrixWorld(true);
    loaded.ask = null;
  };

  /** the plan and what it covers, now */
  const replan = () => {
    planTimer = null;
    const loaded = current;
    if (!loaded) {
      return;
    }
    const g = loaded.model.geometry;
    const masks = designMasks(
      g.getAttribute("position").array,
      g.getIndex()?.array ?? null,
      loaded.placement,
      { maxSide: SITE_SIDE, ground: loaded.model.groundTriangles }
    );
    loaded.mask = masks?.plan ?? null;
    loaded.outline = loaded.mask ? planHull(loaded.mask) : null;
    // the trees, lamps, furniture and the ground's humps under it go
    // with the buildings (design-site.ts), and the walked ground with them
    const site = replaceExisting ? (masks?.site ?? null) : null;
    setDesignSite(site, deps.offset);
    deps.capGround(
      site
        ? (x, y) => {
            const floor = siteFloor(site, x, y);
            return floor === null ? null : floor - SITE_UNDER_M;
          }
        : null
    );
    loaded.hidden = new Map();
    const mask = loaded.mask;
    if (mask && replaceExisting) {
      for (const [tile, polys] of deps.footprints()) {
        const covered = coveredObjects(mask, polys);
        if (covered.size > 0) {
          loaded.hidden.set(tile, covered);
        }
      }
    }
    deps.changed();
    report();
  };
  /** the plan after a drag has settled; the mesh and shadows at once */
  const moved = (now = false) => {
    if (!current) {
      return;
    }
    pose(current);
    if (planTimer !== null) {
      clearTimeout(planTimer);
    }
    if (now) {
      replan();
    } else {
      planTimer = setTimeout(replan, PLAN_DELAY_MS);
      deps.changed();
      report();
    }
  };

  /** its geometry and box in `scale`, about its foot (the geometry is
   *  about its anchor, design-read.ts): one uniform scale of the CPU copy
   *  the plan and the collider read, its BVH refitted, not rebuilt */
  const rescale = (loaded: Loaded, scale: DesignScale) => {
    const f = scaleMetres(scale) / scaleMetres(loaded.scale);
    loaded.scale = { ...scale };
    if (f === 1) {
      return;
    }
    const g = loaded.model.geometry;
    g.scale(f, f, f);
    g.boundsTree?.refit();
    loaded.model.box = scaleBox(loaded.model.box, f);
    loaded.ask = null;
  };

  /** the ground where the player stands: a design over ground not loaded
   *  yet stands at that height, not at 0 m NHN */
  const playerGround = (): number => {
    const p = deps.pose();
    return deps.heightAt(p.epsgX, p.epsgY) ?? 0;
  };

  /** where a design without a placement file lands, and why */
  const firstPlacement = (
    model: DesignModel
  ): {
    placement: DesignPlacement;
    source: PlacementSource;
    placeNote: string | null;
  } => {
    const geo = model.georef;
    const beyond = geo ? deps.beyondSite(geo.east, geo.north) : 0;
    if (geo && beyond <= SITE_REACH_M) {
      const at = { east: geo.east, north: geo.north, rotation: 0 };
      const ground = groundBase(at, model.box, deps.heightAt);
      const base = trustedBase(
        geo.base,
        ground === null ? null : standingBase(model.box, ground)
      );
      return {
        placement: { ...at, base: base ?? playerGround() },
        source: base === geo.base ? "file" : "file-plan",
        placeNote: null,
      };
    }
    const at = placeAhead(deps.pose(), model.box);
    const ground = groundBase(at, model.box, deps.heightAt);
    return {
      placement: {
        ...at,
        base: standingBase(model.box, ground ?? playerGround()),
      },
      source: "here",
      // a place the file gives that no one would see it at
      placeNote: geo
        ? elsewhereNote(beyond)
        : model.elsewhere
          ? elsewhereNote(null)
          : null,
    };
  };

  /** frees a design's drawable, geometry, textures and own materials: the
   *  white is the site's and stays (three keeps a drawable's render state
   *  until its `dispose` event, three-utils.ts) */
  const discard = (
    model: DesignModel,
    mesh: Mesh,
    files: MeshStandardNodeMaterial[] | null
  ) => {
    releaseRenderState(mesh);
    model.geometry.disposeBoundsTree();
    model.geometry.dispose();
    for (const m of files ?? []) {
      m.dispose();
    }
    for (const look of model.looks) {
      look.map?.dispose();
    }
  };

  const remove = () => {
    loads++;
    if (planTimer !== null) {
      clearTimeout(planTimer);
      planTimer = null;
    }
    const loaded = current;
    if (!loaded) {
      return;
    }
    current = null;
    loaded.mesh.removeFromParent();
    discard(loaded.model, loaded.mesh, loaded.files);
    releaseDesignSite();
    deps.capGround(null);
    deps.reserve(0);
    deps.changed();
    report();
  };

  const applyPlacementFile = (text: string): string | null => {
    const parsed = parsePlacementFile(text, deps.epsg);
    if ("error" in parsed) {
      return parsed.error;
    }
    if (current) {
      rescale(current, parsed.scale);
      current.placement = parsed.placement;
      current.source = "placement-file";
      current.placeNote = null;
      moved(true);
    }
    return null;
  };

  const setFileColours = async (on: boolean) => {
    const loaded = current;
    if (!loaded || loaded.fileColours === on) {
      return;
    }
    if (on && !loaded.files) {
      const files = fileMaterials(loaded.model);
      // built off the frames, on a stand-in that shares the geometry
      // (its render state let go after: the pipelines stay cached)
      const standIn = new Mesh(loaded.model.geometry, files);
      await deps.compile(standIn);
      releaseRenderState(standIn);
      if (current !== loaded) {
        for (const m of files) {
          m.dispose();
        }
        return;
      }
      loaded.files = files;
    }
    loaded.fileColours = on;
    loaded.mesh.material = on && loaded.files ? loaded.files : whiteMaterial();
    deps.changed();
    report();
  };

  return {
    load: async (files) => {
      const load = ++loads;
      const model = await readDesign(
        files,
        deps.epsg,
        deps.tier,
        deps.heightAt
      );
      if (load !== loads) {
        model.geometry.dispose();
        for (const look of model.looks) {
          look.map?.dispose();
        }
        return;
      }
      remove();
      loads = load;
      const mesh = new Mesh(model.geometry, whiteMaterial());
      mesh.name = `design:${model.name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // the collider's and the picks' BVH, built once: a design is one
      // mesh, at most DESIGN_LIMITS' triangles
      model.geometry.computeBoundsTree();
      const first = firstPlacement(model);
      const loaded: Loaded = {
        model,
        mesh,
        ...first,
        files: null,
        fileColours: false,
        mask: null,
        outline: null,
        hidden: new Map(),
        ask: null,
        scale: { ...METRES },
      };
      pose(loaded);
      await deps.compile(mesh);
      // a placement file picked with it: read before the design shows, so
      // a refused one still leaves the design placed, planned and reported
      const placementPicked = files.find((f) => /\.json$/i.test(f.name));
      const parsed = placementPicked
        ? parsePlacementFile(await placementPicked.text(), deps.epsg)
        : null;
      if (load !== loads) {
        discard(model, mesh, null);
        return;
      }
      if (parsed && "placement" in parsed) {
        rescale(loaded, parsed.scale);
        loaded.placement = parsed.placement;
        loaded.source = "placement-file";
        loaded.placeNote = null;
        pose(loaded);
      }
      current = loaded;
      // (its site's raster with it: made with the first replan)
      deps.reserve(model.bytes + SITE_BYTES);
      deps.parent.add(mesh);
      moved(true);
      if (model.prefersColours) {
        await setFileColours(true);
      }
      if (parsed && "error" in parsed) {
        throw new Error(parsed.error);
      }
    },
    applyPlacementFile,
    setPlacement: (patch) => {
      if (!current) {
        return;
      }
      const next = { ...current.placement, ...patch };
      next.rotation = normalizeRotation(next.rotation);
      current.placement = next;
      current.source = "manual";
      current.placeNote = null;
      moved();
    },
    setScale: (scale) => {
      if (!current || !validFactor(scale.factor)) {
        return;
      }
      rescale(current, scale);
      moved(true);
    },
    placeHere: () => {
      if (!current) {
        return;
      }
      const box = current.model.box;
      const at = placeAhead(deps.pose(), box);
      const ground = groundBase(at, box, deps.heightAt);
      current.placement = {
        ...at,
        base:
          ground === null ? current.placement.base : standingBase(box, ground),
      };
      current.source = "here";
      current.placeNote = null;
      moved(true);
    },
    setOnGround: () => {
      if (!current) {
        return;
      }
      const box = current.model.box;
      const ground = groundBase(current.placement, box, deps.heightAt);
      if (ground !== null) {
        current.placement = {
          ...current.placement,
          base: standingBase(box, ground),
        };
        current.source = "manual";
        current.placeNote = null;
        moved(true);
      }
    },
    setReplaceExisting: (on) => {
      replaceExisting = on;
      if (current) {
        moved(true);
      } else {
        report();
      }
    },
    setFileColours,
    placementText: () =>
      current
        ? placementFile(
            current.placement,
            deps.epsg,
            current.model.name,
            current.scale
          )
        : null,
    remove,
    hiddenFor: (tile) => current?.hidden.get(tile) ?? NONE,
    refresh: () => {
      if (current) {
        moved();
      }
    },
    outline: () => current?.outline ?? null,
    meshes: () => (current ? [current.mesh] : []),
    asks: () => {
      if (!current) {
        return [];
      }
      current.ask ??= askSet(current, deps.offset);
      return [current.ask];
    },
    partShape: (file, part) =>
      current?.model.name === file
        ? partTriangles(current, part)
        : new Float32Array(),
    status,
    dispose: () => {
      remove();
    },
  };
}
