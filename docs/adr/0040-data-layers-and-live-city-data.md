# ADR 0040: Data layers are switches, off at start, drawn as glass; optional features start on first use

- **Status:** accepted
- **Date:** 2026-10

## Context

The city's traffic — counted motor traffic, live bicycle counters, trams
by timetable — is worth showing, but not in the default picture, and not
at a cost to visitors who never look. The bicycle counters are the first
runtime read from a server other than the site's own.

## Decision

1. **Each source is a data layer with its own switch**, declared once in
   `lib/city/data-layers.ts`, held as a boolean in the look store (so the
   Snapshot carries it). Every layer starts off; a layer that is off draws
   and fetches nothing. Counts and explanations are in the sidebar, never
   as text in the scene.
2. **Each layer's data where it lives:** motor traffic baked per tile on
   both terrain levels; the bicycle counters read by the browser from the
   city's server while the layer is on; the trams from a timetable baked
   once per site and placed by the scene's clock — the HUD says they are
   not live positions.
3. **The look is tinted glass and light, not paint**: one colour family per
   layer, refracting one copy of the frame (`glass.ts`), never
   `transmission`. No layer casts a shadow. From the air they widen by one
   shared uniform.
4. **Optional features start on first use** and hear the spine through its
   hooks (`feature-seam.ts`: frame, stream change, look store, clock). The
   data layers are the first such feature. While a feature imports
   three.js its code ships in the scene's chunk, not behind `import()`.

## Consequences

- A new live source is fetched only after a switch-on, said on
  `/datenschutz`, and answered by the e2e for CI.
- A new optional feature registers on the seam, not in `create-app.ts`.

## Alternatives

- **Baking the bicycle counts:** the live count is the point.
- **A proxy for the city's service:** a backend for a GET the browser can
  make itself.
- **Live tram positions:** too heavy to poll from a browser, or a service
  whose uptime the viewer cannot vouch for.
- **Pedestrian density from a model:** a model drawn as if measured.
- **Flat painted bands:** a stripe of paint on foot, fighting the markings.
- **Data layers as sliders:** a slider at 0 still builds and draws.
- **Each feature behind `import()`:** three.js lost its scope hoisting; the
  first load grew instead of shrinking.
