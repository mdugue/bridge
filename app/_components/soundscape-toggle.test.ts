import { expect, test } from "bun:test";
import { playableAudioContext } from "./soundscape-toggle";

class FullContext {
  createConstantSource() {
    return null;
  }
  createStereoPanner() {
    return null;
  }
}

/** Old Safari's context: no StereoPanner (nor ConstantSource). */
class PrefixedContext {}

test("sound turns on only where the engine can play", () => {
  const full = FullContext as unknown as typeof AudioContext;
  expect(playableAudioContext({ AudioContext: full })).toBe(full);
  expect(
    playableAudioContext({
      AudioContext: PrefixedContext as unknown as typeof AudioContext,
    })
  ).toBeNull();
  // no unprefixed context at all: the prefixed one is never taken
  expect(playableAudioContext({})).toBeNull();
});
