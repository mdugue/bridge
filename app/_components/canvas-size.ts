/**
 * The size the canvas is set to when its container resizes, or null when
 * the container has no area (a minimised or collapsed window, a layout
 * pass that briefly gives it 0 × 0). Sizing the renderer to nothing makes
 * WebGPU create a 0 × 0 swap chain and depth buffer, which fail validation
 * and poison the frames after them (Sentry CITY-WALK-H, -K and their
 * aftermath); keeping the last size until the container has area again
 * costs nothing.
 */
export function canvasSizeFor(container: {
  clientWidth: number;
  clientHeight: number;
}): { width: number; height: number } | null {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}
