/** True when this browser can create a WebGL2 context (the one hard requirement). */
export function hasWebGl2(): boolean {
  try {
    const probe = document.createElement("canvas");
    return probe.getContext("webgl2") !== null;
  } catch {
    return false;
  }
}
