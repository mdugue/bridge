import { expect, test } from "bun:test";
import { Group } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import { createStudyMarks } from "./study-marks";
import type { StudyMark } from "./study-marks-geometry";

const square = (x: number, shade: number): StudyMark => ({
  rings: [
    [
      [x, 0],
      [x + 10, 0],
      [x + 10, 10],
      [x, 10],
      [x, 0],
    ],
  ],
  x: x + 5,
  y: 5,
  shade,
});

function setup() {
  const parent = new Group();
  let changes = 0;
  const marks = createStudyMarks({
    parent,
    offset: { cx: 0, cy: 0 },
    heightAt: () => 100,
    roughAt: () => null,
    compile: async () => {},
    changed: () => {
      changes += 1;
    },
  });
  return { parent, marks, changes: () => changes };
}

test("the places come as one hatched mesh on the ground, and go", async () => {
  const { parent, marks, changes } = setup();
  await marks.show([square(0, 0.2), square(20, 0.8)]);
  expect(parent.children.length).toBe(1);
  const mesh = parent.children[0] as Mesh;
  expect(mesh.name).toBe("study-marks");
  expect(mesh.castShadow).toBe(false);
  const shade = mesh.geometry.getAttribute("studyShade");
  const position = mesh.geometry.getAttribute("position");
  expect(shade.count).toBe(position.count);
  expect(new Set(Array.from(shade.array as Float32Array))).toEqual(
    new Set([Math.fround(0.2), Math.fround(0.8)])
  );
  // over the ground, in the Y-up frame
  expect(position.getY(0)).toBeCloseTo(100.2, 4);
  expect(changes()).toBe(1);

  marks.clear();
  expect(parent.children.length).toBe(0);
  expect(changes()).toBe(2);
});

test("a newer study wins over one still compiling", async () => {
  const parent = new Group();
  const gate: { release?: () => void } = {};
  let first = true;
  const marks = createStudyMarks({
    parent,
    offset: { cx: 0, cy: 0 },
    heightAt: () => 0,
    roughAt: () => null,
    // the first compile waits until the test lets it go
    compile: async () => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
    },
    changed: () => {},
  });
  const slow = marks.show([square(0, 0.5)]);
  await marks.show([square(0, 0.1), square(20, 0.9)]);
  gate.release?.();
  await slow;
  expect(parent.children.length).toBe(1);
  const shade = (parent.children[0] as Mesh).geometry.getAttribute(
    "studyShade"
  );
  expect(new Set(Array.from(shade.array as Float32Array)).size).toBe(2);
});

test("no places, no mesh", async () => {
  const { parent, marks } = setup();
  await marks.show([]);
  expect(parent.children.length).toBe(0);
});

test("marks off the streamed tiles lie on the coarse ground until the tile comes", async () => {
  const parent = new Group();
  let fine: number | null = null;
  const marks = createStudyMarks({
    parent,
    offset: { cx: 0, cy: 0 },
    heightAt: () => fine,
    roughAt: () => 90,
    compile: async () => {},
    changed: () => {},
  });
  await marks.show([square(0, 0.5)]);
  const y = () =>
    (parent.children[0] as Mesh).geometry.getAttribute("position").getY(0);
  expect(y()).toBeCloseTo(90.2, 4);
  fine = 100;
  marks.groundChanged();
  await Promise.resolve();
  await Promise.resolve();
  expect(parent.children.length).toBe(1);
  expect(y()).toBeCloseTo(100.2, 4);
  // on the fine ground now: a later change lays nothing again
  const mesh = parent.children[0];
  marks.groundChanged();
  await Promise.resolve();
  expect(parent.children[0]).toBe(mesh);
});

test("a tile change elsewhere leaves marks on the coarse ground as they are", async () => {
  const parent = new Group();
  const marks = createStudyMarks({
    parent,
    offset: { cx: 0, cy: 0 },
    heightAt: () => null,
    roughAt: () => 90,
    compile: async () => {},
    changed: () => {},
  });
  await marks.show([square(0, 0.5)]);
  const mesh = parent.children[0];
  marks.groundChanged();
  await Promise.resolve();
  expect(parent.children[0]).toBe(mesh);
});
