"""The road-markings bake (pipeline/bake/markings.py)."""

import json
import math
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from bake.common import Tile
from bake.markings import (
    FURT,
    STOP,
    ZEBRA,
    crossing_kind,
    cycle_sides,
    has_centre_line,
    index_raster,
    junctions,
    merge_rows,
    paint_lost,
    run,
    signal_direction,
)


def test_crossing_paint_follows_the_markings_then_the_crossing_type():
    assert crossing_kind('"crossing"=>"marked"') == ZEBRA
    assert crossing_kind('"crossing"=>"uncontrolled"') == ZEBRA
    assert crossing_kind('"crossing"=>"unmarked","crossing_ref"=>"zebra"') == ZEBRA
    assert crossing_kind('"crossing"=>"traffic_signals"') == FURT
    assert crossing_kind('"crossing"=>"uncontrolled","crossing:markings"=>"dashes"') == FURT
    assert crossing_kind('"crossing"=>"traffic_signals","crossing:markings"=>"zebra"') == ZEBRA
    assert crossing_kind('"crossing"=>"unmarked","crossing:markings"=>"no"') == 0
    assert crossing_kind('"crossing"=>"informal"') == 0
    assert crossing_kind(None) == 0


def test_signal_direction_and_lane_tags():
    assert signal_direction('"traffic_signals:direction"=>"forward"') == 1
    assert signal_direction('"direction"=>"backward"') == -1
    assert signal_direction('"direction"=>"both"') == 0
    assert cycle_sides('"cycleway:right"=>"lane"') == (True, False)
    assert cycle_sides('"cycleway:both"=>"lane"') == (True, True)
    assert cycle_sides('"cycleway"=>"lane","oneway"=>"yes"') == (True, False)
    assert has_centre_line("secondary", '"lanes"=>"2"')
    assert not has_centre_line("secondary", '"lanes"=>"2","oneway"=>"yes"')
    assert not has_centre_line("residential", '"lanes"=>"2"')
    assert not has_centre_line("tertiary", '"lanes"=>"1"')
    assert not has_centre_line("primary", '"lanes"=>"2","lane_markings"=>"no"')


def test_a_way_split_in_two_is_no_junction_a_side_street_is():
    import shapely

    a = shapely.LineString([(0, 0), (10, 0)])
    b = shapely.LineString([(10, 0), (20, 0)])
    c = shapely.LineString([(10, 0), (10, 10)])
    assert junctions([a, b], ["primary", "primary"]) == []
    assert [(p.x, p.y) for p in junctions([a, b, c], ["primary"] * 3)] == [(10.0, 0.0)]
    # a driveway does not break the centre line
    assert junctions([a, b, c], ["primary", "primary", "service"]) == []


def _street(tmp_path, monkeypatch, way_tags: str, extra_nodes: str = ""):
    """A 200 m tile with a 10 m carriageway (class 7) along y = 95–105 and an
    OSM way along its middle from x = 10 to 190 (nodes 1, 2), plus a
    crossing at x = 100 (3) and a signal at x = 150 (4) on it."""
    from pyproj import Transformer

    x0, y0 = 411000.0, 5656000.0
    tile = Tile("t", (x0, y0, x0 + 200, y0 + 200), 25833, tmp_path / "raw", tmp_path / "data")
    cls = np.zeros((400, 400), np.uint8)
    cls[190:210, :] = 7  # rows 190–209 = y 105 … 95 (row 0 = north, 0.5 m)
    (tmp_path / "data" / "dlm").mkdir(parents=True)
    Image.fromarray(cls, mode="L").save(tmp_path / "data" / "dlm" / "landcover_t.png")
    back = Transformer.from_crs(25833, 4326, always_xy=True)
    pts = [(10, 100), (190, 100), (100, 100), (150, 100)]
    tags = {
        3: '<tag k="highway" v="crossing"/><tag k="crossing" v="marked"/>',
        4: '<tag k="highway" v="traffic_signals"/><tag k="traffic_signals:direction" v="forward"/>',
    }
    nodes = "".join(
        f'<node id="{i + 1}" lat="{lat:.9f}" lon="{lon:.9f}" version="1">'
        f"{tags.get(i + 1, '')}</node>"
        for i, (px, py) in enumerate(pts)
        for lon, lat in [back.transform(x0 + px, y0 + py)]
    )
    way = (
        '<way id="10" version="1"><nd ref="1"/><nd ref="3"/><nd ref="4"/><nd ref="2"/>'
        f'<tag k="highway" v="secondary"/>{way_tags}</way>'
    )
    osm = tmp_path / "raw" / "osm" / "t.osm"
    osm.parent.mkdir(parents=True)
    osm.write_text(f'<?xml version="1.0"?><osm version="0.6">{nodes}{extra_nodes}{way}</osm>')
    monkeypatch.setattr(Tile, "osm_extract", lambda self: osm)
    return tile


def _outputs(tile, px):
    table = json.loads((tile.data / "dlm" / "markings_t.json").read_text())
    grey = np.asarray(Image.open(tile.data / "dlm" / "markings_t.png"))
    return table, grey.reshape(px, px, 4)


def test_a_zebra_spans_the_carriageway_and_a_stop_line_its_right_half(tmp_path, monkeypatch):
    tile = _street(tmp_path, monkeypatch, '<tag k="lanes" v="2"/>')
    run(tile, px=200)
    table, raster = _outputs(tile, 200)
    rows = {r[5]: r for r in table["markings"]}
    assert set(rows) == {ZEBRA, STOP}
    cx, cy, angle, hl, hw, _ = rows[ZEBRA]
    assert abs(cx - 100.0) < 0.05 and abs(cy + 100.0) < 0.15  # the 0.25 m march
    assert abs(abs(angle) - math.pi / 2) < 1e-3  # across the east-west road
    assert abs(hl - 5.0) < 0.3 and hw == 2.0
    cx, cy, angle, hl, hw, _ = rows[STOP]
    # 3 m before the signal (travel east), the right (south) half
    assert abs(cx - 147.0) < 0.05
    assert abs(cy - (-102.5)) < 0.3
    assert abs(hl - 2.5) < 0.3 and hw == 0.25
    # the index raster names both rows (R + 256 A, 1-based)
    row = raster[..., 0].astype(int) + 256 * raster[..., 3].astype(int)
    assert set(np.unique(row)) == {0, 1, 2}
    assert row[100, 100] > 0  # the crossing's centre (row 100 = y 100)


def test_cycle_lanes_mark_their_side_and_the_centre_line_its_middle(tmp_path, monkeypatch):
    tile = _street(
        tmp_path, monkeypatch, '<tag k="lanes" v="2"/><tag k="cycleway:right" v="lane"/>'
    )
    run(tile, px=200)
    _, raster = _outputs(tile, 200)
    bits, offset = raster[..., 1], raster[..., 2].astype(float)
    col = 60  # x = 60 m, clear of the junction-free ends and the markings
    # rows 95–104 are the carriageway (y 105 … 95 at 1 m texels)
    south, north = bits[102, col], bits[96, col]
    assert south & 1 and not north & 1  # the lane on the right of an eastward way
    assert bits[100, col] & 4 and bits[96, col] & 4  # a centre-line road
    s = (offset[95:105, col] - 128) / 20
    assert s[0] < -3 and s[-1] > 3  # signed across the road, north negative
    assert np.argmin(np.abs(s)) in (4, 5)  # the middle at y ≈ 100
    assert not bits[90, col] and not bits[110, col]  # nothing off the road


def test_no_extract_leaves_the_files_alone(tmp_path, monkeypatch):
    tile = Tile("t", (0, 0, 200, 200), 25833, tmp_path / "raw", tmp_path / "data")
    monkeypatch.setattr(Tile, "osm_extract", lambda self: None)
    run(tile, px=200)
    assert not (tmp_path / "data" / "dlm" / "markings_t.json").exists()


# --- overlapping rows ------------------------------------------------------------

KM2 = Tile("k", (0.0, 0.0, 2000.0, 2000.0), 25833, Path("."), Path("."))
UP = math.pi / 2  # the axis across an east-west road


def test_a_crossing_mapped_twice_becomes_one_zebra():
    # a furt node and a zebra node 0.6 m apart on one east-west road
    zebra = [1000.0, 1000.0, UP, 5.0, 2.0, ZEBRA]
    furt = [1000.6, 1000.2, UP + 0.05, 5.2, 1.5, FURT]
    (merged,) = merge_rows([furt, zebra])
    assert merged[5] == ZEBRA and merged[2] == UP
    # across the road it covers both; along it both rectangles too (parallel)
    assert merged[3] >= 5.2 and 2.0 <= merged[4] < 2.7


def test_two_nodes_of_one_crossing_at_an_angle_keep_the_zebra_width():
    zebra = [1000.0, 1000.0, UP, 8.0, 2.0, ZEBRA]
    furt = [1000.0, 1000.0, UP + math.radians(25), 8.0, 1.5, FURT]
    (merged,) = merge_rows([zebra, furt])
    assert merged[5] == ZEBRA and merged[4] == pytest.approx(2.0)
    assert merged[3] == pytest.approx(8.0)


def test_two_arms_of_a_junction_and_a_stop_line_stay_apart():
    # (an axis UP runs north: hl along y, hw along x)
    arm_a = [1000.0, 1000.0, UP, 6.0, 2.0, ZEBRA]
    arm_b = [1007.0, 1004.0, 0.0, 6.0, 2.0, ZEBRA]  # across the north arm
    stop = [1001.5, 1000.0, UP, 3.0, 0.25, STOP]  # on arm a's zebra
    rows = merge_rows([arm_a, arm_b, stop])
    assert len(rows) == 3


@pytest.mark.parametrize("px", [2048, 1024])
def test_no_row_loses_paint_to_an_overlapping_one(px):
    # (an axis UP runs north: hl along y, hw along x)
    rows = [
        [1000.0, 1000.0, UP, 6.0, 2.0, ZEBRA],  # x 998–1002, y 994–1006
        [1007.0, 1004.0, 0.0, 6.0, 1.5, FURT],  # a north arm's, over its corner
        [1003.3, 1000.0, UP, 5.0, 0.25, STOP],  # a stop line 1 m beyond it
        [1020.0, 1000.0, UP, 4.0, 1.5, FURT],
        [1022.0, 1000.0, UP, 4.0, 0.25, STOP],  # within the furt's margin
    ]
    index = index_raster(rows, KM2, px)
    lost = paint_lost(rows, index, KM2)
    # paint is only ever replaced where another row paints over it
    assert all(dropped == 0 for _, dropped in lost)
    # and a row nothing overlaps names every texel its paint needs
    assert lost[3][0] == 0 and lost[4][0] == 0


def test_the_last_row_used_to_clip_the_first():
    # the old one-pass raster (grown outlines, last wins) lost a stop line
    # under a crossing's margin; the core pass keeps it
    rows = [[1021.6, 1000.0, UP, 4.0, 0.25, STOP], [1020.0, 1000.0, UP, 4.0, 1.5, FURT]]
    old = index_raster(rows, KM2, 2048, grow=1.0, core=0.0)
    assert paint_lost(rows, old, KM2)[0] == (1.0, 1.0)
    assert paint_lost(rows, index_raster(rows, KM2, 2048), KM2)[0] == (0.0, 0.0)


DLM = Path(__file__).resolve().parents[2] / "data" / "dlm"


@pytest.mark.parametrize("table", sorted(DLM.glob("markings_*.json")), ids=lambda p: p.stem)
def test_the_committed_rasters_lose_no_paint(table):
    doc = json.loads(table.read_text())
    xmin, ymin, xmax, ymax = doc["bounds"]
    tile = Tile(doc["tile"], (xmin, ymin, xmax, ymax), 25833, Path("."), Path("."))
    rows = [[xmin + r[0], ymax + r[1], *r[2:]] for r in doc["markings"]]
    for name in (f"markings_{doc['tile']}.png", f"markings_low_{doc['tile']}.png"):
        grey = np.asarray(Image.open(DLM / name))
        px = grey.shape[0]
        q = grey.reshape(px, px, 4).astype(np.uint16)
        lost = paint_lost(rows, q[..., 0] + 256 * q[..., 3], tile)
        assert [i for i, (_, d) in enumerate(lost) if d > 0] == [], name
