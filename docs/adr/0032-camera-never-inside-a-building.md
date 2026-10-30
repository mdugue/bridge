# ADR 0032: The camera is never below the ground or inside a building

- **Status:** accepted
- **Date:** 2026-09

## Context

Every way the camera moved checked something different, or nothing:
flying went through blocks and into hillsides, a scenic glide cut through
towers, a double tap on a facade landed inside, and a snapshot, a minimap
click or a GPS fix put the camera wherever it was told. Seen from inside,
the clay shows the back of every wall at once.

## Decision

One invariant, enforced by the one owner of the pose
(`app/_components/camera-pose.ts`): after every step and every jump the
camera is at least 0.5 m over the ground and outside every building, and a
glide's path is planned to stay so.

- **Inside** is a vertical ray: from inside a closed solid the first
  surface straight above is a roof seen from within.
- **A walker is set out, a flyer lifted:** on foot to the nearest free spot
  past the facade (`lib/city/clearance.ts`), in the air over the roof.
- **Flying meets facades like walking does.**
- **A glide climbs over what lies between** its two poses; whatever lands
  during it is caught frame by frame.

## Consequences

- A new way to move the camera goes through `camera-pose.ts`; nothing else
  sets `camera.position`.
- Only buildings and the terrain are solids; walls, fences, trees and
  furniture are not.
