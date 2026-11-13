import { afterEach, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
} from "three/webgpu";
import type { Texture, WebGPURenderer } from "three/webgpu";
import { tileArtifacts } from "@/lib/city/tile";
import type { ContentExtras } from "@/lib/city/tileset";
import { trackedBytesOf } from "./three-utils";
import {
  createTileRasters,
  RASTER_KINDS,
  rasterFiles,
  readsSportGrounds,
} from "./tile-rasters";
import type { RasterKind, TileRasters } from "./tile-rasters";

/** One PNG chunk: length, type, body (the CRC left at 0). */
const chunk = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(
    Array.from(type, (c) => c.codePointAt(0) ?? 0),
    4
  );
  out.set(body, 8);
  return out;
};

/** A greyscale PNG (CRCs left at 0: the viewer's decoder does not check). */
function greyPng(width: number, height: number): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk(
      "IDAT",
      new Uint8Array(deflateSync(new Uint8Array((width + 1) * height)))
    ),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Asked-for URLs, their signals, and what the test holds back. */
interface Served {
  asked: string[];
  signals: Map<string, AbortSignal>;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Serves `<w>x<h>.png` as such a PNG and `.json` as `tables`; a URL with
 * `never` in it never answers, but rejects with its signal's abort.
 */
function serve(tables: Record<string, unknown> = {}): Served {
  const served: Served = { asked: [], signals: new Map() };
  // reason: the loaders read only `ok` and the body of a Response
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = input;
    served.asked.push(url);
    if (init?.signal) {
      served.signals.set(url, init.signal);
    }
    if (url.includes("never")) {
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("gone", "AbortError"));
        });
      });
    }
    if (url.endsWith(".json")) {
      return Response.json(tables[url] ?? null);
    }
    const size = /(?<w>\d+)x(?<h>\d+)/u.exec(url)?.groups;
    return new Response(greyPng(Number(size?.w ?? 4), Number(size?.h ?? 4)));
  }) as unknown as typeof fetch;
  return served;
}

/** What three's `initTexture` does that the loader relies on. */
function fakeRenderer(onUpload?: (texture: Texture) => void) {
  const uploads: { mips: boolean; min: number; texture: Texture }[] = [];
  const renderer = {
    initTexture: (texture: Texture) => {
      uploads.push({
        mips: texture.generateMipmaps,
        min: texture.minFilter,
        texture,
      });
      texture.onUpdate?.(texture);
      onUpload?.(texture);
    },
  } as unknown as WebGPURenderer;
  return { renderer, uploads };
}

function rastersWith(opts: {
  low?: boolean;
  onShareChange?: (root: object) => void;
  renderer?: WebGPURenderer;
}): TileRasters {
  return createTileRasters({
    url: (file) => file,
    lowRasters: opts.low ?? false,
    onShareChange: opts.onShareChange ?? (() => {}),
    renderer: opts.renderer ?? fakeRenderer().renderer,
  });
}

/** Extras naming files for a kind (their shape is the test's business). */
const extrasOf = (named: Record<string, unknown>) =>
  ({ kind: "terrain", level: 0, ...named }) as unknown as ContentExtras;

/** A raster that must have landed. */
function landed<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("the raster did not load");
  }
  return value;
}

const tick = async () =>
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

test("a raster is on the GPU, set up as its row says, its bytes dropped, its tracked bytes known", async () => {
  serve();
  const { renderer, uploads } = fakeRenderer();
  const hold = rastersWith({ renderer }).holder({});
  const texture = await hold.acquire(
    "ndvi",
    extrasOf({ ndvi: "ndvi-4x4.png" })
  );
  if (!texture) {
    throw new Error("the raster did not load");
  }
  // uploaded once, with its mip chain asked for (fixed at the upload)
  expect(uploads).toEqual([
    { mips: true, min: LinearMipmapLinearFilter, texture },
  ]);
  expect((texture.image as { data: unknown }).data).toBeNull();
  expect(trackedBytesOf(texture)).toBe(Math.round(16 * (4 / 3)));
});

test("two holders of one file: one fetch, freed with the last release", async () => {
  const served = serve();
  const rasters = rastersWith({});
  const extras = extrasOf({ svf: "svf-4x4.png" });
  const first = rasters.holder({});
  const second = rasters.holder({});
  const [a, b] = await Promise.all([
    first.acquire("svf", extras),
    second.acquire("svf", extras),
  ]);
  expect(a).toBe(b);
  expect(served.asked).toEqual(["svf-4x4.png"]);
  const texture = landed(a);
  first.release();
  // idempotent: the second holder's reference is not taken with it
  first.release();
  await tick();
  expect(trackedBytesOf(texture)).toBeGreaterThan(0);
  second.release();
  await tick();
  expect(trackedBytesOf(texture)).toBe(0);
});

test("a holder released before its raster lands: freed when it lands, and a load every holder left is aborted", async () => {
  const served = serve();
  // let go in the very upload: the load is past every abort check
  let hold = rastersWith({}).holder({});
  const { renderer, uploads } = fakeRenderer(() => {
    hold.release();
  });
  hold = rastersWith({ renderer }).holder({});
  expect(
    await hold.acquire("surface", extrasOf({ surface: "s-4x4.png" }))
  ).toBeNull();
  await tick();
  expect(uploads.length).toBe(1);
  expect(trackedBytesOf(landed(uploads[0]).texture)).toBe(0);

  const left = rastersWith({}).holder({});
  const waiting = left.acquire("surface", extrasOf({ surface: "never.png" }));
  await tick();
  expect(served.signals.get("never.png")?.aborted).toBe(false);
  left.release();
  expect(served.signals.get("never.png")?.aborted).toBe(true);
  expect(await waiting).toBeNull();
});

test("a holder whose signal aborts while it waits rejects at once and, released, lets go", async () => {
  const served = serve();
  const hold = rastersWith({}).holder({});
  const aborter = new AbortController();
  const waiting = hold.acquire(
    "surface",
    extrasOf({ surface: "never.png" }),
    aborter.signal
  );
  await tick();
  aborter.abort();
  await expect(waiting).rejects.toThrow();
  // the wait is over; the reference is the release's to let go
  expect(served.signals.get("never.png")?.aborted).toBe(false);
  hold.release();
  expect(served.signals.get("never.png")?.aborted).toBe(true);
});

test("weighing: one holder whole, two half each, one leaving hands the other the whole; the buildings change nobody's share", async () => {
  serve();
  const changed: object[] = [];
  const rasters = rastersWith({
    onShareChange: (root) => {
      changed.push(root);
    },
  });
  const extras = extrasOf({ svf: "svf-4x4.png" });
  const fine = {};
  const coarse = {};
  const city = {};
  const fineHold = rasters.holder(fine);
  const whole = trackedBytesOf(landed(await fineHold.acquire("svf", extras)));
  expect(whole).toBeGreaterThan(0);
  // still dressing: it weighs nothing yet
  expect(rasters.bytesOf(fine)).toBe(0);
  fineHold.settle();
  expect(rasters.bytesOf(fine)).toBe(whole);
  expect(changed).toEqual([]);

  // the buildings hold it, unweighed: nobody's share moves
  const cityHold = rasters.holder(city, { weighed: false });
  await cityHold.acquire("svf", extras);
  expect(rasters.bytesOf(fine)).toBe(whole);
  expect(rasters.bytesOf(city)).toBe(0);
  expect(changed).toEqual([]);

  const coarseHold = rasters.holder(coarse);
  await coarseHold.acquire("svf", extras);
  // landed but not dressed: the cache must not see the fine level at half
  // while this one weighs 0
  expect(rasters.bytesOf(fine)).toBe(whole);
  expect(rasters.bytesOf(coarse)).toBe(0);
  expect(changed).toEqual([]);
  coarseHold.settle();
  expect(rasters.bytesOf(fine)).toBe(whole / 2);
  expect(rasters.bytesOf(coarse)).toBe(whole / 2);
  expect(changed).toEqual([fine]);

  changed.length = 0;
  coarseHold.release();
  expect(rasters.bytesOf(fine)).toBe(whole);
  expect(rasters.bytesOf(coarse)).toBe(0);
  expect(changed).toEqual([fine]);

  changed.length = 0;
  cityHold.release();
  expect(changed).toEqual([]);
  fineHold.release();
  expect(rasters.bytesOf(fine)).toBe(0);
});

test("a raster taken after settling counts at once; one left before settling never did", async () => {
  serve();
  const changed: object[] = [];
  const rasters = rastersWith({
    onShareChange: (root) => {
      changed.push(root);
    },
  });
  const extras = extrasOf({ svf: "svf-4x4.png" });
  const stays = {};
  const staysHold = rasters.holder(stays);
  const whole = trackedBytesOf(landed(await staysHold.acquire("svf", extras)));
  staysHold.settle();
  const leaves = rasters.holder({});
  await leaves.acquire("svf", extras);
  leaves.release();
  leaves.settle();
  expect(rasters.bytesOf(stays)).toBe(whole);
  expect(changed).toEqual([]);
  const late = {};
  const lateHold = rasters.holder(late);
  lateHold.settle();
  await lateHold.acquire("svf", extras);
  expect(rasters.bytesOf(late)).toBe(whole / 2);
  expect(changed).toEqual([stays]);
});

test("clear frees what landed and aborts what is on its way", async () => {
  const served = serve();
  const rasters = rastersWith({});
  const hold = rasters.holder({});
  const sky = landed(
    await hold.acquire("svf", extrasOf({ svf: "svf-4x4.png" }))
  );
  const waiting = hold.acquire("surface", extrasOf({ surface: "never.png" }));
  await tick();
  rasters.clear();
  await tick();
  expect(trackedBytesOf(sky)).toBe(0);
  expect(served.signals.get("never.png")?.aborted).toBe(true);
  expect(await waiting).toBeNull();
  // what asks after the stream's end loads nothing
  expect(
    await rasters.holder({}).acquire("edges", extrasOf({ edges: "e-4x4.png" }))
  ).toBeNull();
  expect(served.asked).not.toContain("e-4x4.png");
  // a release after it is a no-op
  hold.release();
});

test("the files: each tier and level reads its own", () => {
  const fine = extrasOf({
    level: 0,
    landcover: "class.png",
    landcoverLow: "class-low.png",
    markings: "m.png",
    markingsLow: "m-low.png",
    markingsTable: "m.json",
    cultivated: "c.png",
    cultivatedLow: "c-low.png",
    sport: "s.png",
    sportTable: "s.json",
  });
  const coarse = extrasOf({ level: 1, sport: "s.png", sportTable: "s.json" });
  // a phone's fine level: every twin, no sports
  expect(rasterFiles(fine, "class", true)).toEqual({ raster: "class-low.png" });
  expect(rasterFiles(fine, "markings", true)).toEqual({
    raster: "m-low.png",
    table: "m.json",
  });
  expect(rasterFiles(fine, "colonies", true)).toEqual({ raster: "c-low.png" });
  expect(rasterFiles(fine, "sport", true)).toBeNull();
  // a desktop's: the full files, sports; a coarse level none on either tier
  expect(rasterFiles(fine, "class", false)).toEqual({ raster: "class.png" });
  expect(rasterFiles(fine, "markings", false)?.raster).toBe("m.png");
  expect(rasterFiles(fine, "colonies", false)).toEqual({ raster: "c.png" });
  expect(rasterFiles(fine, "sport", false)).toEqual({
    raster: "s.png",
    table: "s.json",
  });
  expect(rasterFiles(coarse, "sport", false)).toBeNull();
  expect(rasterFiles(coarse, "sport", true)).toBeNull();
  expect(readsSportGrounds(0, false)).toBe(true);
  expect(readsSportGrounds(1, false)).toBe(false);
  expect(readsSportGrounds(0, true)).toBe(false);
  expect(readsSportGrounds(1, true)).toBe(false);
  // no twin: the markings and the colonies fall back to the full file, the
  // class raster to nothing (an empty name is no file)
  const noTwins = extrasOf({
    landcover: "class.png",
    landcoverLow: "",
    markings: "m.png",
    markingsTable: "m.json",
    cultivated: "c.png",
  });
  expect(rasterFiles(noTwins, "class", true)).toBeNull();
  expect(rasterFiles(noTwins, "markings", true)?.raster).toBe("m.png");
  expect(rasterFiles(noTwins, "colonies", true)?.raster).toBe("c.png");
});

test("a pair with one file missing is null without a fetch", async () => {
  const served = serve();
  const hold = rastersWith({}).holder({});
  expect(
    await hold.acquire("markings", extrasOf({ markings: "m-4x4.png" }))
  ).toBeNull();
  expect(
    await hold.acquire("sport", extrasOf({ sportTable: "s.json" }))
  ).toBeNull();
  expect(served.asked).toEqual([]);
});

test("a table without what its raster needs fetches no raster", async () => {
  const served = serve({ "s.json": { grounds: [] }, "m.json": {} });
  const hold = rastersWith({}).holder({});
  expect(
    await hold.acquire(
      "sport",
      extrasOf({ sport: "s-4x4.png", sportTable: "s.json" })
    )
  ).toBeNull();
  expect(
    await hold.acquire(
      "markings",
      extrasOf({ markings: "m-4x4.png", markingsTable: "m.json" })
    )
  ).toBeNull();
  expect(served.asked).toEqual(["s.json", "m.json"]);
});

test("the looks: each kind's filters, mips and anisotropy, written out", async () => {
  serve({ "m.json": { markings: [] } });
  const expected: Record<
    Exclude<RasterKind, "class" | "sport" | "markings">,
    {
      min: Texture["minFilter"];
      mag: Texture["magFilter"];
      mips: boolean;
      aniso: number;
      file: string;
    }
  > = {
    ndvi: {
      min: LinearMipmapLinearFilter,
      mag: LinearFilter,
      mips: true,
      aniso: 16,
      file: "4x4.png",
    },
    surface: {
      min: NearestFilter,
      mag: NearestFilter,
      mips: false,
      aniso: 1,
      file: "16x4.png",
    },
    edges: {
      min: LinearFilter,
      mag: LinearFilter,
      mips: false,
      aniso: 1,
      file: "8x4.png",
    },
    colonies: {
      min: LinearFilter,
      mag: LinearFilter,
      mips: false,
      aniso: 1,
      file: "8x4.png",
    },
    svf: {
      min: LinearMipmapLinearFilter,
      mag: LinearFilter,
      mips: true,
      aniso: 1,
      file: "4x4.png",
    },
    horizon: {
      min: LinearFilter,
      mag: LinearFilter,
      mips: false,
      aniso: 1,
      file: "8x16.png",
    },
  };
  for (const [kind, want] of Object.entries(expected)) {
    const key = RASTER_KINDS[kind as RasterKind].extras;
    const texture: Texture = landed(
      await rastersWith({})
        .holder({})
        .acquire(kind as "ndvi", extrasOf({ [key]: want.file }))
    );
    expect({
      min: texture.minFilter,
      mag: texture.magFilter,
      mips: texture.generateMipmaps,
      aniso: texture.anisotropy,
      flipY: texture.flipY,
    }).toEqual({
      min: want.min,
      mag: want.mag,
      mips: want.mips,
      aniso: want.aniso,
      flipY: false,
    });
    expect(texture instanceof DataArrayTexture).toBe(kind === "horizon");
  }
  // the class raster's row (never past its load: the paint needs a GPU)
  expect(RASTER_KINDS.class.look).toEqual({
    channels: 1,
    filter: "nearest",
    browserFallback: true,
  });
  // a pair: the raster NEAREST, its table's texture beside it
  const pair = await rastersWith({})
    .holder({})
    .acquire(
      "markings",
      extrasOf({ markings: "16x4.png", markingsTable: "m.json" })
    );
  expect(pair?.raster.minFilter).toBe(NearestFilter);
  expect(pair?.table.minFilter).toBe(NearestFilter);
  // the table weighs nothing in the cache
  expect(trackedBytesOf(landed(pair).table)).toBe(0);
});

test("the tie: every extras key the table reads is written by some row of the artifact table", () => {
  const written = new Set(
    Object.values(tileArtifacts("t")).flatMap((artifact) =>
      Object.values(artifact.terrain?.levels ?? {}).flat()
    )
  );
  for (const row of Object.values(RASTER_KINDS)) {
    for (const key of [row.extras, row.phone, row.table]) {
      if (key) {
        expect(written.has(key)).toBe(true);
      }
    }
  }
});

test("far: a kind reads its twin where the content names one beside its file", () => {
  const fine = extrasOf({
    surface: "p.png",
    surfaceFar: "p-far.png",
    edges: "e.png",
    markings: "m.png",
    markingsLow: "m-low.png",
    markingsTable: "m.json",
    sportFar: "s-far.png",
  });
  expect(rasterFiles(fine, "surface", false, true)?.raster).toBe("p-far.png");
  expect(rasterFiles(fine, "surface", false)?.raster).toBe("p.png");
  // no twin named: the file itself, near or far
  expect(rasterFiles(fine, "edges", false, true)?.raster).toBe("e.png");
  // a phone's twin is its far file too
  expect(rasterFiles(fine, "markings", false, true)?.raster).toBe("m-low.png");
  expect(rasterFiles(fine, "markings", true, true)?.raster).toBe("m-low.png");
  // a twin without the file it stands in for is not read
  expect(rasterFiles(fine, "sport", false, true)).toBeNull();
});

test("a swap: the twin lands on the GPU at once, the dropped set leaves the holder's weight and is freed", async () => {
  serve();
  const { renderer, uploads } = fakeRenderer();
  const rasters = rastersWith({ renderer });
  const extras = extrasOf({ surface: "p-8x8.png", surfaceFar: "p-4x4.png" });
  const root = {};
  const hold = rasters.holder(root);
  const near = landed(await hold.acquire("surface", extras));
  hold.settle();
  const nearBytes = rasters.bytesOf(root);
  expect(nearBytes).toBe(trackedBytesOf(near));
  uploads.length = 0;
  const far = landed(
    await hold.acquire("surface", extras, undefined, { far: true, now: true })
  );
  expect(far).not.toBe(near);
  expect(uploads.map((u) => u.texture)).toContain(far);
  hold.drop(near);
  await tick();
  expect(trackedBytesOf(near)).toBe(0);
  expect(rasters.bytesOf(root)).toBe(trackedBytesOf(far));
  expect(rasters.bytesOf(root)).toBeLessThan(nearBytes);
  // dropped once: a second drop, or of what it never took, changes nothing
  hold.drop(near);
  hold.drop(undefined);
  expect(rasters.bytesOf(root)).toBe(trackedBytesOf(far));
  hold.release();
  await tick();
  expect(trackedBytesOf(far)).toBe(0);
});

test("a swap to the same file (a phone's twin) keeps it held and weighed once", async () => {
  serve({ "m.json": null });
  const rasters = rastersWith({ low: true });
  const extras = extrasOf({
    cultivated: "c-8x8.png",
    cultivatedLow: "c-4x4.png",
  });
  const root = {};
  const hold = rasters.holder(root);
  const near = landed(await hold.acquire("colonies", extras));
  hold.settle();
  const bytes = rasters.bytesOf(root);
  const far = await hold.acquire("colonies", extras, undefined, { far: true });
  expect(far).toBe(near);
  hold.drop(near);
  await tick();
  expect(trackedBytesOf(near)).toBeGreaterThan(0);
  expect(rasters.bytesOf(root)).toBe(bytes);
  hold.release();
  await tick();
  expect(trackedBytesOf(near)).toBe(0);
});
