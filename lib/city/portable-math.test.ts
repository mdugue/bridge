import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { PMath } from "./portable-math";

/** A double's bits, as hex. */
function bits(x: number): string {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, "0");
}

/** How many doubles lie between two of one sign. */
function ulps(a: number, b: number): number {
  if (Object.is(a, b)) {
    return 0;
  }
  const d = BigInt(`0x${bits(Math.abs(a))}`) - BigInt(`0x${bits(Math.abs(b))}`);
  return Math.sign(a) === Math.sign(b) ? Math.abs(Number(d)) : Infinity;
}

/** The same arguments everywhere: a linear congruence in exact integer
 *  steps, spread over [−1, 1). */
function sweep(n: number, visit: (u: number, v: number) => void): void {
  let seed = 12_345;
  const draw = () => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return seed / 2 ** 31 - 1;
  };
  for (let i = 0; i < n; i += 1) {
    visit(draw(), draw());
  }
}

/** What each function is asked over a sweep. */
const CASES: Record<string, (u: number, v: number) => number> = {
  acos: (u) => PMath.acos(u),
  asin: (u) => PMath.asin(u),
  asinh: (u) => PMath.asinh(u * 20),
  atan: (u) => PMath.atan(u * 50),
  atan2: (u, v) => PMath.atan2(u * 100, v * 100),
  atanh: (u) => PMath.atanh(u * 0.99),
  cbrt: (u) => PMath.cbrt(u * 1000),
  cos: (u) => PMath.cos(u * 40),
  cosh: (u) => PMath.cosh(u * 5),
  exp: (u) => PMath.exp(u * 30),
  hypot: (u, v) => PMath.hypot(u * 100, v * 100),
  hypot3: (u, v) => PMath.hypot(u * 100, v * 100, u * v * 100),
  log: (u) => PMath.log(Math.abs(u) * 100),
  log1p: (u) => PMath.log1p(u * 0.5),
  pow: (u, v) => PMath.pow(Math.abs(u) * 10, v * 3),
  sin: (u) => PMath.sin(u * 40),
  sinh: (u) => PMath.sinh(u * 5),
  srgb: (u) => PMath.pow((Math.abs(u) + 0.055) / 1.055, 2.4),
  tan: (u) => PMath.tan(u * 40),
};

/** The digest of every result's bits over the sweep, pinned: the
 *  functions are made of exactly rounded operations, so any machine that
 *  gives another digest runs this arithmetic differently — which is what
 *  the bakes must not depend on. */
const PINNED: Record<string, string> = {
  acos: "5497657f608dc186",
  asin: "bb9a6e1dcfa752a5",
  asinh: "5e2b65e1f7801db3",
  atan: "81eb8801d8e467c4",
  atan2: "6490909065dca1f9",
  atanh: "f7104f7efc1b1111",
  cbrt: "34118e815dc31f7f",
  cos: "b548edc8dad75b06",
  cosh: "1143f9a966555264",
  exp: "63e574a34071891f",
  hypot: "3be359a50322ade8",
  hypot3: "f655a7154152715d",
  log: "457a14e12530158d",
  log1p: "92347474945d7e03",
  pow: "54e3441c54d2a973",
  sin: "15eb02f6bb4742fc",
  sinh: "6c2bfca99efcc85a",
  srgb: "acbd9444bf544b49",
  tan: "2246b3867ec19d8b",
};

test("every function gives the same bits on every machine", () => {
  const digests: Record<string, string> = {};
  for (const [name, f] of Object.entries(CASES)) {
    const out = new Float64Array(50_000);
    let i = 0;
    sweep(out.length, (u, v) => {
      out[i] = f(u, v);
      i += 1;
    });
    const view = new DataView(out.buffer);
    const bytes = new Uint8Array(out.byteLength);
    // (big-endian, whatever the machine's order)
    for (let k = 0; k < out.length; k += 1) {
      new DataView(bytes.buffer).setFloat64(
        8 * k,
        view.getFloat64(8 * k, true)
      );
    }
    digests[name] = createHash("sha1").update(bytes).digest("hex").slice(0, 16);
  }
  expect(digests).toEqual(PINNED);
});

test("the lengths glibc 2.39 and 2.43 disagreed about are pinned", () => {
  // Math.hypot is the C library's: these gave another last bit on CI's
  // runner (glibc 2.43) than on a glibc 2.39 machine, or than the plain
  // square root of the sum; a corner test read one and a tile's buildings
  // came out a vertex richer (plan 087)
  expect(bits(PMath.hypot(-8.697488950565457, 49.832253879867494))).toBe(
    "40494af3f0ec0c64"
  );
  expect(
    bits(PMath.hypot(48.48285487387329, -25.55798110552132, 18.635555705986917))
  ).toBe("404cf1bb40344b97");
  expect(PMath.hypot(3, 4)).toBe(5);
  expect(PMath.hypot(-5, 12)).toBe(13);
  expect(PMath.hypot(2, 3, 6)).toBe(7);
  expect(PMath.hypot()).toBe(0);
});

test("each function is within a few units in the last place of Math's", () => {
  // (Math's own last bits are the machine's: a bound, not an equality)
  const worst: Record<string, number> = {};
  const against: Record<
    string,
    [(x: number) => number, (x: number) => number, number]
  > = {
    acos: [PMath.acos, Math.acos, 1],
    asin: [PMath.asin, Math.asin, 1],
    asinh: [PMath.asinh, Math.asinh, 20],
    atan: [PMath.atan, Math.atan, 50],
    atanh: [PMath.atanh, Math.atanh, 0.99],
    cbrt: [PMath.cbrt, Math.cbrt, 1000],
    cos: [PMath.cos, Math.cos, 40],
    cosh: [PMath.cosh, Math.cosh, 5],
    exp: [PMath.exp, Math.exp, 30],
    log1p: [PMath.log1p, Math.log1p, 0.5],
    sin: [PMath.sin, Math.sin, 40],
    sinh: [PMath.sinh, Math.sinh, 5],
    tan: [PMath.tan, Math.tan, 40],
  };
  for (const [name, [mine, theirs, range]] of Object.entries(against)) {
    worst[name] = 0;
    sweep(20_000, (u) => {
      worst[name] = Math.max(
        worst[name],
        ulps(mine(u * range), theirs(u * range))
      );
    });
    expect(worst[name]).toBeLessThanOrEqual(4);
  }
  let power = 0;
  sweep(20_000, (u, v) => {
    const x = Math.abs(u) * 10;
    power = Math.max(power, ulps(PMath.pow(x, v * 3), x ** (v * 3)));
    expect(ulps(PMath.atan2(u, v), Math.atan2(u, v))).toBeLessThanOrEqual(2);
    expect(ulps(PMath.log(x), Math.log(x))).toBeLessThanOrEqual(2);
  });
  expect(power).toBeLessThanOrEqual(64);
});

test("a hash's large angle keeps its sine", () => {
  // fract(sin(seed · 12.9898) · 43758.5453): the seed may be an id
  let worst = 0;
  sweep(20_000, (u, v) => {
    const x = u * 10 ** Math.floor(6 + Math.abs(v) * 7);
    worst = Math.max(
      worst,
      Math.abs(PMath.sin(x) - Math.sin(x)),
      Math.abs(PMath.cos(x) - Math.cos(x))
    );
  });
  expect(worst).toBeLessThan(1e-14);
  expect(bits(PMath.sin(123_456_789 * 12.9898))).toBe("bfe69dacfbc006c4");
});

test("the exact cases are exact", () => {
  expect(PMath.sin(0)).toBe(0);
  expect(Object.is(PMath.sin(-0), -0)).toBe(true);
  expect(PMath.cos(0)).toBe(1);
  expect(PMath.tan(0)).toBe(0);
  expect(PMath.exp(0)).toBe(1);
  expect(PMath.log(1)).toBe(0);
  expect(PMath.log(0)).toBe(Number.NEGATIVE_INFINITY);
  expect(PMath.log(-1)).toBeNaN();
  expect(PMath.acos(1)).toBe(0);
  expect(PMath.acos(2)).toBeNaN();
  expect(PMath.asin(0)).toBe(0);
  expect(PMath.cbrt(27)).toBe(3);
  expect(PMath.cbrt(-8)).toBe(-2);
  expect(PMath.sinh(0)).toBe(0);
  expect(PMath.cosh(0)).toBe(1);
  expect(PMath.atan2(0, -1)).toBe(Math.PI);
  expect(PMath.atan2(-0, -1)).toBe(-Math.PI);
  expect(PMath.atan2(1, 0)).toBe(Math.PI / 2);
  expect(PMath.atan2(-1, 0)).toBe(-Math.PI / 2);
  expect(Object.is(PMath.atan2(-0, 1), -0)).toBe(true);
  expect(PMath.atan(Number.POSITIVE_INFINITY)).toBe(Math.PI / 2);
  expect(PMath.exp(1000)).toBe(Number.POSITIVE_INFINITY);
  expect(PMath.exp(-1000)).toBe(0);
});

test("a whole power is the product, as ** gives it", () => {
  sweep(5000, (u, v) => {
    const x = u * 20;
    const n = Math.floor(Math.abs(v) * 12);
    expect(PMath.pow(x, n)).toBe(x ** n);
    expect(PMath.pow(x, 2)).toBe(x * x);
  });
  expect(PMath.pow(10, 3)).toBe(1000);
  expect(PMath.pow(2, 32)).toBe(4_294_967_296);
  expect(PMath.pow(2, -2)).toBe(0.25);
  expect(PMath.pow(-2, -3)).toBe(-0.125);
  expect(PMath.pow(0, 2.4)).toBe(0);
  expect(PMath.pow(5, 0)).toBe(1);
});
