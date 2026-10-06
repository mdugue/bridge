import { expect, test } from "bun:test";
import { isAllocationFailure } from "./gpu-allocation";

/** An error as Safari's DOMException carries it: a name and a message. */
const domError = (name: string, message: string) =>
  Object.assign(new Error(message), { name });

test("what Safari throws when an iPhone runs out of GPU memory is an allocation failure", () => {
  // three's createAttribute filling an empty mapping (CITY-WALK-6)
  expect(
    isAllocationFailure(
      new RangeError("Range consisting of offset and length are out of bounds")
    )
  ).toBe(true);
  // the GPU process gone (CITY-WALK-3/4) or a buffer it never made
  for (const message of [
    "GPUCommandEncoder.finish: Unable to finish.",
    "GPUDevice.createCommandEncoder: Unable to make command encoder.",
    "GPUDevice.createBuffer: Unable to create buffer.",
  ]) {
    expect(isAllocationFailure(domError("InvalidStateError", message))).toBe(
      true
    );
  }
  expect(
    isAllocationFailure(domError("OperationError", "mapping failed"))
  ).toBe(true);
  expect(
    isAllocationFailure(domError("GPUOutOfMemoryError", "Allocation failure."))
  ).toBe(true);
  // the page's own process out of room for an array
  expect(isAllocationFailure(new RangeError("Out of memory"))).toBe(true);
  expect(
    isAllocationFailure(new RangeError("Array buffer allocation failed"))
  ).toBe(true);
});

test("a RangeError from an allocating call counts by its stack", () => {
  const error = new RangeError("Source is too large");
  error.stack = "set@[native code]\ncreateAttribute@...\nupdate@...";
  expect(isAllocationFailure(error)).toBe(true);
});

test("bugs are not allocation failures", () => {
  expect(isAllocationFailure(new TypeError("x is undefined"))).toBe(false);
  expect(
    isAllocationFailure(new RangeError("Maximum call stack size exceeded"))
  ).toBe(false);
  expect(
    isAllocationFailure(domError("InvalidStateError", "The object is in use"))
  ).toBe(false);
  expect(isAllocationFailure(domError("AbortError", "aborted"))).toBe(false);
  expect(isAllocationFailure("Unable to create buffer")).toBe(false);
  expect(isAllocationFailure(null)).toBe(false);
});
