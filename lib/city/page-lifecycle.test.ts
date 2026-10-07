import { describe, expect, test } from "bun:test";
import type { GpuLoss } from "./gpu-safety";
import {
  createPageLifecycle,
  type LifecycleEffect,
  type LifecycleSignal,
} from "./page-lifecycle";

const GAP = 5000;
const HOLD = 120_000;

function machine(reloads = true, hiddenAt: number | null = null) {
  const asked: GpuLoss[] = [];
  const lifecycle = createPageLifecycle({
    emergencyGapMs: GAP,
    shadowHoldMs: HOLD,
    mayReload: (how) => {
      asked.push(how);
      return reloads;
    },
    hiddenAt,
  });
  return { lifecycle, asked };
}

/** The effects as the trail would read them: kinds, notes by event. */
const shape = (effects: LifecycleEffect[]): string[] =>
  effects.map((e) => {
    if (e.kind === "note") {
      return `note(${e.event})`;
    }
    if (e.kind === "reload") {
      return `reload(${e.how})`;
    }
    if (e.kind === "fatal") {
      return `fatal(${e.beforeFirstFrame ? "boot" : "card"})`;
    }
    return e.kind;
  });
const lost = (now: number, hidden = false): LifecycleSignal => ({
  kind: "deviceLost",
  message: "Device was lost",
  now,
  hidden,
});
const frame = (
  now: number,
  signs: { allocation?: boolean; answers?: boolean; hidden?: boolean } = {}
): LifecycleSignal => ({
  kind: "frameFailed",
  message: "boom",
  where: "at render",
  allocation: signs.allocation ?? false,
  gpuAnswers: () => signs.answers ?? true,
  now,
  hidden: signs.hidden ?? false,
});
const alloc = (now: number, hidden = false): LifecycleSignal => ({
  kind: "allocationFailed",
  reason: "allocation compile",
  now,
  hidden,
});

describe("page lifecycle: the incident sequences", () => {
  test("a device lost in use with a reload: stop, note, reload once", () => {
    const { lifecycle, asked } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    const effects = lifecycle.dispatch(lost(60_000));
    expect(shape(effects)).toEqual([
      "stopRender",
      "note(render stopped)",
      "note(reloading)",
      "reload(lost)",
    ]);
    expect(effects[1]).toEqual({
      kind: "note",
      event: "render stopped",
      detail: "Device was lost",
    });
    expect(effects[2]).toEqual({
      kind: "note",
      event: "reloading",
      detail: "to recover the GPU (lost)",
    });
    expect(lifecycle.stopped).toBe(true);
    expect(lifecycle.dispatch(lost(60_100))).toEqual([]);
    expect(asked).toEqual(["lost"]);
  });

  test("a frame that fails after the stop notes nothing", () => {
    const { lifecycle } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    lifecycle.dispatch(lost(60_000));
    let probed = false;
    const late: LifecycleSignal = {
      kind: "frameFailed",
      message: "boom",
      where: "at render",
      allocation: false,
      gpuAnswers: () => {
        probed = true;
        return true;
      },
      now: 60_200,
      hidden: false,
    };
    expect(lifecycle.dispatch(late)).toEqual([]);
    expect(lifecycle.dispatch(frame(60_300))).toEqual([]);
    expect(probed).toBe(false);
  });

  test("a recovery that throws stops the render and says the GPU failed", () => {
    const lifecycle = createPageLifecycle({
      emergencyGapMs: GAP,
      shadowHoldMs: HOLD,
      mayReload: () => {
        throw new Error("capture failed");
      },
    });
    lifecycle.dispatch({ kind: "firstFrame" });
    const effects = lifecycle.dispatch(lost(60_000));
    expect(shape(effects)).toEqual([
      "stopRender",
      "note(render stopped)",
      "note(recovery failed)",
      "note(gpu failed)",
      "fatal(card)",
    ]);
    expect(effects[2]).toEqual({
      kind: "note",
      event: "recovery failed",
      detail: "capture failed",
    });
    expect(lifecycle.stopped).toBe(true);
    expect(lifecycle.dispatch(frame(60_100))).toEqual([]);
  });

  test("a device lost while hidden is reclaimed", () => {
    const { lifecycle } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    expect(shape(lifecycle.dispatch(lost(60_000, true)))).toEqual([
      "stopRender",
      "note(render stopped)",
      "note(gpu reclaimed)",
      "note(reloading)",
      "reload(reclaimed)",
    ]);
  });

  test("a device lost soon after a return from a long absence is reclaimed", () => {
    const { lifecycle } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    expect(
      lifecycle.dispatch({ kind: "hidden", wall: 0, phone: true })
    ).toEqual([{ kind: "shed" }, { kind: "applyStep" }]);
    expect(
      lifecycle.dispatch({
        kind: "shown",
        wall: 20_000,
        now: 100,
        gpuFailure: () => null,
      })
    ).toEqual([{ kind: "applyStep" }]);
    expect(lifecycle.lossNow(2000, false)).toBe("reclaimed");
    expect(shape(lifecycle.dispatch(lost(2000)))).toContain(
      "reload(reclaimed)"
    );
  });

  test("a short glance away does not open the resume window", () => {
    const { lifecycle } = machine();
    lifecycle.dispatch({ kind: "hidden", wall: 0, phone: false });
    lifecycle.dispatch({
      kind: "shown",
      wall: 3000,
      now: 100,
      gpuFailure: () => null,
    });
    expect(lifecycle.lossNow(2000, false)).toBe("lost");
  });

  test("a failed frame on a working GPU is a bug: a same-level reload", () => {
    const { lifecycle, asked } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    const effects = lifecycle.dispatch(frame(60_000));
    expect(shape(effects)).toEqual([
      "note(frame failed)",
      "stopRender",
      "note(render stopped)",
      "note(reloading)",
      "reload(failed)",
    ]);
    expect(shape(effects)).not.toContain("raiseSafety");
    expect(asked).toEqual(["failed"]);
  });

  test("a failed frame on a GPU that no longer answers is a loss", () => {
    const { lifecycle } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    expect(
      shape(lifecycle.dispatch(frame(60_000, { answers: false })))
    ).toContain("reload(lost)");
  });

  test("an emergency, then a failed frame: a loss, raised once", () => {
    const { lifecycle } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    const emergency = lifecycle.dispatch(alloc(60_000));
    expect(shape(emergency)).toEqual([
      "note(memory emergency)",
      "governorForce",
      "shed",
      "applyStep",
      "holdShadows",
      "raiseSafety",
    ]);
    expect(emergency[4]).toEqual({
      kind: "holdShadows",
      untilNow: 60_000 + HOLD,
    });
    expect(lifecycle.emergencyBefore).toBe(true);
    let probed = false;
    const effects = lifecycle.dispatch({
      ...frame(90_000),
      gpuAnswers: () => {
        probed = true;
        return true;
      },
    } as LifecycleSignal);
    expect(shape(effects)).toContain("reload(lost)");
    expect(probed).toBe(false);
    const raises = [...emergency, ...effects].filter(
      (e) => e.kind === "raiseSafety"
    );
    expect(raises).toHaveLength(1);
  });

  test("allocation failures within the gap are one emergency, and raise once a page", () => {
    const { lifecycle } = machine();
    expect(lifecycle.dispatch(alloc(60_000))).not.toEqual([]);
    expect(lifecycle.dispatch(alloc(61_000))).toEqual([]);
    const later = lifecycle.dispatch(alloc(70_000));
    expect(shape(later)).toContain("note(memory emergency)");
    expect(shape(later)).not.toContain("raiseSafety");
  });

  test("an allocation failure while hidden is the reclaim's symptom: no raise", () => {
    const { lifecycle } = machine();
    expect(shape(lifecycle.dispatch(alloc(60_000, true)))).not.toContain(
      "raiseSafety"
    );
  });

  test("a failed frame before the first frame fails the boot", () => {
    const { lifecycle } = machine(false);
    const effects = lifecycle.dispatch(frame(1000, { allocation: true }));
    expect(shape(effects)).toEqual([
      "note(frame failed)",
      "stopRender",
      "note(render stopped)",
      "note(gpu failed)",
      "fatal(boot)",
    ]);
    expect(effects.at(-1)).toEqual({
      kind: "fatal",
      message: "boom",
      beforeFirstFrame: true,
    });
    expect(effects.at(-2)).toEqual({
      kind: "note",
      event: "gpu failed",
      detail: "lost: boom",
    });
  });

  test("without a reload after the first frame: the failure card", () => {
    const { lifecycle } = machine(false);
    lifecycle.dispatch({ kind: "firstFrame" });
    expect(shape(lifecycle.dispatch(lost(60_000))).at(-1)).toBe("fatal(card)");
  });

  test("a disposed page stops after the notes: no reload, no fatal", () => {
    const { lifecycle, asked } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    lifecycle.dispatch({ kind: "dispose" });
    expect(lifecycle.dispatch(alloc(60_000))).toEqual([]);
    expect(shape(lifecycle.dispatch(lost(60_000, true)))).toEqual([
      "stopRender",
      "note(render stopped)",
      "note(gpu reclaimed)",
    ]);
    expect(asked).toEqual([]);
  });

  test("hidden on a phone sheds; on a desktop it keeps its cache", () => {
    expect(
      machine().lifecycle.dispatch({ kind: "hidden", wall: 0, phone: true })
    ).toEqual([{ kind: "shed" }, { kind: "applyStep" }]);
    expect(
      machine().lifecycle.dispatch({ kind: "hidden", wall: 0, phone: false })
    ).toEqual([]);
  });

  test("shown on a GPU taken meanwhile: a reclaim, probed once", () => {
    const { lifecycle } = machine();
    lifecycle.dispatch({ kind: "firstFrame" });
    const effects = lifecycle.dispatch({
      kind: "shown",
      wall: 1000,
      now: 1000,
      gpuFailure: () => "InvalidStateError",
    });
    expect(shape(effects)).toEqual([
      "applyStep",
      "stopRender",
      "note(render stopped)",
      "note(gpu reclaimed)",
      "note(reloading)",
      "reload(reclaimed)",
    ]);
    let probed = false;
    expect(
      lifecycle.dispatch({
        kind: "shown",
        wall: 2000,
        now: 2000,
        gpuFailure: () => {
          probed = true;
          return null;
        },
      })
    ).toEqual([]);
    expect(probed).toBe(false);
  });

  test("a page that starts hidden measures its absence from the start", () => {
    const { lifecycle } = machine(true, 0);
    lifecycle.dispatch({
      kind: "shown",
      wall: 15_000,
      now: 500,
      gpuFailure: () => null,
    });
    expect(lifecycle.lossNow(1000, false)).toBe("reclaimed");
  });
});
