"""The paving and parking raster (pipeline/bake/surface.py): which way a
paving runs, where a bay or a lot is painted, and the path defaults."""

import re
from pathlib import Path

import numpy as np
import shapely
from PIL import Image

from bake import surface
from bake.common import Tile

ROOT = Path(__file__).resolve().parents[2]


# --- B23 parking ------------------------------------------------------------


def _code(kind: int, place: int, marked: bool) -> int:
    return surface.parking_code(kind, place, marked)


def test_street_bays_are_painted_only_where_osm_says():
    lane = '"parking:right"=>"lane","parking:right:orientation"=>"parallel"'
    assert surface.parking_side(lane, "right") == _code(1, 0, False)
    marked = lane + ',"parking:right:markings"=>"yes"'
    assert surface.parking_side(marked, "right") == _code(1, 0, True)
    angled = '"parking:both"=>"on_kerb","parking:both:orientation"=>"diagonal"'
    assert surface.parking_side(angled, "left") == _code(2, 2, False)
    half = '"parking:left"=>"half_on_kerb"'
    assert surface.parking_side(half, "left") == _code(1, 1, False)
    # the old scheme: `marked` and `painted_area_only` are paint
    old = '"parking:lane:right"=>"parallel","parking:lane:right:parallel"=>"half_on_kerb"'
    assert surface.parking_side(old, "right") == _code(1, 1, False)
    assert surface.parking_side('"parking:lane:both"=>"marked"', "right") == _code(1, 0, True)
    assert surface.parking_side('"parking:right"=>"no"', "right") == 0


def test_a_lot_is_painted_unless_it_says_not_or_is_unpaved():
    assert surface.lot_code("parking", None) == _code(3, 0, True)
    assert surface.lot_code("parking", '"markings"=>"no"') == _code(3, 0, False)
    assert surface.lot_code("parking", '"surface"=>"gravel"') == _code(3, 0, False)
    assert surface.lot_code("parking", '"parking"=>"street_side"') == _code(3, 0, False)
    side = '"parking"=>"street_side","markings"=>"yes"'
    assert surface.lot_code("parking", side) == _code(3, 0, True)


def test_the_a_byte_packs_the_offset_place_and_paint():
    along = np.array([[0, 0x1ABC, 0x1FFF]], np.uint16)
    park = np.array([[0, _code(1, 2, True), surface.CLEARED]], np.uint8)
    low, high = surface.pack_along(along, park)
    assert low.tolist() == [[0, 0xBC, 0xFF]]
    assert high[0, 0] == 0
    assert high[0, 1] == 0x1A | 2 << 5 | 0x80
    assert high[0, 2] == 0x1F  # a cleared aisle: no place, no paint
    ts = (ROOT / "lib" / "city" / "landcover.ts").read_text()
    client = re.search(r"export const SURFACE_ALONG_BITS = (\d+)", ts)
    assert client is not None and int(client.group(1)) == surface.ALONG_BITS


# --- B22 sidewalk bands -----------------------------------------------------


def test_a_sidewalk_band_reaches_to_the_building_at_most_8_m():
    line = shapely.LineString([(0, 0), (40, 0)])
    near = shapely.box(0, 3 + 5, 40, 20)  # 5 m past a 3 m half-width, north (left)
    tree = shapely.STRtree([near])
    quads = surface.band_depths(line, 3.0, 1.0, tree)
    assert quads
    _, ymin, _, ymax = shapely.union_all(quads).bounds
    assert abs(ymin - 3.0) < 0.05 and abs(ymax - 8.0) < 0.3
    far = shapely.STRtree([shapely.box(0, 30, 40, 40)])
    _, _, _, ymax = shapely.union_all(surface.band_depths(line, 3.0, 1.0, far)).bounds
    assert abs(ymax - (3.0 + surface.SIDEWALK_BAND)) < 0.3


# --- B20 path defaults ------------------------------------------------------


def test_path_defaults_asphalt_in_town_unpaved_outside(tmp_path, monkeypatch):
    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    cls = np.zeros((400, 400), np.uint8)
    cls[:, 100:104] = 6  # a north-south path at x = 50 … 52
    (tmp_path / "data" / "dlm").mkdir(parents=True)
    Image.fromarray(cls).save(tmp_path / "data" / "dlm" / "landcover_t.png")
    town = shapely.box(x0, y0 + 100, x0 + 200, y0 + 200)  # the north half
    monkeypatch.setattr(surface, "settlement", lambda t: [town])
    monkeypatch.setattr(surface, "dlm_path_surfaces", lambda t: [])
    kind = surface.path_defaults(tile, 200)
    asphalt, unpaved = surface.SURFACE_OF["asphalt"], surface.SURFACE_OF["unpaved"]
    assert kind[20, 51] == asphalt and kind[180, 51] == unpaved
    assert kind[20, 10] == 0  # not a path
    bef = shapely.box(x0 + 40, y0 + 150, x0 + 60, y0 + 190)
    monkeypatch.setattr(surface, "dlm_path_surfaces", lambda t: [(bef, unpaved)])
    assert surface.path_defaults(tile, 200)[30, 51] == unpaved  # the DLM's BEF wins


# --- B19 the arable class ----------------------------------------------------


def test_a_field_frame_runs_along_its_long_axis():
    frames = surface.Frames()
    surface.add_long_axis(frames, shapely.box(0, 0, 300, 40))
    assert abs(np.sin(frames.bearing[0])) < 1e-9  # east-west
    surface.add_long_axis(frames, shapely.Point(0, 0).buffer(0))  # empty: none
    assert len(frames.bearing) == 1
