"""The LoD2 roofs rebuilt from DOM1 (pipeline/bake/roofs.py)."""

import json

import numpy as np
import rasterio
from rasterio.transform import from_origin

from bake.common import Tile
from bake.roofs import (
    LEVEL_MISS_SHARE,
    LEVEL_SHARE,
    MISS_SHARE,
    _majority,
    _narrow,
    form_holds,
    inclined_cells,
    level_share,
    merge_regions,
    miss_share,
    pitch_holds,
    run,
)

X0, Y0, SIZE = 400_000.0, 5_600_000.0, 200
BASE = 110.0


def _raster(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=1,
        dtype="float32",
        crs="EPSG:25833",
        transform=from_origin(X0, Y0 + SIZE, 1.0, 1.0),
        nodata=-9999.0,
    ) as ds:
        ds.write(data.astype(np.float32), 1)


def _solid(first, roofs):
    """A box's walls and ground from vertices `first`..`first + 3` (ground
    ring) plus the given roof rings (vertex indices)."""
    a, b, c, d = first, first + 1, first + 2, first + 3
    shell = [[[a, d, c, b]]] + [[r] for r in roofs]
    values = [0] + [1] * len(roofs)
    return {
        "type": "Solid",
        "lod": "2",
        "boundaries": [shell],
        "semantics": {
            "surfaces": [{"type": "GroundSurface"}, {"type": "RoofSurface"}],
            "values": [values],
        },
    }


def _square(x, y, w, z):
    return [[x, y, z], [x + w, y, z], [x + w, y + w, z], [x, y + w, z]]


def _tile(tmp_path, dom):
    tile = Tile(
        "t",
        (X0, Y0, X0 + SIZE, Y0 + SIZE),
        25833,
        tmp_path / "raw",
        tmp_path / "data",
        credit="Quelle: GeoSN, dl-de/by-2-0",
    )
    _raster(tile.dgm, np.full((SIZE, SIZE), BASE))
    _raster(tile.raw_raster("dom1"), dom)
    # 1. a tent: four facets from 5 m eaves to a 20 m peak, over 40 × 40 m
    tent = (
        _square(X0 + 20, Y0 + 20, 40, BASE)
        + _square(X0 + 20, Y0 + 20, 40, BASE + 5)
        + [[X0 + 40, Y0 + 40, BASE + 20]]
    )
    facets = [[4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 4, 8]]
    # 2. a flat roof the scan agrees with, 3. one over open ground (torn down)
    flat = _square(X0 + 100, Y0 + 20, 40, BASE) + _square(X0 + 100, Y0 + 20, 40, BASE + 10)
    gone = _square(X0 + 100, Y0 + 100, 40, BASE) + _square(X0 + 100, Y0 + 100, 40, BASE + 10)
    vertices = tent + flat + gone
    doc = {
        "type": "CityJSON",
        "version": "2.0",
        "transform": {"scale": [1, 1, 1], "translate": [0, 0, 0]},
        "vertices": vertices,
        "CityObjects": {
            "tent": {
                "type": "Building",
                "attributes": {"function": "31001_2071"},
                "geometry": [_solid(0, facets)],
            },
            "flat": {"type": "Building", "geometry": [_solid(9, [[13, 14, 15, 16]])]},
            "gone": {"type": "Building", "geometry": [_solid(17, [[21, 22, 23, 24]])]},
        },
    }
    path = tile.data / "cityjson" / "lod2_t.city.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc))
    return tile


def _dom():
    """The scan: the tent's footprint is a 20 m block (west) beside a 9 m
    one (east); the flat roof stands at 10 m; the third is open ground."""
    dom = np.full((SIZE, SIZE), BASE, np.float32)
    rows = slice(SIZE - 60, SIZE - 20)  # y 20..60, row 0 = north
    dom[rows, 20:40] = BASE + 20
    dom[rows, 40:60] = BASE + 9
    dom[rows, 100:140] = BASE + 10
    return dom


def test_a_tent_over_two_blocks_becomes_the_two_blocks(tmp_path):
    tile = _tile(tmp_path, _dom())
    run(tile)
    doc = json.loads((tile.data / "dlm" / "roofs_t.geojson").read_text())
    # the provider's credit line, whatever the Land
    assert doc["attribution"] == "Quelle: GeoSN, dl-de/by-2-0 (LoD2, DOM1)"
    parts = [(f["properties"]["id"], f["properties"]["z"], f["geometry"]) for f in doc["features"]]
    # the flat roof fits and the torn-down one is not rebuilt
    assert {p[0] for p in parts} == {"tent"}
    assert sorted(round(z) for _, z, _ in parts) == [BASE + 9, BASE + 20]
    for _, z, g in parts:
        xs = [x for x, _ in g["coordinates"][0]]
        # each block keeps to its half of the footprint, within a cell
        if z > BASE + 15:
            assert min(xs) >= X0 + 20 - 1e-6 and max(xs) <= X0 + 41
        else:
            assert min(xs) >= X0 + 39 and max(xs) <= X0 + 60 + 1e-6


def test_without_dom1_the_step_leaves_the_roofs_alone(tmp_path, capsys):
    tile = _tile(tmp_path, _dom())
    tile.raw_raster("dom1").unlink()
    out = tile.data / "dlm"
    out.mkdir(parents=True, exist_ok=True)
    (out / "roofs_t.geojson").write_text('{"features": [1]}')
    before = sorted(p.name for p in out.iterdir())
    run(tile)
    assert (out / "roofs_t.geojson").read_text() == '{"features": [1]}'
    assert sorted(p.name for p in out.iterdir()) == before
    assert "no DOM1" in capsys.readouterr().out


def test_regions_closer_than_the_merge_step_merge_a_storey_stays():
    # a ramp of 1 m bands (one roof slope) beside a block 3 m higher
    h = np.zeros((10, 30))
    h[:, :20] = (np.arange(20) // 10)[None, :]
    h[:, 20:] = 5.0
    lab = np.zeros(h.shape, np.int64)
    lab[:, :10], lab[:, 10:20], lab[:, 20:] = 1, 2, 3
    out, faces = merge_regions(lab, h, small_cells=5)
    assert out.max() == 2
    assert not faces.any()
    assert len(np.unique(out[:, :20])) == 1
    assert out[0, 0] != out[0, 25]


def test_a_face_stays_a_face_a_flat_neighbour_its_level():
    # a slope of 1 m bands (one face) beside a flat block at its foot
    h = np.zeros((10, 30))
    h[:, :20] = (np.arange(20) // 10)[None, :]
    lab = np.zeros(h.shape, np.int64)
    lab[:, :10], lab[:, 10:20], lab[:, 20:] = 1, 2, 3
    faces = np.array([False, True, True, False])
    out, merged = merge_regions(lab, h, small_cells=5, faces=faces)
    # the two face pieces do not merge by height, nor the flat one into them
    assert out.max() == 3
    assert merged[out[0, 0]] and merged[out[0, 15]] and not merged[out[0, 25]]


def test_a_strip_narrower_than_a_part_joins_its_closest_neighbour():
    # two broad levels 6 m apart; between them a 3 m strip (a step's
    # flank) 2 m above the lower, and on the upper a 6 m strip 1.5 m higher
    # still (a parapet's run) and a 6 m wing 5 m lower (a storey of its own)
    h = np.zeros((20, 60))
    h[:, 10:13] = 2.0
    h[:, 13:] = 6.0
    h[:, 30:36] = 7.5
    h[:, 44:50] = 1.0
    lab = np.zeros(h.shape, np.int64)
    lab[:, :10], lab[:, 10:13], lab[:, 13:30] = 1, 2, 3
    lab[:, 30:36], lab[:, 36:44], lab[:, 44:50], lab[:, 50:] = 4, 3, 5, 3
    kept, _ = merge_regions(lab, h, small_cells=5)
    assert kept.max() == 5
    out, _ = merge_regions(lab, h, small_cells=5, thin=True, narrow=True)
    assert out[0, 11] == out[0, 0]
    assert out[0, 31] == out[0, 20]
    assert len({out[0, 0], out[0, 20], out[0, 46]}) == 3


def test_a_part_6_m_wide_is_narrow_one_7_m_wide_is_not():
    lab = np.zeros((20, 40), np.int64)
    lab[:, :6], lab[:, 6:13], lab[:, 13:] = 1, 2, 3
    assert _narrow(lab, 3).tolist() == [True, False, False]


def test_a_steep_flank_6_m_wide_is_a_face_a_gentle_or_narrow_one_not():
    # a flat roof, then a flank rising across x over a band of the given
    # width at the given pitch, then flat again at the flank's top
    def flank(width: int, pitch: float) -> np.ndarray:
        h = np.zeros((30, 30))
        x = np.arange(30) - 10
        h[:] = np.clip(x, 0, width) * pitch
        return inclined_cells(h, np.ones(h.shape, bool))[:, 10 : 10 + width].any()

    assert flank(6, 0.7)  # a mansard's flank, 35°
    assert not flank(6, 0.3)  # gentle: a face only from 10 m
    assert not flank(3, 0.7)  # a step's flank


def test_a_steep_flank_a_cell_wide_joins_a_level_however_far():
    # two levels 20 m apart, the scan's blurred flank between them in two
    # 1 m bands, each a long strip far from both levels
    h = np.zeros((30, 6))
    h[:, 2], h[:, 3], h[:, 4:] = 7.0, 13.0, 20.0
    lab = np.zeros(h.shape, np.int64)
    lab[:, :2], lab[:, 2], lab[:, 3], lab[:, 4:] = 1, 2, 3, 4
    out, _ = merge_regions(lab, h, small_cells=5, thin=True, narrow=True)
    assert out.max() == 2


def test_the_majority_straightens_a_border_and_keeps_the_outside():
    # a border down column 15, jagged by a cell either way every other row
    # (the scan's teeth), the footprint's outside empty
    lab = np.full((30, 30), 2)
    for r in range(30):
        lab[r, : 15 + (r % 2) * 2 - 1] = 1
    lab[:, :3] = 0
    out = _majority(lab)
    assert (out[:, :3] == 0).all()
    assert (out[:, 3:] > 0).all()
    # the teeth are gone: every row (away from the ends) breaks in the same
    # column
    breaks = {int(np.argmax(row[3:] == 2)) for row in out[3:-3]}
    assert len(breaks) == 1


def test_the_majority_wipes_out_no_part():
    # a part a cell wide inside a broad one: the vote would take it
    lab = np.ones((20, 20), np.int64)
    lab[5:15, 10] = 2
    assert 2 in _majority(lab)


def test_a_steep_face_narrower_than_a_part_stays_a_face():
    # a flat level at 10 m, a face 5 cells wide rising to 13 m, a level at 13 m
    h = np.zeros((30, 20))
    h[:, :8] = 10.0
    h[:, 8:13] = 10.0 + 0.6 * (np.arange(8, 13) - 7)
    h[:, 13:] = 13.0
    lab = np.zeros(h.shape, np.int64)
    lab[:, :8], lab[:, 8:13], lab[:, 13:] = 1, 2, 3
    faces = np.array([False, False, True, False])
    out, kept = merge_regions(lab, h, small_cells=5, faces=faces, thin=True, narrow=True)
    assert out.max() == 3 and kept.sum() == 1


def test_narrow_strips_do_not_chain_past_the_cap():
    # strips at 10 m and 12.5 m (each 2.5 m from the next), a level at 15 m:
    # the 10 m strip may join the 12.5 m one, never end on the 15 m level
    h = np.zeros((30, 24))
    h[:, :4], h[:, 4:8], h[:, 8:] = 10.0, 12.5, 15.0
    lab = np.zeros(h.shape, np.int64)
    lab[:, :4], lab[:, 4:8], lab[:, 8:] = 1, 2, 3
    out, _ = merge_regions(lab, h, small_cells=5, thin=True, narrow=True)
    assert out[0, 0] != out[0, 20]


def _gable_dom():
    """The scan: over the tent's footprint (x 20..60) a gable, eaves at
    10 m, its ridge 5 m higher along x = 40; the flat roof at 10 m."""
    dom = _dom()
    rows = slice(SIZE - 60, SIZE - 20)
    x = np.arange(20, 60) + 0.5
    dom[rows, 20:60] = BASE + 15 - np.abs(x - 40) / 4
    return dom


def test_a_tent_over_a_gable_becomes_the_measured_gable(tmp_path):
    tile = _tile(tmp_path, _gable_dom())
    run(tile)
    doc = json.loads((tile.data / "dlm" / "roofs_t.geojson").read_text())
    parts = [f["properties"] for f in doc["features"] if f["properties"]["id"] == "tent"]
    faces = [p for p in parts if "surface" in p]
    # one face, not a flight of 1 m terraces
    assert len(faces) == 1
    face = faces[0]
    s = face["surface"]
    grid = face["z"] + np.asarray(s["dz"], float).reshape(s["rows"], s["cols"]) / 100
    xs = s["x"] + (np.arange(s["cols"]) + 0.5) * s["res"]
    ys = s["y"] - (np.arange(s["rows"]) + 0.5) * s["res"]
    row = int(np.argmin(np.abs(ys - (Y0 + 40))))
    for x in (24.5, 32.5, 40.5, 48.5, 55.5):
        col = int(np.argmin(np.abs(xs - (X0 + x))))
        assert abs(grid[row, col] - (BASE + 15 - abs(x - 40) / 4)) < 0.3


def test_a_form_the_scan_follows_is_kept_a_wrong_one_or_a_placeholder_not():
    x = np.tile(np.arange(40.0), 40)
    gable = BASE + 10 + 6 - np.abs(x - 20) * 0.3  # a 6 m gable over 40 m
    # its level 4 m off, the shape the same: the LoD2's form holds
    assert form_holds(gable, gable + 4)
    # the scan's noise does not change that
    rng = np.random.default_rng(1)
    assert form_holds(gable, gable + 4 + rng.normal(0, 0.3, gable.shape))
    # a tent over a flat roof: the form is wrong
    assert not form_holds(gable, np.full_like(gable, BASE + 14))
    # a 3 m placeholder under a 19 m block: no form to keep
    assert not form_holds(np.full_like(gable, BASE + 3), np.full_like(gable, BASE + 19))
    # the same gable 9 m higher: another building on the footprint
    assert not form_holds(gable, gable + 9)


def test_a_low_hip_over_a_level_roof_misses_on_the_level_a_gable_off_a_storey_on_its_slope():
    yy, xx = np.mgrid[0:40, 0:40] + 0.5
    judged = np.zeros((40, 40), bool)
    judged[1:-1, 1:-1] = True
    # a low hipped roof (10 m eaves, 6 m up to its peak) over a store whose
    # roof is level at 10.5 m: it misses on a third, in the band
    hip = BASE + 10 + (20 - np.maximum(np.abs(xx - 20), np.abs(yy - 20))) * 0.3
    store = np.full((40, 40), BASE + 10.5)
    assert LEVEL_MISS_SHARE < miss_share(hip, store, judged) <= MISS_SHARE
    assert level_share(hip, store, store, judged) >= LEVEL_SHARE
    assert not pitch_holds(hip, store, judged, judged)
    # a gable the scan shows a storey higher misses on its slopes: kept
    gable = BASE + 10 + (20 - np.abs(xx - 20)) * 0.4
    assert level_share(gable, gable + 3, gable + 3, judged) < 0.1
    # a gentle LoD2 gable over the scan's steeper one: the pitch holds, and
    # the LoD2 stays though a flat annex beside it misses
    assert pitch_holds(BASE + 10 + (20 - np.abs(xx - 20)) * 0.2, gable, judged, judged)
    assert not pitch_holds(np.full((40, 40), BASE + 10.0), gable, judged, judged)


def test_a_halls_monitor_roofs_stay_strips_where_merging_them_would_miss(tmp_path):
    # the flat roof's footprint (40 × 40 m at 10 m) carries two monitor
    # roofs, 5 m wide and 2.5 m higher (a quarter of the roof): narrow, they
    # would merge into the roof beside them, which then misses them as the
    # LoD2 did
    dom = _dom()
    rows = slice(SIZE - 60, SIZE - 20)
    for c in (109, 126):
        dom[rows, c : c + 5] = BASE + 12.5
    tile = _tile(tmp_path, dom)
    run(tile)
    doc = json.loads((tile.data / "dlm" / "roofs_t.geojson").read_text())
    parts = [f["properties"]["z"] for f in doc["features"] if f["properties"]["id"] == "flat"]
    assert sorted(parts) == [BASE + 10] * 3 + [BASE + 12.5] * 2
