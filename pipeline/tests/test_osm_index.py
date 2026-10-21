"""The OSM index gives what GDAL's OSM driver gives for the same read: the
same features, fields and order — the relation rule included (a tagged
relation the filter turns down leaves its closed outer ways standalone)."""

from __future__ import annotations

import numpy as np
import pyogrio
import pytest

from bake import osm_index


def _node(i: int, lon: float, lat: float, tags: str = "") -> str:
    return f'<node id="{i}" lat="{lat:.7f}" lon="{lon:.7f}" version="1">{tags}</node>'


def _tags(**kv: str) -> str:
    return "".join(f'<tag k="{k.replace("_", ":")}" v="{v}"/>' for k, v in kv.items())


def _way(i: int, refs: list[int], tags: str) -> str:
    nds = "".join(f'<nd ref="{r}"/>' for r in refs)
    return f'<way id="{i}" version="1">{nds}{tags}</way>'


def _square(first: int, lon: float, lat: float, d: float) -> tuple[list[str], list[int]]:
    corners = [(lon, lat), (lon + d, lat), (lon + d, lat + d), (lon, lat + d)]
    nodes = [_node(first + k, x, y) for k, (x, y) in enumerate(corners)]
    return nodes, [first, first + 1, first + 2, first + 3, first]


@pytest.fixture
def extract(tmp_path):
    xml = []
    # points
    xml += [_node(1, 13.700, 51.000, _tags(highway="street_lamp")), _node(2, 13.701, 51.001)]
    xml += [_node(3, 13.702, 51.002, _tags(amenity="bench"))]
    # a road
    xml += [_node(10, 13.700, 51.000), _node(11, 13.710, 51.010)]
    roads = [_way(100, [10, 11], _tags(highway="primary", name="A"))]
    # a building on its own
    n, r = _square(20, 13.701, 51.001, 0.001)
    xml += n
    roads.append(_way(101, r, _tags(building="yes")))
    # a building that is the outer way of a tagged site relation
    n, r = _square(30, 13.703, 51.003, 0.001)
    xml += n
    roads.append(_way(102, r, _tags(building="church", historic="yes")))
    # a building that is the outer way of a tag-less relation
    n, r = _square(40, 13.705, 51.005, 0.001)
    xml += n
    roads.append(_way(103, r, _tags(building="house")))
    # a park relation of two untagged ways
    n, r = _square(50, 13.707, 51.007, 0.002)
    xml += n
    roads.append(_way(104, r, ""))
    rels = [
        '<relation id="900" version="1"><member type="way" ref="102" role="outer"/>'
        + _tags(type="multipolygon", landuse="religious", name="Site")
        + "</relation>",
        '<relation id="901" version="1"><member type="way" ref="103" role="outer"/>'
        + _tags(type="multipolygon")
        + "</relation>",
        '<relation id="902" version="1"><member type="way" ref="104" role="outer"/>'
        + _tags(type="multipolygon", leisure="park")
        + "</relation>",
    ]
    osm = tmp_path / "t.osm"
    osm.write_text(f'<?xml version="1.0"?><osm version="0.6">{"".join(xml + roads + rels)}</osm>')
    return osm


READS = [
    ("points", None, ["other_tags"]),
    ("points", "highway = 'street_lamp'", ["other_tags"]),
    ("lines", "highway IS NOT NULL", ["highway", "name"]),
    ("lines", "highway = 'PRIMARY'", ["name"]),
    ("multipolygons", None, None),
    ("multipolygons", "building IS NOT NULL", ["building"]),
    ("multipolygons", "landuse IS NOT NULL", ["landuse", "other_tags"]),
    ("multipolygons", "building IS NOT NULL OR landuse IS NOT NULL", ["building"]),
    ("multipolygons", "leisure = 'park'", []),
    ("multipolygons", "historic IS NOT NULL", ["other_tags"]),
]


BOXES = [(13.69, 50.99, 13.72, 51.02), (13.7025, 51.0025, 13.7045, 51.0045)]


@pytest.mark.parametrize(("layer", "where", "columns"), READS)
@pytest.mark.parametrize("bbox", BOXES)
def test_index_reads_as_the_driver(extract, layer, where, columns, bbox):
    meta, _, wkb, fields = pyogrio.raw.read(
        extract, layer=layer, bbox=bbox, where=where, columns=columns
    )
    got_wkb, names, got = osm_index.read(extract, layer, bbox, where, columns)
    assert names == list(meta["fields"])
    want = wkb if wkb is not None else np.array([], dtype=object)
    assert list(got_wkb) == list(want)
    for a, b in zip(fields, got, strict=True):
        assert a.dtype == b.dtype
        assert list(a) == list(b)


def test_the_filter_decides_which_relations_absorb(extract):
    """The driver's own behaviour the index keeps: way 102 is the site's
    outer way, so it is a building only while the site is filtered out."""
    bbox = (13.69, 50.99, 13.72, 51.02)
    _, names, fields = osm_index.read(extract, "multipolygons", bbox, "building IS NOT NULL", None)
    ways = set(fields[names.index("osm_way_id")])
    assert {"101", "102"} <= ways
    _, names, fields = osm_index.read(
        extract, "multipolygons", bbox, "building IS NOT NULL OR landuse IS NOT NULL", None
    )
    assert "102" not in set(fields[names.index("osm_way_id")])


def test_a_new_extract_rebuilds_the_index(extract):
    bbox = (13.69, 50.99, 13.72, 51.02)
    osm_index.read(extract, "points", bbox, None, ["other_tags"])
    text = extract.read_text().replace("street_lamp", "bench")
    extract.write_text(text)
    _, _, fields = osm_index.read(extract, "points", bbox, "highway = 'street_lamp'", ["highway"])
    assert len(fields[0]) == 0
