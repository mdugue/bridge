/**
 * Whether an error a compile, an upload or a frame threw is the GPU (or the
 * page's process) failing to give memory — as opposed to a bug. What Safari
 * on an iPhone throws through three.js r186 when it runs out:
 *
 * - a RangeError "Range consisting of offset and length are out of
 *   bounds" from three's createAttribute: it fills a buffer made with
 *   `mappedAtCreation`, and WebKit hands back an empty mapping when the
 *   buffer could not be allocated (or the device is gone); a RangeError
 *   for a typed array or ArrayBuffer the page's process could not make;
 * - an InvalidStateError "… Unable to …" ("Unable to create buffer",
 *   "Unable to make command encoder", "Unable to finish"): WebKit's word
 *   for a request the GPU process never got, the connection to it gone;
 * - an OperationError (a mapping that failed), and WebGPU's own
 *   GPUOutOfMemoryError.
 *
 * Read from the error's name, message and stack only: a WebKit
 * DOMException is not always an `Error` across realms.
 */
export function isAllocationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { name, message, stack } = error as {
    message?: unknown;
    name?: unknown;
    stack?: unknown;
  };
  const text = typeof message === "string" ? message : "";
  const trace = typeof stack === "string" ? stack : "";
  switch (name) {
    case "RangeError":
      return OUT_OF_ROOM.test(text) || GPU_CALLS.test(trace);
    case "InvalidStateError":
      return /unable to/i.test(text);
    case "OperationError":
    case "GPUOutOfMemoryError":
      return true;
    default:
      return /out of memory/i.test(text);
  }
}

/** A RangeError's words for memory that could not be had. */
const OUT_OF_ROOM =
  /out of bounds|out of memory|allocation fail|array buffer allocation|invalid (typed )?array (buffer )?length/i;

/** The three.js and WebGPU calls that allocate, in a RangeError's stack. */
const GPU_CALLS =
  /createAttribute|createIndexAttribute|getMappedRange|createBuffer|createTexture|writeBuffer|writeTexture/;
