import { describe, expect, test } from "bun:test";
import {
  activeStage,
  LOAD_STAGES,
  loadHeadline,
  loadPercent,
  loadStageStates,
  stagesDoneLabel,
  streamingTitle,
  WALKABLE_PERCENT,
} from "./load-stages";

describe("load stages", () => {
  test("the weights sum to a full bar", () => {
    const total = LOAD_STAGES.reduce((sum, stage) => sum + stage.weight, 0);
    expect(total).toBe(100);
  });

  test("the first-frame stages end exactly at the walkable cut", () => {
    // Everything the first frame needs, and nothing more: the handover fires
    // when these three are done, so their weights must land on the tick the
    // bar draws.
    const firstFrame = LOAD_STAGES.slice(0, 3);
    expect(firstFrame.map((s) => s.id)).toEqual([
      "buildings",
      "terrain",
      "light",
    ]);
    expect(firstFrame.reduce((sum, s) => sum + s.weight, 0)).toBe(
      WALKABLE_PERCENT
    );
    expect(loadPercent({ buildings: 1, terrain: 1, light: 1 })).toBe(
      WALKABLE_PERCENT
    );
  });

  test("the divider sits between the last first-frame stage and the rest", () => {
    const withDivider = loadStageStates({}).filter(
      (stage) => stage.showsDividerBefore
    );
    expect(withDivider.map((stage) => stage.id)).toEqual(["surroundings"]);
  });

  test("an unreported stage is pending, not active", () => {
    const [buildings, terrain] = loadStageStates({ buildings: 0 });
    expect(buildings.active).toBe(true);
    expect(buildings.pending).toBe(false);
    expect(terrain.pending).toBe(true);
    expect(terrain.active).toBe(false);
  });

  test("a started stage with no sub-progress reads as loading, not 0 %", () => {
    const [buildings] = loadStageStates({ buildings: 0 });
    expect(buildings.stateText).toBe("lädt…");
  });

  test("a stage in flight reports its own fraction", () => {
    const [buildings] = loadStageStates({ buildings: 0.42 });
    expect(buildings.stateText).toBe("42 %");
    expect(loadPercent({ buildings: 0.42 })).toBeCloseTo(12.6);
  });

  test("skipped stages complete the bar and say so", () => {
    const states = loadStageStates(
      { buildings: 1, terrain: 1, light: 1, details: 1 },
      { surroundings: true }
    );
    const surroundings = states.find((stage) => stage.id === "surroundings");
    expect(surroundings?.skipped).toBe(true);
    expect(surroundings?.done).toBe(true);
    expect(surroundings?.stateText).toBe("entfällt");
    expect(
      loadPercent(
        { buildings: 1, terrain: 1, light: 1, details: 1 },
        { surroundings: true }
      )
    ).toBe(100);
  });

  test("fractions outside 0..1 cannot push the bar past its ends", () => {
    expect(loadPercent({ buildings: -1 })).toBe(0);
    expect(loadPercent({ buildings: 5 })).toBe(30);
  });

  test("the headline follows the active stage, then the end state", () => {
    // Before the scene has reported anything, nothing is walkable yet — the
    // headline must not claim otherwise.
    expect(loadHeadline(loadStageStates({}))).toBe("Szene wird vorbereitet");
    expect(loadHeadline(loadStageStates({ buildings: 0.5 }))).toBe(
      "Gebäude werden geladen"
    );
    expect(
      loadHeadline(loadStageStates({ buildings: 1, terrain: 1, light: 1 }))
    ).toBe("Bereit — du kannst losgehen");
    const all = Object.fromEntries(LOAD_STAGES.map((s) => [s.id, 1]));
    expect(loadHeadline(loadStageStates(all))).toBe("Alles geladen");
    expect(activeStage(loadStageStates(all))).toBeNull();
  });

  test("the pill never claims more than the scene has loaded", () => {
    // The gap the loading screen does not have: the first frame is up, the
    // streaming tail has not started, so nothing is active and half the
    // layers are still to come.
    const firstFrame = loadStageStates({ buildings: 1, terrain: 1, light: 1 });
    expect(streamingTitle(firstFrame)).toBe("Rest wird geladen");
    expect(streamingTitle(loadStageStates({ surroundings: 0.5 }))).toBe(
      "Umgebung lädt"
    );
    const all = Object.fromEntries(LOAD_STAGES.map((s) => [s.id, 1]));
    expect(streamingTitle(loadStageStates(all))).toBe("Alles geladen");
  });

  test("the pill counts finished stages", () => {
    expect(stagesDoneLabel(loadStageStates({}))).toBe("0/5");
    expect(
      stagesDoneLabel(loadStageStates({ buildings: 1, terrain: 0.5 }))
    ).toBe("1/5");
  });
});
