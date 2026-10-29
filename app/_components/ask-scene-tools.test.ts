import { expect, test } from "bun:test";
import { SCENE_TOOLS } from "@/lib/city/ask-tools";
import { type AskScene, sceneTools } from "./ask-scene-tools";

const STUB: AskScene = {
  from: () => null,
  look: () => ({}),
  river: null,
  setFlood: () => undefined,
  setVolume: () => true,
  setLayer: () => true,
  setListening: () => undefined,
  setStyle: () => undefined,
  setTime: () => "",
  show: () => undefined,
  where: () => ({}),
};

test("the card runs every scene tool the server hands the browser", () => {
  // one it does not bind leaves the run waiting for ever
  const bound = sceneTools(STUB).map((t) => t.name);
  expect(bound.sort((a, b) => a.localeCompare(b))).toEqual(
    SCENE_TOOLS.map((t) => t.name).sort((a, b) => a.localeCompare(b))
  );
});

test("a box is taken away with aus alone, and not placed off the loaded ground", async () => {
  const placed: unknown[] = [];
  const tools = sceneTools({
    ...STUB,
    setVolume: (v) => {
      placed.push(v);
      return v === null;
    },
  });
  const tool = tools.find((t) => t.name === "plane_baukoerper")!;
  expect(await tool.execute!({ aus: true })).toEqual({ ok: true });
  const off = (await tool.execute!({
    x: 1,
    y: 2,
    breite: 10,
    tiefe: 10,
    hoehe: 20,
  })) as { ok: boolean };
  expect(off.ok).toBe(false);
  expect(placed).toHaveLength(2);
});
