import { expect, test } from "bun:test";
import { chosenSites } from "./site-choice";

const known = ["dresden", "leipzig", "meissen", "berlin"];
const given = {
  known,
  named: [] as string[],
  ready: (id: string) => id !== "berlin",
  built: (id: string) => id === "dresden" || id === "leipzig",
};

test("with nothing asked, every ready site is prepared", () => {
  expect(chosenSites(given)).toEqual({
    keep: [],
    prepare: ["dresden", "leipzig", "meissen"],
  });
  expect(chosenSites({ ...given, env: " , " }).prepare).toHaveLength(3);
});

test("named sites are prepared alone, and nothing else is kept", () => {
  expect(chosenSites({ ...given, named: ["meissen"] })).toEqual({
    keep: [],
    prepare: ["meissen"],
  });
  // the command line wins over the variable
  expect(
    chosenSites({ ...given, env: "dresden", named: ["meissen"] }).prepare
  ).toEqual(["meissen"]);
});

test("PREPARE_SITES prepares its sites and keeps the others that were built", () => {
  expect(chosenSites({ ...given, env: "meissen, dresden" })).toEqual({
    keep: ["leipzig"],
    prepare: ["dresden", "meissen"],
  });
});

test("a name that is no site is said", () => {
  expect(chosenSites({ ...given, env: "dresden,atlantis" }).unknown).toBe(
    "atlantis"
  );
  expect(chosenSites({ ...given, named: ["pisa"] }).unknown).toBe("pisa");
});
