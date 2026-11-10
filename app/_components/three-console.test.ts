import { afterEach, expect, test } from "bun:test";
import { error, warn } from "three/webgpu";
import { routeThreeErrors, threeErrorText } from "./three-console";

let undo: (() => void) | null = null;
afterEach(() => {
  undo?.();
  undo = null;
});

test("three's errors reach the trail with their reason, printed as before", () => {
  const noted: string[] = [];
  const printed: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    printed.push(args);
  };
  try {
    undo = routeThreeErrors((text) => {
      noted.push(text);
    });
    error(
      "WebGPURenderer: Render pipeline creation failed (nameplate-shadow_51): binding 3 is a depth texture"
    );
  } finally {
    console.error = original;
  }
  expect(noted).toEqual([
    "THREE.WebGPURenderer: Render pipeline creation failed (nameplate-shadow_51): binding 3 is a depth texture",
  ]);
  expect(printed).toHaveLength(1);
});

test("three's warnings stay on the console only", () => {
  const noted: string[] = [];
  const original = console.warn;
  console.warn = () => {
    // swallowed for the test
  };
  try {
    undo = routeThreeErrors((text) => {
      noted.push(text);
    });
    warn("Renderer: a deprecation");
  } finally {
    console.warn = original;
  }
  expect(noted).toEqual([]);
});

test("a console function set before keeps hearing three, and gets it back", () => {
  const heard: string[] = [];
  const outer = routeThreeErrors(() => {
    // the first route, standing in for one set before (the Inspector's)
  });
  const inner = routeThreeErrors(() => {
    // the trail
  });
  const original = console.error;
  console.error = (message: unknown) => {
    heard.push(String(message));
  };
  try {
    error("one");
    inner();
    error("two");
    outer();
    error("three");
  } finally {
    console.error = original;
  }
  expect(heard).toEqual(["THREE.one", "THREE.two", "THREE.three"]);
});

test("only the parts of a call that read as text go into the line", () => {
  expect(
    threeErrorText("THREE.Loader: failed", [
      "tile",
      404,
      new Error("Not Found"),
      { isMaterial: true },
    ])
  ).toBe("THREE.Loader: failed tile 404 Not Found");
});
