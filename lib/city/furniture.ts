/**
 * Street furniture placement (pipeline/bake/furniture.py → the layer in
 * app/_components/furniture-layer.ts): which model a feature stands as,
 * where, turned which way and how long. No THREE, no DOM.
 */
import type { FurnitureFeature } from "./features";

/** The models the layer builds, one instanced draw each. */
export type FurnitureModel =
  | "bench"
  | "bin"
  | "bollard"
  | "hoop"
  | "picnic"
  | "postbox"
  | "shelter"
  | "stool";

export const FURNITURE_MODELS: readonly FurnitureModel[] = [
  "bench",
  "stool",
  "picnic",
  "bin",
  "hoop",
  "bollard",
  "postbox",
  "shelter",
];

/** A park bench's length (m) when the map says nothing: the models are built at it. */
export const BENCH_LENGTH = 1.8;
/** Hoops in a bicycle stand row stand this far apart (m). */
export const HOOP_SPACING = 0.9;

/** One model instance: projected position, yaw about world Y, length scale. */
export interface FurniturePiece {
  model: FurnitureModel;
  /** stretch along the model's local X (a bench's mapped length) */
  scaleX: number;
  x: number;
  y: number;
  /** radians about world +Y; the model's front is its local +Z */
  yaw: number;
}

/**
 * A compass bearing (degrees clockwise from north) → the yaw that turns a
 * model's local +Z front to face it. North is world −Z and east +X, so
 * the facing vector is (sin a, 0, −cos a), which rotating +Z by π − a gives.
 */
export function yawOfBearing(deg: number): number {
  return Math.PI - (deg * Math.PI) / 180;
}

/** A stable pseudo-random yaw for things without a front (bins, bollards). */
export function scatterYaw(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453;
  return (s - Math.floor(s)) * Math.PI * 2;
}

function benchModel(f: FurnitureFeature): FurnitureModel {
  return f.properties?.back === false ? "stool" : "bench";
}

/** A stand's hoops, side by side across its front (the row runs along the kerb). */
function hoops(x: number, y: number, deg: number, n: number): FurniturePiece[] {
  const rad = (deg * Math.PI) / 180;
  // The row axis: the facing bearing turned a quarter to the right.
  const ax = Math.cos(rad);
  const ay = -Math.sin(rad);
  const yaw = yawOfBearing(deg);
  const pieces: FurniturePiece[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) / 2) * HOOP_SPACING;
    pieces.push({
      model: "hoop",
      x: x + ax * t,
      y: y + ay * t,
      yaw,
      scaleX: 1,
    });
  }
  return pieces;
}

/** The model each kind stands as (a bench by its backrest). */
const MODEL_OF: Record<string, (f: FurnitureFeature) => FurnitureModel> = {
  bench: benchModel,
  bike: () => "hoop",
  bin: () => "bin",
  bollard: () => "bollard",
  picnic: () => "picnic",
  postbox: () => "postbox",
  shelter: () => "shelter",
};

function modelOf(f: FurnitureFeature): FurnitureModel | null {
  const kind = f.properties?.k;
  return kind && Object.hasOwn(MODEL_OF, kind) ? MODEL_OF[kind](f) : null;
}

/** Every piece the features stand as; unknown kinds and non-points are dropped. */
export function furniturePieces(
  features: FurnitureFeature[]
): FurniturePiece[] {
  const pieces: FurniturePiece[] = [];
  for (const f of features) {
    const model = modelOf(f);
    if (!model || f.geometry?.type !== "Point") {
      continue;
    }
    const [x, y] = f.geometry.coordinates;
    const a = f.properties?.a;
    const faced = typeof a === "number" && Number.isFinite(a);
    if (model === "hoop") {
      const n = Math.max(1, Math.round(f.properties?.n ?? 1));
      pieces.push(...hoops(x, y, faced ? a : 0, n));
      continue;
    }
    const length = f.properties?.l;
    pieces.push({
      model,
      x,
      y,
      yaw: faced ? yawOfBearing(a) : scatterYaw(x, y),
      scaleX:
        model === "bench" || model === "stool"
          ? (length ?? BENCH_LENGTH) / BENCH_LENGTH
          : 1,
    });
  }
  return pieces;
}
