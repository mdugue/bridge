import { expect, test } from "bun:test";
import { createMissingPartWord } from "./missing-part-word";

function word(gone = () => false) {
  const shown: string[] = [];
  const w = createMissingPartWord({
    say: (m) => shown.push(m),
    clear: () => shown.push("(clear)"),
    gone,
  });
  return { shown, w };
}

test("a layer word shows once, the first one stays", () => {
  const { shown, w } = word();
  w.layerFailed("trees");
  w.layerFailed("lamps");
  expect(shown).toEqual(["trees"]);
});

test("the network's word covers a layer word, which comes back when it clears", () => {
  const { shown, w } = word();
  w.layerFailed("trees");
  w.networkFailed("offline");
  w.networkFailed("offline again");
  w.networkCleared();
  expect(shown).toEqual(["trees", "offline", "trees"]);
});

test("a network word alone goes when the network clears", () => {
  const { shown, w } = word();
  w.networkCleared();
  w.networkFailed("offline");
  w.networkCleared();
  w.networkCleared();
  expect(shown).toEqual(["offline", "(clear)"]);
});

test("a layer that fails under the network's word waits behind it", () => {
  const { shown, w } = word();
  w.networkFailed("offline");
  w.layerFailed("trees");
  w.networkCleared();
  expect(shown).toEqual(["offline", "trees"]);
});

test("a gone page says nothing", () => {
  let gone = false;
  const { shown, w } = word(() => gone);
  w.networkFailed("offline");
  gone = true;
  w.networkCleared();
  w.layerFailed("trees");
  expect(shown).toEqual(["offline"]);
});
