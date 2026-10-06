import {
  BufferAttribute,
  BufferGeometry,
  ClippingGroup,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
  type Object3D,
  Plane,
  Vector3,
} from "three/webgpu";
import type { ModelView } from "@/lib/city/model-view";
import {
  type CutOut,
  cutOutCorners,
  cutOutPlanes,
  groundStrip,
  joinStrips,
  sectionLine,
  type StripMesh,
} from "@/lib/city/section";

/**
 * Modell's cuts (plan 055 phases 3–4, ADR 0044), the scene half:
 *
 * - **The Geländeschnitt.** In a Schnitt the near plane cuts through the
 *   pivot; the buildings it cuts show their poché (the clay's back faces,
 *   visual-style.ts `setClaySection`), and the ground — a surface, with no
 *   inside to fill — gets a strip from its height down below the picture
 *   along the cut line, filled like the poché.
 * - **The Ausschnitt.** A rectangle on the ground outside of which nothing
 *   is drawn: the city's group sits in a `ClippingGroup` (public in three
 *   r186) whose four planes are the rectangle's sides — off, it costs
 *   nothing (a disabled group is no clipping context). Along its edges a
 *   plinth: four strips from the ground down to a common base, the look of
 *   a model cut from the city. Switching the group switches the build of
 *   every drawable under it, so a new cut shows only once `reveal` says
 *   its programs are built (post-stack.ts `holdCut`).
 *
 * Both strips are drawn in the poché's colour by every style (their
 * material papers itself, `userData.paperOwn`, so the paper swaps leave it
 * and the Schwarzplan keeps it).
 */

/** The poché: a warm near-black, as a drawn section's fill. */
const POCHE = new Color(0x2b_2a_2e);
/** m between the strip's samples, at least, and per CSS pixel. */
const STEP_MIN_M = 0.5;
const STEP_PX = 3;
/** m the plinth reaches below the lowest ground along its edges. */
const PLINTH_DEPTH_M = 12;

function pocheMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    color: POCHE,
    side: DoubleSide,
    // the strip is the cut's own fill, not something in the haze
    fog: false,
  });
  material.userData.paperOwn = true;
  return material;
}

function stripGeometry(strip: StripMesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(strip.positions, 3));
  geometry.setIndex(new BufferAttribute(strip.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** One strip mesh whose geometry is rebuilt as its key changes. */
function stripMesh(name: string): {
  mesh: Mesh;
  set: (key: string, build: () => StripMesh) => void;
  hide: () => void;
  dispose: () => void;
} {
  // Never without a position: a compile ahead of the first cut (the
  // styles' warm-up walks the scene) would build the material without it.
  const mesh = new Mesh(
    stripGeometry({
      positions: new Float32Array(9),
      index: new Uint32Array([0, 1, 2]),
    }),
    pocheMaterial()
  );
  mesh.name = name;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  let key = "";
  return {
    mesh,
    set: (next, build) => {
      mesh.visible = true;
      if (next === key) {
        return;
      }
      key = next;
      mesh.geometry.dispose();
      mesh.geometry = stripGeometry(build());
    },
    hide: () => {
      mesh.visible = false;
    },
    dispose: () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

export interface ModelCuts {
  /** the group the city goes into (the Ausschnitt's clipping) */
  group: ClippingGroup;
  /** the strips, for the scene root (outside the clipping) */
  objects: Object3D[];
  /**
   * Per frame in a Schnitt: the ground profile along the cut. `ground`
   * counts the terrain's changes (a strip is rebuilt when it moves on).
   */
  showSection: (
    view: ModelView,
    halfWidth: number,
    heightAt: (x: number, z: number) => number | null,
    ground: number
  ) => void;
  hideSection: () => void;
  /**
   * Sets (or, with null, lifts) the Ausschnitt. A new one shows once
   * `reveal` is called — when its programs are built (post-stack.ts
   * `holdCut`); one that shows stays shown as it moves or the ground
   * changes.
   */
  setCutOut: (
    cut: CutOut | null,
    heightAt: (x: number, z: number) => number | null,
    ground: number
  ) => void;
  /** Shows the Ausschnitt that is set: the clipping and the plinth. */
  reveal: () => void;
  cutOut: () => CutOut | null;
  /** an Ausschnitt is set and shows */
  revealed: () => boolean;
  dispose: () => void;
}

export function createModelCuts(): ModelCuts {
  const group = new ClippingGroup();
  group.name = "model-cut-out";
  group.enabled = false;
  // The shadow pass draws the whole city: clipped, every caster's shadow
  // program would be built anew inside the frame that shows the cut, and
  // again in the one that lifts it (no compile ahead reaches the shadow
  // pass) — the stall the Ausschnitt was known for. So a building outside
  // still casts its shadow over the cut's edge.
  group.clipShadows = false;
  const profile = stripMesh("model-section-profile");
  const plinth = stripMesh("model-plinth");
  let cut: CutOut | null = null;
  let shown = false;
  return {
    group,
    objects: [profile.mesh, plinth.mesh],
    showSection: (view, halfWidth, heightAt, ground) => {
      const step = Math.max(view.metresPerPixel * STEP_PX, STEP_MIN_M);
      const key = [
        view.pivot.x,
        view.pivot.z,
        view.turnDeg,
        view.metresPerPixel,
        ground,
      ]
        .map((v) => v.toFixed(2))
        .join("|");
      profile.set(key, () => {
        const { from, to } = sectionLine(view, halfWidth);
        // below the picture's bottom edge (the pivot sits at its lower third)
        const base = view.pivot.y - halfWidth;
        return groundStrip(from, to, step, heightAt, base);
      });
    },
    hideSection: profile.hide,
    setCutOut: (next, heightAt, ground) => {
      cut = next;
      if (!next) {
        shown = false;
        group.enabled = false;
        group.clippingPlanes = [];
        plinth.hide();
        return;
      }
      // the same four planes, moved: a count that changed would change the
      // clipping's key, and every build under it
      const planes = cutOutPlanes(next);
      if (group.clippingPlanes.length !== planes.length) {
        group.clippingPlanes = planes.map(() => new Plane());
      }
      planes.forEach((p, i) =>
        group.clippingPlanes[i].set(
          new Vector3(p.normal.x, p.normal.y, p.normal.z),
          p.constant
        )
      );
      group.enabled = shown;
      const corners = cutOutCorners(next);
      const step = Math.max(
        Math.max(next.halfRight, next.halfAhead) / 400,
        STEP_MIN_M
      );
      let low = Number.POSITIVE_INFINITY;
      for (const c of corners) {
        low = Math.min(low, heightAt(c.x, c.z) ?? low);
      }
      const base = (Number.isFinite(low) ? low : 0) - PLINTH_DEPTH_M;
      plinth.set(`${JSON.stringify(next)}|${ground}`, () =>
        joinStrips(
          corners.map((c, i) =>
            groundStrip(c, corners[(i + 1) % 4], step, heightAt, base)
          )
        )
      );
      plinth.mesh.visible = shown;
    },
    reveal: () => {
      if (!cut) {
        return;
      }
      shown = true;
      group.enabled = true;
      plinth.mesh.visible = true;
    },
    cutOut: () => cut,
    revealed: () => shown,
    dispose: () => {
      profile.dispose();
      plinth.dispose();
    },
  };
}
