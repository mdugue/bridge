"""Units of the bakes that need no raw data (the end-to-end comparison
against the committed artifacts is in docs/data-pipeline.md)."""

import shapely

from bake.common import owns, round_coords
from bake.landcover import CLASSES
from bake.osm import tag
from bake.rail import buffer_line, is_platform, merge_lines
from bake.walls import height, lines_of


def test_fragments_merge_across_shared_endpoints_to_the_metre():
    a = [(0.0, 0.0), (10.0, 0.0)]
    b = [(20.0, 0.0), (10.4, 0.2)]  # reversed, endpoint within the 1 m snap
    c = [(100.0, 0.0), (110.0, 0.0)]
    merged = merge_lines([a, b, c])
    assert len(merged) == 2
    chain = max(merged, key=len)
    assert {chain[0], chain[-1]} == {(0.0, 0.0), (20.0, 0.0)}


def test_a_centreline_buffers_into_a_closed_deck_outline():
    ring = buffer_line([(0.0, 0.0), (10.0, 0.0)], 2.0)
    assert len(ring) == 4
    assert shapely.Polygon(ring).area == 40.0


def test_wall_heights_come_from_the_tags_clamped():
    assert height('"height"=>"4 m"') == 4.0
    assert height('"est_height"=>"99"') == 30.0
    assert height(None) is None
    assert tag('"bridge:structure"=>"arch","x"=>"1"', "bridge:structure") == "arch"


def test_wall_polygons_contribute_their_outer_ring_only():
    square = shapely.Polygon(
        [(0, 0), (1, 0), (1, 1), (0, 1)], holes=[[(0.2, 0.2), (0.4, 0.2), (0.4, 0.4)]]
    )
    rings = lines_of(square)
    assert len(rings) == 1
    assert rings[0].is_ring


def test_coordinates_round_to_centimetres_and_drop_z():
    assert round_coords([[1.234, 5.678, 9.0]]) == [[1.23, 5.68]]


def test_the_class_ids_are_the_client_palette_order():
    # lib/city/landcover.ts keys its palette by these ids and names.
    assert list(CLASSES) == list(range(9))
    assert CLASSES[8] == "water"


def test_rail_without_a_dlm_leaves_committed_files_alone(tmp_path):
    from bake import rail
    from bake.common import Tile

    out = tmp_path / "data" / "dlm"
    out.mkdir(parents=True)
    committed = out / "rail_t.geojson"
    committed.write_text('{"features": [1]}')
    tile = Tile("t", (0.0, 0.0, 2000.0, 2000.0), 25833, tmp_path / "raw", tmp_path / "data")
    rail.run(tile)
    assert committed.read_text() == '{"features": [1]}'
    assert sorted(p.name for p in out.iterdir()) == ["rail_t.geojson"]


def test_a_polygon_clipped_away_yields_no_wall():
    clipped = shapely.intersection(shapely.box(10, 10, 11, 11), shapely.box(0, 0, 1, 1))
    assert lines_of(clipped) == []


def test_platforms_come_from_railway_or_public_transport_on_a_railway():
    assert is_platform("platform", None)
    assert is_platform(None, '"railway"=>"platform"')
    assert is_platform(None, '"public_transport"=>"platform","railway"=>"platform_edge"')
    assert not is_platform(None, '"public_transport"=>"platform","highway"=>"bus_stop"')
    assert not is_platform(None, None)


def test_a_point_on_a_seam_belongs_to_one_tile():
    west = (410_000.0, 5_656_000.0, 412_000.0, 5_658_000.0)
    east = (412_000.0, 5_656_000.0, 414_000.0, 5_658_000.0)
    assert not owns(west, 412_000.0, 5_657_000.0)
    assert owns(east, 412_000.0, 5_657_000.0)
    assert not owns(east, 411_950.0, 5_657_000.0)


def _osm_tile(tmp_path, monkeypatch, ways: str):
    """A 200 m tile with a DGM that rises 4 m between y = 80 and y = 100 and
    an OSM XML extract holding `ways` over nodes 1–6: the flight's ends (1, 2),
    and the corners of a 6 m × 30 m outline around it (3–6)."""
    import numpy as np
    import rasterio
    from pyproj import Transformer

    from bake.common import Tile

    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    tile.dgm.parent.mkdir(parents=True)
    rows = np.arange(200)[:, None] + 0.5  # row 0 = north
    y = 200 - rows
    z = np.broadcast_to(100 + 4 * np.clip((y - 80) / 20, 0, 1), (200, 200)).astype("float32")
    with rasterio.open(
        tile.dgm,
        "w",
        driver="GTiff",
        width=200,
        height=200,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=tile.transform(200),
    ) as dst:
        dst.write(z, 1)
    back = Transformer.from_crs(25833, 4326, always_xy=True)
    pts = [(100, 105), (100, 75), (97, 75), (103, 75), (103, 105), (97, 105)]
    nodes = "".join(
        f'<node id="{i + 1}" lat="{lat:.9f}" lon="{lon:.9f}" version="1"/>'
        for i, (px, py) in enumerate(pts)
        for lon, lat in [back.transform(x0 + px, y0 + py)]
    )
    osm = tmp_path / "raw" / "osm" / "t.osm"
    osm.parent.mkdir(parents=True)
    osm.write_text(f'<?xml version="1.0"?><osm version="0.6">{nodes}{ways}</osm>')
    monkeypatch.setattr(Tile, "osm_extract", lambda self: osm)
    return tile


def _read(tile, name):
    import json

    return json.loads((tile.data / "dlm" / f"{name}_t.geojson").read_text())


def test_a_flight_is_oriented_uphill_with_its_landings_and_tagged_steps(tmp_path, monkeypatch):
    from bake import stairs

    # Drawn top → bottom; 25 steps over the 4 m rise is a 16 cm riser.
    way = (
        '<way id="1" version="1"><nd ref="1"/><nd ref="2"/>'
        '<tag k="highway" v="steps"/><tag k="step_count" v="25"/><tag k="width" v="3 m"/></way>'
    )
    tile = _osm_tile(tmp_path, monkeypatch, way)
    stairs.run(tile)
    doc = _read(tile, "stairs")
    assert doc["attribution"].startswith("©")
    [f] = doc["features"]
    (xa, ya), (xb, yb) = f["geometry"]["coordinates"]
    assert ya < yb  # reversed to run bottom → top
    assert f["properties"]["w"] == 3.0
    assert f["properties"]["n"] == 25
    lo, hi = f["properties"]["z"]
    assert abs(lo - 100) < 0.1 and abs(hi - 104) < 0.1


def test_a_flight_without_a_width_takes_it_from_its_outline_and_derives_steps(
    tmp_path, monkeypatch
):
    from bake import stairs

    ways = (
        '<way id="1" version="1"><nd ref="2"/><nd ref="1"/><tag k="highway" v="steps"/>'
        '<tag k="step_count" v="3"/></way>'  # a 1.3 m riser: a typo, derived instead
        '<way id="2" version="1"><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="6"/>'
        '<nd ref="3"/><tag k="area:highway" v="steps"/></way>'
        '<way id="3" version="1"><nd ref="3"/><nd ref="4"/><tag k="highway" v="footway"/></way>'
    )
    tile = _osm_tile(tmp_path, monkeypatch, ways)
    stairs.run(tile)
    [f] = _read(tile, "stairs")["features"]
    assert abs(f["properties"]["w"] - 6.0) < 0.05
    assert f["properties"]["n"] == 25


def test_flat_indoor_and_bridge_flights_are_left_out():
    from bake.stairs import skipped, step_count, width_of

    assert skipped('"indoor"=>"yes"')
    assert skipped('"bridge"=>"yes"')
    assert skipped('"level"=>"-1"')
    assert not skipped('"level"=>"0"')
    assert not skipped(None)
    assert step_count(1.6, None) == 10
    line = shapely.LineString([(0, 0), (10, 0)])
    outline = shapely.box(-1, -3, 11, 3)  # 12 m × 6 m around a 10 m axis
    assert width_of(line, None, [outline]) == 7.2  # area / length inside
    assert width_of(line, '"width"=>"100"', [outline]) == 30.0


def test_cliffs_come_through_as_walls_of_their_own_kind(tmp_path, monkeypatch):
    from bake import walls

    ways = (
        '<way id="1" version="1"><nd ref="3"/><nd ref="4"/><tag k="natural" v="cliff"/></way>'
        '<way id="2" version="1"><nd ref="5"/><nd ref="6"/><tag k="natural" v="tree_row"/></way>'
    )
    tile = _osm_tile(tmp_path, monkeypatch, ways)
    walls.run(tile)
    [f] = _read(tile, "walls")["features"]
    assert f["properties"] == {"kind": "cliff", "h": 3.0}
    assert walls.kind_of(None, None, '"natural"=>"cliff"') == "cliff"
    assert walls.kind_of("retaining_wall", None, '"natural"=>"cliff"') == "retaining_wall"
