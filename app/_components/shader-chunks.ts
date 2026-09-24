/**
 * The data-frame position (x east, y north, z up, recentered) of a vertex,
 * from world space, as `dataPos` (and `dataWP`, the world position). The
 * streamed glTF positions are quantised with the dequantisation on the node,
 * so `position` is not in metres — but the viewer's `world` group only
 * rotates −90° about X, so world (x, y, z) is data (x, −z, y) exactly. Use
 * it after `#include <begin_vertex>` (it reads `transformed`).
 */
export const DATA_POSITION = /* glsl */ `
  vec4 dataWP = modelMatrix * vec4( transformed, 1.0 );
  vec3 dataPos = vec3( dataWP.x, -dataWP.z, dataWP.y );
`;
