"""A tree on transport land stands beyond the traffic: the DLM's road and
railway parcels reach the fences and hold verges, embankments and forecourts
with their trees, so the canopy vetoes the carriageway and the track bed, not
the parcel."""

from __future__ import annotations

import json

import numpy as np
import pyogrio.raw
import rasterio
import shapely

from bake import canopy
from tests.synthetic import SIZE, X0, Y0, osm_tile, read

ROAD, RAILWAY, MEADOW = 7, 5, 1


def _crown(dom: np.ndarray, rng, x: int, y: int, size: int = 6) -> None:
    """A rough 12 m crown, `size` m across, centred at (x, y) m from the
    tile's south-west corner (row 0 = north)."""
    r, c = SIZE - y - size // 2, x - size // 2
    dom[r : r + size, c : c + size] = 112.0 + rng.normal(0.0, 1.5, (size, size))


def _tile(tmp_path, monkeypatch):
    """A road parcel 40 m wide (y 80–120) round a 5 m carriageway along
    y = 100, and a railway parcel (y 20–60) round two tracks along y = 40."""
    cls = np.full((SIZE, SIZE), MEADOW, np.uint8)
    cls[SIZE - 120 : SIZE - 80, :] = ROAD
    cls[SIZE - 60 : SIZE - 20, :] = RAILWAY
    tile = osm_tile(tmp_path, monkeypatch, {}, classes=cls)
    centreline = shapely.LineString([(X0, Y0 + 100), (X0 + SIZE, Y0 + 100)])
    tile.dlm.mkdir(parents=True, exist_ok=True)
    pyogrio.raw.write(
        tile.dlm / "ver01_l.shp",
        np.array([shapely.to_wkb(centreline)], dtype=object),
        [np.array([""], dtype=object), np.array(["1307"], dtype=object)],
        fields=["BRF", "WDM"],
        crs="EPSG:25833",
        geometry_type="LineString",
        driver="ESRI Shapefile",
    )
    track = {"type": "LineString", "coordinates": [[X0, Y0 + 40], [X0 + SIZE, Y0 + 40]]}
    rail = {"type": "Feature", "geometry": track, "properties": {"tracks": 2}}
    tile.out("dlm", "rail_t.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": [rail]})
    )
    rng = np.random.default_rng(0)
    dom = np.full((SIZE, SIZE), 100.0)
    _crown(dom, rng, 40, 112)  # a verge's tree, 12 m off the road's axis
    _crown(dom, rng, 100, 100)  # a crown over the carriageway
    _crown(dom, rng, 40, 54)  # the embankment's, 14 m off the tracks
    _crown(dom, rng, 100, 40)  # a crown over the track bed
    _crown(dom, rng, 160, 112, size=3)  # a 9 m² blob: a mast's clutter
    path = tile.raw_raster("dom1")
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
        transform=tile.transform(SIZE),
    ) as dst:
        dst.write(dom.astype("float32"), 1)
    # no forest or park: every tree here comes from the transport land
    monkeypatch.setattr(canopy, "vegetation_mask", lambda t, px: np.zeros((px, px), np.uint8))
    return tile


def test_a_crown_on_transport_land_beyond_the_traffic_is_canopy(tmp_path, monkeypatch):
    tile = _tile(tmp_path, monkeypatch)
    canopy.run(tile, cell=7)
    trees = [f["geometry"]["coordinates"] for f in read(tile, "canopy")["features"]]
    near = lambda x, y: [t for t in trees if abs(t[0] - X0 - x) < 4 and abs(t[1] - Y0 - y) < 4]  # noqa: E731
    assert near(40, 112)  # the verge
    assert near(40, 54)  # the embankment
    assert not near(100, 100)  # the carriageway
    assert not near(100, 40)  # the track bed
    assert not near(160, 112)  # too small for a crown
