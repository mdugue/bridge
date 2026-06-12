/**
 * Structural stand-in for THREE.Matrix4 so this module stays three-free.
 * `elements` is column-major; the translation lives at indices 12/13/14.
 */
export interface MatrixLike {
  elements: ArrayLike<number>;
}

/**
 * The CityJSON loader recenters the model with a pure-translation matrix
 * (translate by (-cx, -cy, 0), Z untouched). This extracts the (cx, cy)
 * recenter offset so other layers (terrain, inserted models) can subtract
 * the exact same offset and share the city's local origin.
 */
export function recenterOffset(matrix: MatrixLike): { cx: number; cy: number } {
  return { cx: -matrix.elements[12], cy: -matrix.elements[13] };
}
