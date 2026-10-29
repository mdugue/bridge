import type { Object3D } from "three/webgpu";
import { DoubleSide, Mesh, MeshStandardNodeMaterial } from "three/webgpu";
import type { DesignTier } from "@/lib/city/design-budget";
import {
  coveredObjects,
  type PlanMask,
  planHull,
  planMask,
} from "@/lib/city/design-cover";
import {
  type DesignPlacement,
  groundBase,
  normalizeRotation,
  type PlacementSource,
  parsePlacementFile,
  placeAhead,
  placementFile,
  standingBase,
  trustedBase,
} from "@/lib/city/design-placement";
import type { RecenterOffset } from "@/lib/city/ground-clamp";
import { DEG2RAD, type PlayerPose } from "@/lib/city/pose";
import { type DesignModel, readDesign } from "./design-read";
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
 * only when a file is loaded; the module ships with the scene (ADR 0051).
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
  placement: DesignPlacement;
  source: PlacementSource;
  /** the LoD2 objects it stands in for */
  hidden: number;
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
  files: MeshStandardNodeMaterial[] | null;
  fileColours: boolean;
  mask: PlanMask | null;
  outline: [number, number][] | null;
  hidden: Map<string, Set<number>>;
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
      placement: { ...current.placement },
      source: current.source,
      hidden,
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
  };

  /** the plan and what it covers, now */
  const replan = () => {
    planTimer = null;
    const loaded = current;
    if (!loaded) {
      return;
    }
    const g = loaded.model.geometry;
    loaded.mask = planMask(
      g.getAttribute("position").array,
      g.getIndex()?.array ?? null,
      loaded.placement
    );
    loaded.outline = loaded.mask ? planHull(loaded.mask) : null;
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

  /** the ground where the player stands: a design over ground not loaded
   *  yet stands at that height, not at 0 m NHN */
  const playerGround = (): number => {
    const p = deps.pose();
    return deps.heightAt(p.epsgX, p.epsgY) ?? 0;
  };

  /** where a design without a placement file lands, and why */
  const firstPlacement = (
    model: DesignModel
  ): { placement: DesignPlacement; source: PlacementSource } => {
    const geo = model.georef;
    if (geo) {
      const at = { east: geo.east, north: geo.north, rotation: 0 };
      const ground = groundBase(at, model.box, deps.heightAt);
      const base = trustedBase(
        geo.base,
        ground === null ? null : standingBase(model.box, ground)
      );
      return {
        placement: { ...at, base: base ?? playerGround() },
        source: base === geo.base ? "file" : "file-plan",
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
      current.placement = parsed.placement;
      current.source = "placement-file";
      moved(true);
    }
    return null;
  };

  return {
    load: async (files) => {
      const load = ++loads;
      const model = await readDesign(files, deps.epsg, deps.tier);
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
        loaded.placement = parsed.placement;
        loaded.source = "placement-file";
        pose(loaded);
      }
      current = loaded;
      deps.reserve(model.bytes);
      deps.parent.add(mesh);
      moved(true);
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
      moved();
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
    setFileColours: async (on) => {
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
      loaded.mesh.material =
        on && loaded.files ? loaded.files : whiteMaterial();
      deps.changed();
      report();
    },
    placementText: () =>
      current
        ? placementFile(current.placement, deps.epsg, current.model.name)
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
    status,
    dispose: () => {
      remove();
    },
  };
}
