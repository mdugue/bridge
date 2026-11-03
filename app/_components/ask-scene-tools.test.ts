import { expect, test } from "bun:test";
import { SCENE_TOOLS } from "@/lib/city/ask-tools";
import { type AskScene, sceneTools } from "./ask-scene-tools";

const STUB: AskScene = {
  abandon: () => undefined,
  from: () => null,
  look: async () => Promise.resolve({}),
  setLayer: () => true,
  setListening: () => undefined,
  setStyle: () => undefined,
  setTime: () => "",
  show: () => true,
  within: () => true,
  where: () => ({}),
};

test("the card runs every scene tool the server hands the browser", () => {
  // one it does not bind leaves the run waiting for ever
  const bound = sceneTools(STUB).map((t) => t.name);
  expect(bound.sort((a, b) => a.localeCompare(b))).toEqual(
    SCENE_TOOLS.map((t) => t.name).sort((a, b) => a.localeCompare(b))
  );
});
