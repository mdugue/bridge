import { afterEach, expect, test } from "bun:test";
import { bootAhead } from "./boot-ahead";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const TILESET = "https://city.example/data/x/tileset.abc.json";
const node = (uri: string, fine: string) => ({
  content: { uri },
  children: [{ content: { uri: fine } }],
});
const tileset = {
  extras: {
    epsg: 25_833,
    offset: { cx: 0, cy: 0 },
    tiles: [
      { id: "a", bounds: [0, 0, 2000, 2000] },
      { id: "b", bounds: [2000, 0, 4000, 2000] },
    ],
  },
  root: {
    children: [
      {
        children: [
          node("far_a.glb", "city_a.glb"),
          node("l1_a.glb", "l0_a.glb"),
        ],
      },
      {
        children: [
          node("far_b.glb", "city_b.glb"),
          node("l1_b.glb", "l0_b.glb"),
        ],
      },
    ],
  },
};

/** Answers by URL; counts the calls and the aborts of each. */
function stubFetch(answer: (url: string) => Response | Promise<Response>) {
  const asked: string[] = [];
  const aborted: string[] = [];
  // reason: the stub takes the URL and the signal only
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push(url);
    init?.signal?.addEventListener("abort", () => {
      aborted.push(url);
    });
    return await answer(url);
  }) as unknown as typeof fetch;
  return { aborted, asked };
}

const view = {
  aboveGround: 1.7,
  epsg: { x: 3000, y: 1000 },
  fov: 60,
  headingDeg: 0,
  mode: "walk" as const,
  pitchDeg: 0,
};

test("the start tile's first contents are asked for with the tileset, and handed over once", async () => {
  const net = stubFetch((url) =>
    url === TILESET ? Response.json(tileset) : new Response(url)
  );
  const ahead = bootAhead(TILESET, { initialView: view });
  const { start } = await ahead.tileset;
  expect(start.spawn.id).toBe("b");
  expect(net.asked).toEqual([
    TILESET,
    "https://city.example/data/x/far_b.glb",
    "https://city.example/data/x/l1_b.glb",
  ]);
  const far = await ahead.take("https://city.example/data/x/far_b.glb")?.got;
  expect(new TextDecoder().decode(far?.bytes)).toBe(
    "https://city.example/data/x/far_b.glb"
  );
  expect(ahead.take("https://city.example/data/x/far_b.glb")).toBeUndefined();
  expect(ahead.take("https://city.example/data/x/city_b.glb")).toBeUndefined();
  // the renderer reads the tileset from here too
  const root = await ahead.take(TILESET)?.got;
  expect(root?.ok).toBe(true);
});

test("released, what was not taken is stopped and forgotten", async () => {
  const never = Promise.withResolvers<Response>();
  const net = stubFetch(async (url) =>
    url === TILESET ? Response.json(tileset) : await never.promise
  );
  const ahead = bootAhead(TILESET, {});
  await ahead.tileset;
  const taken = ahead.take("https://city.example/data/x/far_a.glb");
  ahead.release();
  expect(net.aborted).toEqual(["https://city.example/data/x/l1_a.glb"]);
  expect(ahead.take("https://city.example/data/x/l1_a.glb")).toBeUndefined();
  taken?.abort();
  expect(net.aborted).toHaveLength(2);
});

test("a tileset that is missing fails the boot with its status, and asks for nothing more", async () => {
  const net = stubFetch(() => new Response(null, { status: 404 }));
  const ahead = bootAhead(TILESET, {});
  await expect(ahead.tileset).rejects.toThrow(
    `Failed to fetch ${TILESET}: HTTP 404`
  );
  expect(net.asked).toEqual([TILESET]);
});

test("the boot's signal ends every request", async () => {
  const never = Promise.withResolvers<Response>();
  const net = stubFetch(async (url) =>
    url === TILESET ? Response.json(tileset) : await never.promise
  );
  const boot = new AbortController();
  const ahead = bootAhead(TILESET, {}, boot.signal);
  await ahead.tileset;
  boot.abort();
  expect(net.aborted).toHaveLength(2);
});
