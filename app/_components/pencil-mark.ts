import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { Line2 } from "three/addons/lines/webgpu/Line2.js";
import { Group, Line2NodeMaterial } from "three/webgpu";
import type { AskSolid } from "@/lib/city/ask-solids";
import { outlineOf, pencilStroke } from "@/lib/city/pencil";

/**
 * The pencil's loop around an asked thing that has no clay to hatch — a
 * tree, a monument, a bridge (plan 049 phase 4; the stroke itself is
 * lib/city/pencil.ts). A graphite stroke two and a half pixels wide on a
 * band of the card's paper, constant on screen, so it reads from the
 * street and from the air alike, on asphalt and on a lawn; behind a house
 * it is hidden like anything else. Built once per app and compiled
 * with the scene at boot (a stand-in loop until the first question); a
 * question only swaps its geometry. In Papier it draws itself
 * (`paperOwn`): ink on the paper, not a paper wall.
 */
export interface PencilMark {
  dispose: () => void;
  /** the thing to circle, or null to lift the pencil */
  draw: (solids: readonly AskSolid[] | null) => void;
  /** the paper band and the graphite stroke on it */
  line: Group;
}

/** The ink of the clay's pencil hatch (visual-style.ts `askedColour`). */
const GRAPHITE = 0x3d_38_36;
/** The card's paper (globals.css `--paper`): the band the stroke lies on,
 *  so it reads on dark asphalt and dark crowns as on a light square. */
const PAPER = 0xf4_ee_e2;
const WIDTH_PX = 2.5;
const BAND_PX = 5.5;

/** A small loop to compile the line's program with before any question. */
const STAND_IN: AskSolid[] = [
  { cylinder: { x: 0, z: 0, y0: -1000, y1: -999, r: 1 } },
];

function strokeGeometry(solids: readonly AskSolid[]): LineGeometry {
  const geometry = new LineGeometry();
  geometry.setPositions(
    pencilStroke(outlineOf(solids)).flatMap((p) => [p.x, p.y, p.z])
  );
  return geometry;
}

function pencilMaterial(
  color: number,
  linewidth: number,
  /** how much nearer than what it lies on it draws (the ink over its band) */
  lift: number
): Line2NodeMaterial {
  const material = new Line2NodeMaterial({
    color,
    linewidth,
    worldUnits: false,
  });
  // the scene's height fog would pale the mark it is there to show
  material.fog = false;
  // drawn over what it lies on: a loop on the ground or along a parapet
  // shares its depth with it to within the buffer's precision
  material.polygonOffset = true;
  material.polygonOffsetFactor = -4 * lift;
  material.polygonOffsetUnits = -16 * lift;
  material.userData.paperOwn = true;
  return material;
}

export function createPencilMark(): PencilMark {
  const band = new Line2(
    strokeGeometry(STAND_IN),
    pencilMaterial(PAPER, BAND_PX, 1)
  );
  const ink = new Line2(band.geometry, pencilMaterial(GRAPHITE, WIDTH_PX, 2));
  // the band first, the stroke on it, both after the opaque scene
  band.renderOrder = 10;
  ink.renderOrder = 11;
  const line = new Group();
  line.name = "pencil-mark";
  line.add(band, ink);
  line.visible = false;
  const draw = (solids: readonly AskSolid[] | null) => {
    if (solids && solids.length > 0) {
      band.geometry.dispose();
      band.geometry = strokeGeometry(solids);
      ink.geometry = band.geometry;
      line.visible = true;
    } else {
      line.visible = false;
    }
  };
  return {
    line,
    draw,
    dispose: () => {
      band.geometry.dispose();
      band.material.dispose();
      ink.material.dispose();
    },
  };
}
