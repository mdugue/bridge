/**
 * The vertical profile a line is laid on — its *Gradiente* — fitted to the
 * levels it runs on (lib/city/levels.ts) under the two limits a track's
 * geometry obeys. DOM-free, THREE-free, pure.
 *
 * The levels say on what a line runs (the ground, a deck, a span, a cut);
 * on the ground they took the DGM sample by sample, so a track drew every
 * bump of the measured ground: the 1 m DGM rounds a platform's edge, a
 * kerb or an abutment into a ramp the track beside it climbed, and the
 * ground between two samples rose over the rails. A track cannot do that.
 * Its profile is straight grades joined by vertical curves:
 *
 * - **the grade** (rise over run) stays within the line's steepest
 *   (`LEVEL_GRADE`: a main line ~4 % at most, a tram 8 %);
 * - **a change of grade is rounded** by a vertical curve of at least
 *   `PROFILE_RADIUS` — the EBO's 2 000 m for the railway (Ril 800.0110:
 *   r_a ≥ 0.4·v², 2 000 m at the least on main lines), the BOStrab
 *   alignment rules' 500 m for a tram's sag — so the grade changes by at
 *   most run/R between two samples.
 *
 * Within those limits the profile stays as close to the levels as it can
 * (least squares, robust: a bump of the DGM a few metres long pulls it
 * by little), and on a deck it is the deck's top: the deck is measured,
 * the approaches meet it. What the profile leaves of the ground is the
 * terrain bake's to reshape (lib/city/track-beds.ts): the ground under the
 * bed is laid at the profile, the sides slope to the measured ground —
 * the embankment and the cutting a real line has.
 */
import { type Level, LEVEL_GRADE, type LevelLine } from "./levels";

/** The smallest vertical curve a line's grade changes on (m). */
export const PROFILE_RADIUS: Readonly<Record<LevelLine, number>> = {
  rail: 2000,
  tram: 500,
};

/** Huber's knee (m): a sample further than this off the profile weighs
 *  less, as one off by its distance — a DGM bump, not the line's ground. */
const ROBUST_M = 0.1;
/** A deck sample's weight against a ground sample's: the deck's top is
 *  where the line runs. */
const DECK_WEIGHT = 1e4;
/** Reweighting rounds (robust fit) and ADMM iterations per round. */
const ROUNDS = 5;
const ITERATIONS = 300;
/** ADMM's penalty (the constraints and the fit are both in metres). */
const RHO = 100;

export interface ProfileOptions {
  grade: number;
  radius: number;
}

/** The options of a line kind. */
export function profileOptions(line: LevelLine): ProfileOptions {
  return { grade: LEVEL_GRADE[line], radius: PROFILE_RADIUS[line] };
}

/** A symmetric pentadiagonal matrix's banded Cholesky factor: L with
 *  two subdiagonals (L[i][i] = l0[i], L[i][i-1] = l1[i], L[i][i-2] =
 *  l2[i]). */
interface PentaFactor {
  l0: Float64Array;
  l1: Float64Array;
  l2: Float64Array;
}

/** Factors the matrix with diagonal `diag` and off-diagonals `off1`,
 *  `off2` (once per set of weights: the solves reuse it). */
function factorPenta(
  diag: Float64Array,
  off1: Float64Array,
  off2: Float64Array
): PentaFactor {
  const n = diag.length;
  const l0 = new Float64Array(n);
  const l1 = new Float64Array(n);
  const l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a2 = i >= 2 ? off2[i - 2] / l0[i - 2] : 0;
    const a1 =
      i >= 1 ? (off1[i - 1] - (i >= 2 ? a2 * l1[i - 1] : 0)) / l0[i - 1] : 0;
    l2[i] = a2;
    l1[i] = a1;
    const d = diag[i] - a1 * a1 - a2 * a2;
    l0[i] = Math.sqrt(Math.max(d, 1e-12));
  }
  return { l0, l1, l2 };
}

/** Solves L Lᵀ x = b for a factor of `factorPenta`. */
function solvePenta(f: PentaFactor, b: Float64Array): Float64Array {
  const { l0, l1, l2 } = f;
  const n = l0.length;
  // forward: L y = b
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    if (i >= 1) {
      s -= l1[i] * y[i - 1];
    }
    if (i >= 2) {
      s -= l2[i] * y[i - 2];
    }
    y[i] = s / l0[i];
  }
  // backward: Lᵀ x = y
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    if (i + 1 < n) {
      s -= l1[i + 1] * x[i + 1];
    }
    if (i + 2 < n) {
      s -= l2[i + 2] * x[i + 2];
    }
    x[i] = s / l0[i];
  }
  return x;
}

/**
 * The constraint rows of a run with distances `d`: each grade (z_{i+1} −
 * z_i, bound grade·run) and each change of grade, in metres (the slope's
 * change times the mean run, bound run²/R). Row k of the second kind
 * reads z_{k}, z_{k+1}, z_{k+2}.
 */
interface Rows {
  /** grade rows: bound per row */
  g: Float64Array;
  /** curvature rows: coefficients of z_k, z_{k+1}, z_{k+2}, bound */
  c0: Float64Array;
  c1: Float64Array;
  c2: Float64Array;
  k: Float64Array;
}

function rowsOf(d: readonly number[], opts: ProfileOptions): Rows {
  const n = d.length;
  const g = new Float64Array(Math.max(n - 1, 0));
  for (let i = 0; i < n - 1; i++) {
    g[i] = opts.grade * Math.max(d[i + 1] - d[i], 1e-6);
  }
  const m = Math.max(n - 2, 0);
  const c0 = new Float64Array(m);
  const c1 = new Float64Array(m);
  const c2 = new Float64Array(m);
  const k = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const h0 = Math.max(d[i + 1] - d[i], 1e-6);
    const h1 = Math.max(d[i + 2] - d[i + 1], 1e-6);
    const h = (h0 + h1) / 2;
    // h·((z2 − z1)/h1 − (z1 − z0)/h0)
    c0[i] = h / h0;
    c1[i] = -h / h0 - h / h1;
    c2[i] = h / h1;
    k[i] = (h * h) / opts.radius;
  }
  return { g, c0, c1, c2, k };
}

/** ρ·AᵀA added onto the diagonal bands (A: the grade and curvature rows). */
function normalBands(n: number, rows: Rows, w: Float64Array) {
  const diag = Float64Array.from(w);
  const off1 = new Float64Array(Math.max(n - 1, 0));
  const off2 = new Float64Array(Math.max(n - 2, 0));
  for (let i = 0; i < n - 1; i++) {
    diag[i] += RHO;
    diag[i + 1] += RHO;
    off1[i] -= RHO;
  }
  const { c0, c1, c2 } = rows;
  for (let i = 0; i < c0.length; i++) {
    diag[i] += RHO * c0[i] * c0[i];
    diag[i + 1] += RHO * c1[i] * c1[i];
    diag[i + 2] += RHO * c2[i] * c2[i];
    off1[i] += RHO * c0[i] * c1[i];
    off1[i + 1] += RHO * c1[i] * c2[i];
    off2[i] += RHO * c0[i] * c2[i];
  }
  return { diag, off1, off2 };
}

const clamp = (v: number, b: number) => (v > b ? b : v < -b ? -b : v);

/**
 * The profile of one run of known levels: the closest heights to `t`
 * (weights `base`) whose grades and changes of grade keep within `rows`
 * — ADMM over the constraint rows, the robust weights refreshed between
 * rounds.
 */
function fitRun(
  t: readonly number[],
  base: readonly number[],
  d: readonly number[],
  opts: ProfileOptions
): number[] {
  const n = t.length;
  if (n < 3) {
    return [...t];
  }
  const rows = rowsOf(d, opts);
  const ng = n - 1;
  const nc = n - 2;
  // scaled duals and split variables of both row kinds
  const ug = new Float64Array(ng);
  const yg = new Float64Array(ng);
  const uc = new Float64Array(nc);
  const yc = new Float64Array(nc);
  let z: Float64Array<ArrayBufferLike> = Float64Array.from(t);
  const w = Float64Array.from(base);
  const rhs = new Float64Array(n);
  for (let round = 0; round < ROUNDS; round++) {
    const { diag, off1, off2 } = normalBands(n, rows, w);
    const factor = factorPenta(diag, off1, off2);
    for (let it = 0; it < ITERATIONS; it++) {
      // z: (W + ρAᵀA) z = W t + ρ Aᵀ (u − y)
      for (let i = 0; i < n; i++) {
        rhs[i] = w[i] * t[i];
      }
      for (let i = 0; i < ng; i++) {
        const v = RHO * (ug[i] - yg[i]);
        rhs[i + 1] += v;
        rhs[i] -= v;
      }
      for (let i = 0; i < nc; i++) {
        const v = RHO * (uc[i] - yc[i]);
        rhs[i] += rows.c0[i] * v;
        rhs[i + 1] += rows.c1[i] * v;
        rhs[i + 2] += rows.c2[i] * v;
      }
      z = solvePenta(factor, rhs);
      // u: the rows' values clamped to their bounds; y: the residual
      let worst = 0;
      for (let i = 0; i < ng; i++) {
        const a = z[i + 1] - z[i];
        const u = clamp(a + yg[i], rows.g[i]);
        yg[i] += a - u;
        worst = Math.max(worst, Math.abs(a - u), Math.abs(u - ug[i]));
        ug[i] = u;
      }
      for (let i = 0; i < nc; i++) {
        const a =
          rows.c0[i] * z[i] + rows.c1[i] * z[i + 1] + rows.c2[i] * z[i + 2];
        const u = clamp(a + yc[i], rows.k[i]);
        yc[i] += a - u;
        worst = Math.max(worst, Math.abs(a - u), Math.abs(u - uc[i]));
        uc[i] = u;
      }

      if (worst < 1e-4) {
        break;
      }
    }
    // Huber: a sample far off the profile counts as one off by its distance
    for (let i = 0; i < n; i++) {
      const r = Math.abs(z[i] - t[i]);
      w[i] = r > ROBUST_M ? (base[i] * ROBUST_M) / r : base[i];
    }
  }
  return Array.from(z);
}

/**
 * The profile of a line: per sample the height its rails' bed lies at
 * (the level's surface — the ballast's, a deck's top), null where the
 * level is (the line breaks there). `d` is each sample's distance along
 * the line. On a deck the profile keeps the deck's top; elsewhere it is
 * the fit within the line's grade and vertical curve.
 */
export function lineProfile(
  levels: readonly (Level | null)[],
  d: readonly number[],
  opts: ProfileOptions
): (number | null)[] {
  const out: (number | null)[] = levels.map(() => null);
  let first = -1;
  for (let i = 0; i <= levels.length; i++) {
    if (i < levels.length && levels[i]) {
      if (first < 0) {
        first = i;
      }
      continue;
    }
    if (first >= 0) {
      const idx = Array.from({ length: i - first }, (_, k) => first + k);
      const fit = fitRun(
        idx.map((j) => (levels[j] as Level).y),
        idx.map((j) =>
          (levels[j] as Level).mode === "deck" ? DECK_WEIGHT : 1
        ),
        idx.map((j) => d[j]),
        opts
      );
      idx.forEach((j, k) => {
        out[j] = fit[k];
      });
      first = -1;
    }
  }
  return out;
}

/**
 * A profile as the line's feature carries it (`lz`): centimetres, the
 * first absolute and every further one as the step from the one before;
 * a null (no level) is written as a step of null, and the next number
 * after it is absolute again.
 */
export function encodeProfile(
  z: readonly (number | null)[]
): (number | null)[] {
  const out: (number | null)[] = [];
  let last: number | null = null;
  for (const v of z) {
    if (v === null) {
      out.push(null);
      last = null;
      continue;
    }
    const cm = Math.round(v * 100);
    out.push(last === null ? cm : cm - last);
    last = cm;
  }
  return out;
}

/** `encodeProfile` read back (m). */
export function decodeProfile(
  lz: readonly (number | null)[]
): (number | null)[] {
  const out: (number | null)[] = [];
  let last: number | null = null;
  for (const v of lz) {
    if (v === null) {
      out.push(null);
      last = null;
      continue;
    }
    const cm: number = last === null ? v : last + v;
    out.push(cm / 100);
    last = cm;
  }
  return out;
}
