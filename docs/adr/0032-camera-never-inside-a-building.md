# ADR 0032: The camera is never below the ground or inside a building

- **Status:** accepted
- **Date:** 2026-09-26

## Context

Every way the camera could move checked something different, or nothing:
walking collided with facades and followed the terrain, but flying was
deliberately collision-free (straight through a block, into a hillside
when flying level over rising ground), a scenic glide lerped in a straight
line bowed by at most 12 % of its length (through a tower close to either
end), a double tap marched the ground only (a tap on a facade hit the
ground behind it — inside the building), and a snapshot, a minimap click,
a GPS fix taken indoors or a building tile landing where the player
stood put the camera wherever it was told. Seen from inside, the clay has
no inside: the view shows the back of every wall at once.

## Decision

One invariant, enforced in the one owner of the pose
(`app/_components/camera-pose.ts`): **after every step and every jump the
camera is at least 0.5 m over the ground and outside every building**, and
a scenic glide's path is planned to keep it so on the way.

- **Inside** is a vertical ray: from a point inside a closed solid, the
  first surface straight above is a roof seen from within — its face looks
  up. From under a bridge or a balcony it looks down. The ray runs through
  the tile's existing BVH on both face sides (`collision.ts` `roofAbove`;
  the clay material is front-sided, so the stock raycast would not see a
  roof from inside). On the baked LoD2 of all fifteen tiles, 99.6–99.97 %
  of points 0.8 m under a roof test inside, none above one.
- **A walker is set out, a flyer lifted.** On foot (walk mode, a teleport,
  a walk viewpoint, a GPS fix) the camera moves to the nearest spot where
  knees and eyes are both outside, one metre past the facade
  (`lib/city/clearance.ts` `nearestFree`, rings of growing radius); nowhere
  within 150 m, it takes off. In the air it is lifted over the roof
  (`clearHeight`, stacked parts one after the other).
- **Flying meets facades like walking does** (`resolveStep` in fly mode);
  over the roofs it has nothing to meet. Sinking and flying over rising
  ground stop at the clearance.
- **A glide climbs over what lies between** its two poses: at its start it
  samples the highest roof or ground every 2 m along the line and lifts the
  path to the upper concave hull of what it needs (`glideHull`), never
  below the old bow. Anything that landed since (a tile streamed in during
  a long glide) is caught frame by frame by the same guard.
- **A double tap on a building** travels to its foot on the camera's side.

## Consequences

- No pose, whichever its origin, renders from inside a building or below
  the terrain; a new way to move the camera inherits the rule by going
  through `camera-pose.ts` — do not set `camera.position` elsewhere.
- Flying is no longer collision-free: a QA pose inside a block is lifted
  over its roof. The shots harness's snapshots are all outside.
- Cost: two or three vertical rays per frame against the meshes whose world
  box holds the camera, and up to 480 at a glide's start.
- Only buildings and the terrain are solids. Walls, fences, trees and the
  street furniture are not (the walker already passes them).
