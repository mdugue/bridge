# ADR 0060: Glass fronts are read from street photos by an open image model, offline

- **Status:** accepted
- **Date:** 2026-11

## Context

A building draws as glass — the cool sheen, the sky in it, no drawn
windows — only where OSM maps `building:material=glass`: 29 objects in
Dresden. The Congress Center, a glass hall, is not tagged and drew a grid
of punched windows. The street photos see such fronts, but nothing the
facade profiles measure (facade_traits.py) tells a curtain wall from a
wall with windows: the openings' share reads a stucco house at 0.99, and
the edge grid, the plaster's share and its colour overlap too. And the
panoramas the profiles read are a car's: they rarely see a glass front set
back behind a plaza or a forecourt; the ordinary photos people take there
do.

## Decision

1. **An open image model reads glass**: CLIP (OpenAI's ViT-B/32, MIT, as
   ONNX), comparing each rectified upper wall with "a glass facade" and "a
   wall with windows". A wall is glass where most of at least two photos
   that see a quarter of it say so with 0.95 or more; an object is glass
   where its walls read as glass make half the length read and a quarter
   of all its outer walls, or 15 m and a twentieth of them. Never a rule for a named
   building.
2. **Every camera is read for it**, panoramas and framed photos
   (perspective, Brown, fisheye) alike, within 60 m of the wall and with
   the wall in the frame. The other facade traits stay the panoramas'.
   A photo Mapillary never segmented is read too, on the wall the
   geometry puts in it, where the model takes the crop for a facade rather
   than sky, trees or a street.
3. **The model runs only at fetch time**, in the pipeline (`onnxruntime`,
   `tokenizers`): downloaded beside the raw data, pinned by commit and
   SHA-256, never committed, never in the viewer. What reaches the bake is
   one probability per photo and wall in the fetch cache.
4. **The photos' glass is the material only where no source names one**
   (OSM, Wikidata); the card says it was detected in street photos.

## Consequences

- A glass front draws as OSM's glass does, with no window grid on it;
  the inquiry card names Mapillary as its source.
- A fetch needs ~0.6 GB more disk for the model and reads more photos per
  tile; the bake stays deterministic on the cached readings.
- A changed prompt or model changes the readings: the fetch cache is
  named by a hash of what a reading depends on (`reading_key`), and the
  prompts' embeddings are keyed by their hash.
- Rejected: the facade profiles' openings share, edge grids and colour
  (they do not separate glass from stucco); a model run in the browser
  (phone memory, ADR 0047).
