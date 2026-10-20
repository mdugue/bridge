"""The ground traffic runs on — the carriageways and the track beds — where
no tree stands.

Not the transport land the class raster paints as road (7) and railway (5):
those are the DLM's parcels, which reach the fences and hold the station
forecourts, the embankments, the verges and the junction islands, with their
trees. Vetoed by class, every tree there was lost — on Leipzig's four tiles
5 % of the crown cover the surface model shows, 6.9 % of what the model
left out; Dresden 1.6 % and 3.9 %.

- carriageways: with a Basis-DLM its road centrelines at their surveyed
  width (`landcover.road_buffers`, the same buffers the class raster
  burns); without one OSM's roads at the class raster's widths
  (`landcover_osm.road_buffers`);
- track beds: the baked rails (`rail_<tile>.geojson`, the DLM's or OSM's,
  with their track count) and every OSM track above ground — sidings, the
  yards' fans, trams in their own bed — one track bed wide each.

Every way grows by MARGIN_M: a crown's peak stands that far clear of the
kerb or the ballast's edge at least."""

from __future__ import annotations

import json

import shapely
import shapely.geometry

from . import landcover, landcover_osm
from .common import Tile, column
from .osm import below_ground, has_extract, read_osm

TRACK_HALF_M = 2.5  # one track's bed, half its width (m)
TRACK_STEP_M = 2.25  # each further track beside it: half the 4.5 m spacing
OSM_TRACKS = ("rail", "light_rail", "narrow_gauge", "subway", "tram", "funicular")
MARGIN_M = 0.5


def track_beds(tile: Tile) -> list[shapely.Geometry]:
    out = []
    baked = tile.out("dlm", f"rail_{tile.id}.geojson")
    if baked.exists():
        for f in json.loads(baked.read_text())["features"]:
            tracks = int((f["properties"] or {}).get("tracks") or 1)
            line = shapely.geometry.shape(f["geometry"])
            out.append(shapely.buffer(line, TRACK_HALF_M + TRACK_STEP_M * (tracks - 1)))
    if has_extract(tile, "the track beds"):
        kinds = ", ".join(f"'{k}'" for k in OSM_TRACKS)
        geoms, fields = read_osm(tile, "lines", f"railway IN ({kinds})", ["other_tags"])
        for g, other in zip(geoms, column(fields, "other_tags", geoms), strict=True):
            if g is not None and not g.is_empty and not below_ground(other):
                out.append(shapely.buffer(g, TRACK_HALF_M))
    return out


def carriageways(tile: Tile) -> list[shapely.Geometry]:
    if tile.products.dlm:
        return landcover.road_buffers(tile)
    return landcover_osm.road_buffers(tile) if has_extract(tile, "the carriageways") else []


def traffic(tile: Tile) -> list[shapely.Geometry]:
    """The carriageways and track beds, each grown by MARGIN_M."""
    return [
        shapely.buffer(g, MARGIN_M)
        for g in (*carriageways(tile), *track_beds(tile))
        if g is not None and not g.is_empty
    ]
