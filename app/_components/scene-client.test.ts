/**
 * scene-client.ts: how a scene worker's error before its hello is read —
 * a script or chunk that did not arrive is the network's.
 */
import { describe, expect, test } from "bun:test";
import { errorOutcome } from "./scene-client";

describe("errorOutcome", () => {
  test("a bare error event before alive: the script did not load", () => {
    expect(errorOutcome(false, undefined)).toBe("unloaded");
    expect(errorOutcome(false, "")).toBe("unloaded");
  });

  test("a chunk the bootstrap's importScripts could not fetch", () => {
    expect(
      errorOutcome(
        false,
        "Uncaught NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'https://x/_next/static/chunks/a.js' failed to load."
      )
    ).toBe("unloaded");
  });

  test("an exception before alive threw", () => {
    expect(errorOutcome(false, "Uncaught TypeError: x is undefined")).toBe(
      "threw"
    );
  });

  test("anything after alive threw", () => {
    expect(errorOutcome(true, undefined)).toBe("threw");
    expect(errorOutcome(true, "Uncaught NetworkError: failed to load")).toBe(
      "threw"
    );
  });
});
