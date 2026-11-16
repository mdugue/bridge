/**
 * The maths a bake may call (`import * as PMath`, so that a bundle keeps
 * only what it calls): the functions of `Math` that a
 * JavaScript engine hands to the machine's C library, written here in the
 * operations IEEE 754 fixes to the last bit (+, −, ×, ÷, the square root,
 * floor), so that a bake's bytes are a function of the tree and not of
 * the machine. Bun's `Math.hypot`, `sin`, `cos`, `tan`, `atan`, `atan2`,
 * `acos`, `asin`, `exp`, `log`, `pow`, `cbrt` and the hyperbolic ones are
 * glibc's: `hypot` gave other last bits under glibc 2.43 than under 2.39,
 * and the others differ between a processor glibc gives its FMA variants
 * and one it does not. A building whose corner test or weld read such a
 * value came out a vertex richer on one machine (plan 087's finding).
 *
 * The kernels and constants are fdlibm's (Sun's, as V8 ports it); each
 * function is within a few units in the last place of the true value
 * (`pow` to a non-integer power within about |y · ln x| of them: thirty
 * for an sRGB curve near black) — less tight than a C library's, and far
 * below anything a bake quantises to. What must hold is that they give
 * the same bits everywhere: portable-math.test.ts pins them.
 *
 * The contract's edges. `sin`, `cos` and `tan` hold that accuracy up to
 * 5e8; from there to 2^50 (about 1e15) an angle is folded by 2π in two
 * parts and the result is good to about 1e−15 absolute, not to the last
 * place — a hash's seed times its constant (an OSM id × 12.9898 ≈ 2e10)
 * lands here, and a hash wants the same bits everywhere, not accuracy;
 * past 2^50 they are NaN, where `Math`'s still answer. Outside the
 * contract, and not what `Math` gives: a whole power above 1000 or below
 * −1000 (computed as exp(y · log x): `pow(2, 1024)` is finite), a
 * non-integer power of an exact root (`pow(1000, 1 / 3)` is not 10; the
 * square root is exact), `hypot` of values whose squares overflow or
 * underflow, and subnormal results anywhere.
 *
 * Every module in a bake's cache key uses these, never `Math`'s
 * (bake-entries.test.ts). `Math.sqrt`, `abs`, `floor`, `ceil`, `round`,
 * `trunc`, `min`, `max`, `sign`, `fround` and `imul` are exact and stay.
 * No DOM, no three.
 */

const words = new Float64Array(1);
const halves = new Uint32Array(words.buffer);
// typed arrays are in the machine's byte order: where the high word lies
const HI = new Uint8Array(new Float64Array([1]).buffer)[7] === 0x3f ? 1 : 0;
const LO = 1 - HI;

const highWord = (x: number): number => {
  words[0] = x;
  return halves[HI];
};

/** 2^k for a whole k in [−1022, 1023]. */
function pow2(k: number): number {
  halves[HI] = (k + 1023) << 20;
  halves[LO] = 0;
  return words[0];
}

const TWO_M26 = pow2(-26);
const TWO_M28 = pow2(-28);
const TWO_M29 = pow2(-29);
const TWO_M60 = pow2(-60);
const TWO_M1022 = pow2(-1022);

/** x · 2^k. */
function scale(x: number, k: number): number {
  if (k > 1023) {
    return x * pow2(1023) * pow2(Math.min(k - 1023, 1023));
  }
  if (k < -1022) {
    return x * pow2(-1022) * pow2(Math.max(k + 1022, -1022));
  }
  return x * pow2(k);
}

/** √(x² + y² (+ z² …)): the sum as written, one square root. Not guarded
 *  against overflow (a bake's lengths are metres). */
function hypot(...values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v * v;
  }
  if (Number.isNaN(sum) && values.some((v) => Math.abs(v) === Infinity)) {
    // an infinite side outweighs a NaN one, as in `Math.hypot`
    return Number.POSITIVE_INFINITY;
  }
  return Math.sqrt(sum);
}

// --- sine and cosine ----------------------------------------------------------

const INV_PIO2 = 6.36619772367581382433e-1;
/** π/2 in parts: the first 33 bits, the next 33, and what is left. */
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const TWO_PI = 6.283185307179586;
/** 2π less that double. */
const TWO_PI_LO = 2.4492935982947064e-16;
/** Up to here n · PIO2_1 is exact. */
const REDUCE_MAX = 500_000;

/** x = n · π/2 + r + tail, |r| ≤ π/4: `quadrant` holds n modulo 4. */
const reduced = { quadrant: 0, r: 0, tail: 0 };

/** The largest angle `sin`, `cos` and `tan` answer (2^50): past it the
 *  turns taken are no longer counted to the last one. */
const ANGLE_LIMIT = 1_125_899_906_842_624;

/** A large angle less its whole turns: the remainder by 2π as a double
 *  (exact), then what that double lacks of 2π for every turn taken. Good
 *  to about 1e−15 absolute up to ANGLE_LIMIT, NaN past it: what reaches
 *  here is a hash's seed times its constant, which wants the same bits on
 *  every machine and no more. */
function folded(x: number): number {
  if (Math.abs(x) > ANGLE_LIMIT) {
    return Number.NaN;
  }
  const r = x % TWO_PI;
  const turns = Math.round((x - r) / TWO_PI);
  return r - turns * TWO_PI_LO;
}

/** π/2 in 24-bit parts and what is left: n times a part is exact for a
 *  whole n below 2^29. */
const PIO2_A = 1.570796251296997;
const PIO2_B = 7.549789415861596e-8;
const PIO2_C = 5.390302529957765e-15;
const PIO2_D = 3.2820035428735005e-22;
/** Up to here n · PIO2_A is exact. */
const REDUCE_WIDE = 500_000_000;

/** `reduce` for an angle up to REDUCE_WIDE (a hash's seed times its
 *  constant): the same steps in smaller parts, without the remainder a
 *  larger one takes. */
function reduceWide(x: number): void {
  const n = Math.floor(x * INV_PIO2 + 0.5);
  const t = x - n * PIO2_A - n * PIO2_B;
  let w = n * PIO2_C;
  const r = t - w;
  w = n * PIO2_D - (t - r - w);
  reduced.r = r - w;
  reduced.tail = r - reduced.r - w;
  reduced.quadrant = ((n % 4) + 4) % 4;
}

function reduce(value: number): void {
  const size = Math.abs(value);
  if (size > REDUCE_MAX && size <= REDUCE_WIDE) {
    reduceWide(value);
    return;
  }
  const x = size > REDUCE_MAX ? folded(value) : value;
  const n = Math.floor(x * INV_PIO2 + 0.5);
  const t = x - n * PIO2_1;
  let w = n * PIO2_2;
  const r = t - w;
  w = n * PIO2_2T - (t - r - w);
  reduced.r = r - w;
  reduced.tail = r - reduced.r - w;
  reduced.quadrant = ((n % 4) + 4) % 4;
}

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

/** sin(x + y) for |x| ≤ π/4, y the tail of x. */
function kernelSin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** cos(x + y) for |x| ≤ π/4, y the tail of x. */
function kernelCos(x: number, y: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const ax = Math.abs(x);
  if (ax < 0.3) {
    return 1 - (0.5 * z - (z * r - x * y));
  }
  // (a quarter of |x| in few bits, so that 1 − qx is exact)
  const qx = ax > 0.78125 ? 0.28125 : Math.fround(ax / 4);
  const hz = 0.5 * z - qx;
  return 1 - qx - (hz - (z * r - x * y));
}

function sin(x: number): number {
  if (!Number.isFinite(x)) {
    return Number.NaN;
  }
  if (Math.abs(x) < TWO_M26) {
    return x;
  }
  reduce(x);
  const { quadrant, r, tail } = reduced;
  if (quadrant === 0) {
    return kernelSin(r, tail);
  }
  if (quadrant === 1) {
    return kernelCos(r, tail);
  }
  return quadrant === 2 ? -kernelSin(r, tail) : -kernelCos(r, tail);
}

function cos(x: number): number {
  if (!Number.isFinite(x)) {
    return Number.NaN;
  }
  reduce(x);
  const { quadrant, r, tail } = reduced;
  if (quadrant === 0) {
    return kernelCos(r, tail);
  }
  if (quadrant === 1) {
    return -kernelSin(r, tail);
  }
  return quadrant === 2 ? -kernelCos(r, tail) : kernelSin(r, tail);
}

/** sin(x) / cos(x), both from one reduction. */
function tan(x: number): number {
  if (!Number.isFinite(x)) {
    return Number.NaN;
  }
  if (Math.abs(x) < TWO_M26) {
    return x;
  }
  reduce(x);
  const { quadrant, r, tail } = reduced;
  const s = kernelSin(r, tail);
  const c = kernelCos(r, tail);
  return quadrant % 2 === 0 ? s / c : -c / s;
}

// --- the arc functions --------------------------------------------------------

const ATAN_HI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1,
  9.82793723247329054082e-1, 1.570796326794896558,
];
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17,
  1.39033110312309984516e-17, 6.12323399573676603587e-17,
];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1,
  1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2,
  6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.6531572744216915527e-2,
  1.62858201153657823623e-2,
];

/** atan(x) = ATAN_HI[id] + atan(t): the interval of |x| and its t. */
function atanInterval(ax: number): [id: number, t: number] {
  if (ax < 0.4375) {
    return [-1, ax];
  }
  if (ax < 0.6875) {
    return [0, (2 * ax - 1) / (2 + ax)];
  }
  if (ax < 1.1875) {
    return [1, (ax - 1) / (ax + 1)];
  }
  if (ax < 2.4375) {
    return [2, (ax - 1.5) / (1 + 1.5 * ax)];
  }
  return [3, -1 / ax];
}

function atan(x: number): number {
  if (Number.isNaN(x)) {
    return x;
  }
  const ax = Math.abs(x);
  if (ax >= 2 ** 66) {
    return x > 0 ? ATAN_HI[3] + ATAN_LO[3] : -ATAN_HI[3] - ATAN_LO[3];
  }
  if (ax < TWO_M29) {
    return x;
  }
  const [id, t] = atanInterval(ax);
  const z = t * t;
  const w = z * z;
  const s1 =
    z *
    (AT[0] +
      w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  const r =
    id < 0
      ? t - t * (s1 + s2)
      : ATAN_HI[id] - (t * (s1 + s2) - ATAN_LO[id] - t);
  return x < 0 ? -r : r;
}

const PI_LO = 1.2246467991473532e-16;
const negative = (v: number): boolean => v < 0 || Object.is(v, -0);

/** atan2 where x or y is zero or infinite. */
function atan2Special(y: number, x: number): number | undefined {
  if (Number.isNaN(x) || Number.isNaN(y)) {
    return Number.NaN;
  }
  if (y === 0) {
    if (negative(x)) {
      return negative(y) ? -Math.PI : Math.PI;
    }
    return y;
  }
  if (x === 0) {
    return y < 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  if (!Number.isFinite(x) && !Number.isFinite(y)) {
    const a = x > 0 ? Math.PI / 4 : (3 * Math.PI) / 4;
    return y > 0 ? a : -a;
  }
  if (!Number.isFinite(x)) {
    const a = x > 0 ? 0 : Math.PI;
    return y > 0 ? a : -a;
  }
  if (!Number.isFinite(y)) {
    return y > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  return undefined;
}

function atan2(y: number, x: number): number {
  const special = atan2Special(y, x);
  if (special !== undefined) {
    return special;
  }
  const ratio = Math.abs(y / x);
  let z = 0;
  if (ratio > 2 ** 60) {
    z = Math.PI / 2 + 0.5 * PI_LO;
  } else if (!(x < 0 && ratio < TWO_M60)) {
    z = atan(ratio);
  }
  if (x > 0) {
    return y < 0 ? -z : z;
  }
  return y < 0 ? z - PI_LO - Math.PI : Math.PI - (z - PI_LO);
}

/** acos(x) as the angle of (x, √(1 − x²)). */
function acos(x: number): number {
  if (!(x >= -1 && x <= 1)) {
    return Number.NaN;
  }
  return atan2(Math.sqrt((1 - x) * (1 + x)), x);
}

/** asin(x) as the angle of (√(1 − x²), x). */
function asin(x: number): number {
  if (!(x >= -1 && x <= 1)) {
    return Number.NaN;
  }
  return atan2(x, Math.sqrt((1 - x) * (1 + x)));
}

// --- exponential and logarithm ------------------------------------------------

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const EXP_OVERFLOW = 7.09782712893383973096e2;
const EXP_UNDERFLOW = -7.4513321910194110842e2;

function exp(x: number): number {
  if (Number.isNaN(x)) {
    return x;
  }
  if (x > EXP_OVERFLOW) {
    return Number.POSITIVE_INFINITY;
  }
  if (x < EXP_UNDERFLOW) {
    return 0;
  }
  if (Math.abs(x) < TWO_M28) {
    return 1 + x;
  }
  const k = Math.floor(x * Math.LOG2E + 0.5);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return k === 0 ? y : scale(y, k);
}

const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/** x = 2^k · m with m in [√2/2, √2): k, and m − 1. */
function mantissa(value: number): [k: number, f: number] {
  let x = value;
  let k = 0;
  // a subnormal, scaled into the normal range first
  if (x < TWO_M1022) {
    x *= 2 ** 54;
    k = -54;
  }
  let hx = highWord(x);
  k += (hx >>> 20) - 1023;
  hx &= 0x00_0f_ff_ff;
  const i = (hx + 0x9_5f_64) & 0x10_00_00;
  words[0] = x;
  halves[HI] = hx | (i ^ 0x3f_f0_00_00);
  return [k + (i >>> 20), words[0] - 1];
}

/** The natural logarithm. */
function log(x: number): number {
  if (Number.isNaN(x) || x < 0) {
    return Number.NaN;
  }
  if (x === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (x === Number.POSITIVE_INFINITY) {
    return x;
  }
  const [k, f] = mantissa(x);
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const hfsq = 0.5 * f * f;
  const tail = s * (hfsq + t2 + t1);
  return k === 0
    ? f - (hfsq - tail)
    : k * LN2_HI - (hfsq - (tail + k * LN2_LO) - f);
}

/** log(1 + x), exact to the last places for a small x too (Kahan's
 *  correction of log by what 1 + x lost). */
function log1p(x: number): number {
  const u = 1 + x;
  if (u === 1 || !Number.isFinite(u)) {
    return u === 1 ? x : log(u);
  }
  return (log(u) * x) / (u - 1);
}

function atanh(x: number): number {
  if (x === 0) {
    return x;
  }
  const a = Math.abs(x);
  const r = 0.5 * log1p((2 * a) / (1 - a));
  return x < 0 ? -r : r;
}

function asinh(x: number): number {
  const a = Math.abs(x);
  if (!Number.isFinite(a) || a === 0) {
    return x;
  }
  // (past 2^28 the square would overflow in time, and 1 no longer counts)
  const r =
    a > 2 ** 28
      ? log(a) + Math.LN2
      : log1p(a + (a * a) / (1 + Math.sqrt(1 + a * a)));
  return x < 0 ? -r : r;
}

/** The largest whole power multiplied out, as JavaScriptCore does. */
const POWER_BY_SQUARING = 1000;

/** x^y: a whole y from 0 to 1000 by squaring (exact where the products
 *  are; what `**` gives in JavaScriptCore), any other as exp(y · log x). */
function pow(x: number, y: number): number {
  if (Number.isInteger(y) && y >= 0 && y <= POWER_BY_SQUARING) {
    let result = 1;
    let base = x;
    for (let n = y; n > 0; n = Math.floor(n / 2)) {
      if (n % 2 === 1) {
        result *= base;
      }
      base *= base;
    }
    return result;
  }
  if (Number.isInteger(y) && y < 0 && y >= -POWER_BY_SQUARING) {
    return 1 / pow(x, -y);
  }
  if (Number.isInteger(y)) {
    // a large whole power: the sign is the base's
    const magnitude = exp(y * log(Math.abs(x)));
    return x < 0 && Math.abs(y) % 2 === 1 ? -magnitude : magnitude;
  }
  if (x === 0) {
    return y > 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  if (y === 0.5) {
    return Math.sqrt(x);
  }
  return exp(y * log(x));
}

function cbrt(x: number): number {
  if (x === 0 || !Number.isFinite(x)) {
    return x;
  }
  const a = Math.abs(x);
  if (a > 1e100) {
    // (the cube of the estimate would overflow: an exact 2^300 off first)
    return scale(cbrt(scale(x, -300)), 100);
  }
  let t = exp(log(a) / 3);
  // two Newton steps take the estimate to the last place
  t -= (t * t * t - a) / (3 * t * t);
  t -= (t * t * t - a) / (3 * t * t);
  return x < 0 ? -t : t;
}

/** Past this e^x overflows while its half does not. */
const EXP_HALVED = 709;

/** e^a / 2 for a past EXP_HALVED: what sinh and cosh both are there. */
function halfExp(a: number): number {
  const e = exp(a / 2);
  return (e / 2) * e;
}

function cosh(x: number): number {
  const a = Math.abs(x);
  if (a > EXP_HALVED) {
    return halfExp(a);
  }
  const e = exp(a);
  return (e + 1 / e) / 2;
}

/** A logarithm to a whole base: log(x) / log(base), and exactly n where x
 *  is base^n (the quotient alone gives 2.9999999999999996 for 1000). */
function logBase(x: number, base: number, lnBase: number): number {
  const r = log(x) / lnBase;
  const n = Math.round(r);
  return Math.abs(r - n) < 1e-9 && pow(base, n) === x ? n : r;
}

const log10 = (x: number): number => logBase(x, 10, Math.LN10);
const log2 = (x: number): number => logBase(x, 2, Math.LN2);

function sinh(x: number): number {
  const a = Math.abs(x);
  if (a < 0.3) {
    // the series: e^x − e^−x cancels here
    const z = x * x;
    return (
      x *
      (1 +
        (z / 6) *
          (1 +
            (z / 20) *
              (1 +
                (z / 42) * (1 + (z / 72) * (1 + (z / 110) * (1 + z / 156))))))
    );
  }
  const e = exp(a);
  const s = a > EXP_HALVED ? halfExp(a) : (e - 1 / e) / 2;
  return x < 0 ? -s : s;
}

export {
  acos,
  asin,
  asinh,
  atan,
  atan2,
  atanh,
  cbrt,
  cos,
  cosh,
  exp,
  hypot,
  log,
  log10,
  log1p,
  log2,
  pow,
  sin,
  sinh,
  tan,
};
