"""Units of the fetch step that need no network: the CityGML converter, the
provider-grid helper, the XYZ gridding, the OSM class mapping and the spec."""

import json
from pathlib import Path

import numpy as np
import rasterio

from bake.citygml import convert, write_cityjson
from bake.common import Tile
from bake.fetch import Ctx, cells
from bake.landcover_osm import _area_class
from bake.providers.be import xyz_to_tif
from bake.spec import parse

GML = """<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:gml="http://www.opengis.net/gml"
  xmlns:core="http://www.opengis.net/citygml/1.0"
  xmlns:bldg="http://www.opengis.net/citygml/building/1.0"
  xmlns:gen="http://www.opengis.net/citygml/generics/1.0">
  <core:cityObjectMember>
    <bldg:Building gml:id="B1">
      <gml:name>B1</gml:name>
      <gml:boundedBy><gml:Envelope>
        <gml:lowerCorner>100 100 10</gml:lowerCorner>
        <gml:upperCorner>110 110 20</gml:upperCorner>
      </gml:Envelope></gml:boundedBy>
      <gen:doubleAttribute name="Dachneigung"><gen:value>30.5</gen:value></gen:doubleAttribute>
      <bldg:function>31001_1000</bldg:function>
      <bldg:roofType>3100</bldg:roofType>
      <bldg:measuredHeight uom="m">10.0</bldg:measuredHeight>
      <bldg:consistsOfBuildingPart><bldg:BuildingPart gml:id="P1">
        <bldg:measuredHeight uom="m">8.5</bldg:measuredHeight>
        <bldg:boundedBy><bldg:RoofSurface gml:id="R1"><bldg:lod2MultiSurface><gml:MultiSurface>
          <gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
            <gml:posList srsDimension="3">100 100 20 110 100 20 110 110 20 100 100 20</gml:posList>
          </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
        </gml:MultiSurface></bldg:lod2MultiSurface></bldg:RoofSurface></bldg:boundedBy>
        <bldg:boundedBy><bldg:GroundSurface gml:id="G1"><bldg:lod2MultiSurface><gml:MultiSurface>
          <gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
            <gml:posList srsDimension="3">100 100 10 110 110 10 110 100 10 100 100 10</gml:posList>
          </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>
        </gml:MultiSurface></bldg:lod2MultiSurface></bldg:GroundSurface></bldg:boundedBy>
      </bldg:BuildingPart></bldg:consistsOfBuildingPart>
    </bldg:Building>
  </core:cityObjectMember>
  <core:cityObjectMember>
    <bldg:Building gml:id="B2">
      <gml:boundedBy><gml:Envelope>
        <gml:lowerCorner>2000 100 10</gml:lowerCorner>
        <gml:upperCorner>2010 110 20</gml:upperCorner>
      </gml:Envelope></gml:boundedBy>
    </bldg:Building>
  </core:cityObjectMember>
</core:CityModel>
"""


def test_citygml_becomes_the_cityjson_the_build_reads(tmp_path):
    gml = tmp_path / "t.gml"
    gml.write_text(GML)
    # B2's envelope centre (2005, 105) lies on the next tile: dropped here.
    doc = convert([gml, gml], (0.0, 0.0, 2000.0, 2000.0), 25833)
    assert list(doc["CityObjects"]) == ["B1", "P1"]
    # The next tile reads the same files (the fetch's one-cell margin) and
    # keeps B2, whose centre it owns — once, although it appears twice.
    nxt = convert([gml, gml], (2000.0, 0.0, 4000.0, 2000.0), 25833)
    assert list(nxt["CityObjects"]) == ["B2"]
    b1, p1 = doc["CityObjects"]["B1"], doc["CityObjects"]["P1"]
    assert b1["children"] == ["P1"] and p1["parents"] == ["B1"]
    assert b1["attributes"]["measuredHeight"] == 10.0
    assert b1["attributes"]["Dachneigung"] == 30.5
    assert b1["attributes"]["roofType"] == "3100"
    assert b1["geographicalExtent"] == [100, 100, 10, 110, 110, 20]
    geom = p1["geometry"][0]
    assert geom["type"] == "MultiSurface"
    assert [s["type"] for s in geom["semantics"]["surfaces"]] == ["RoofSurface", "GroundSurface"]
    assert geom["semantics"]["values"] == [0, 1]
    # Rings are open (the closing vertex dropped) and share vertices.
    assert [len(face[0]) for face in geom["boundaries"]] == [3, 3]
    assert len(doc["vertices"]) == 6
    assert doc["metadata"]["referenceSystem"].endswith("/25833")
    scale, translate = doc["transform"]["scale"], doc["transform"]["translate"]
    x, y, z = doc["vertices"][geom["boundaries"][0][0][1]]
    assert (x * scale[0] + translate[0], y * scale[1] + translate[1]) == (110.0, 100.0)
    assert z * scale[2] + translate[2] == 20.0


def _tile(bounds):
    return Tile("t", bounds, 25832, Path("raw"), Path("data"))


def test_provider_cells_cover_the_tile():
    tile = _tile((408000.0, 5708000.0, 410000.0, 5710000.0))
    assert sorted(cells(tile, 1)) == [(408, 5708), (408, 5709), (409, 5708), (409, 5709)]
    assert list(cells(tile, 2)) == [(408, 5708)]
    # an odd-km tile on a 2 km grid touches four 2 km cells
    odd = _tile((409000.0, 5709000.0, 411000.0, 5711000.0))
    assert sorted(cells(odd, 2)) == [(408, 5708), (408, 5710), (410, 5708), (410, 5710)]

    # the LoD2 fetch's one ring of neighbouring cells
    assert len(list(cells(tile, 2, margin=1))) == 9
    assert (406, 5706) in set(cells(tile, 2, margin=1))
    assert (410, 5710) in set(cells(tile, 2, margin=1))
    assert len(list(cells(tile, 1, margin=1))) == 16
    assert sorted(cells(tile, 1, margin=1))[0] == (407, 5707)


def test_xyz_cell_centres_grid_to_a_georeferenced_raster(tmp_path):
    xyz = tmp_path / "t.xyz"
    rows = [f"{x + 0.5} {y + 0.5} {x + 10 * y}" for y in (0, 1) for x in (0, 1, 2)]
    xyz.write_text("\n".join(rows))
    with rasterio.open(xyz_to_tif(xyz, 25833)) as r:
        assert (r.width, r.height) == (3, 2)
        assert tuple(r.bounds) == (0.0, 0.0, 3.0, 2.0)
        grid = r.read(1)
    assert np.array_equal(grid, [[10, 11, 12], [0, 1, 2]])


def test_osm_areas_map_to_the_dlm_classes():
    assert _area_class({"natural": "water", "landuse": "grass"}) == 8
    assert _area_class({"landuse": "forest"}) == 2
    assert _area_class({"leisure": "park"}) == 4
    assert _area_class({"landuse": "meadow"}) == 1
    # buildings and amenity areas read as settlement, like the DLM's blocks
    assert _area_class({"amenity": "school"}) == 4
    assert _area_class({"tourism": "museum"}) is None


def test_the_spec_names_the_provider_folder_and_extract():
    spec = parse(
        json.dumps(
            {
                "site": "x",
                "provider": "sn",
                "epsg": 25833,
                "products": {"dom": True, "dop": None, "dlm": False, "lsc": True},
                "credit": "Quelle: GeoSN, dl-de/by-2-0",
                "treeCadastre": {"id": "dresden", "credit": "Stadtbäume: LH Dresden"},
                "raw": "data/_raw/sn",
                "data": "data/x",
                "osm": "https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf",
                "tiles": [{"id": "33412_5656_2_sn", "bounds": [412000, 5656000, 414000, 5658000]}],
            }
        )
    )
    tile = spec.tiles[0]
    assert tile.osm == Path("data/_raw/sn/osm/sachsen-latest.osm.pbf")
    assert tile.dgm == Path("data/x/dgm/dgm1_33412_5656_2_sn_tiff/dgm1_33412_5656_2_sn.tif")
    assert not tile.products.dlm and tile.products.dop is None
    assert tile.credit == "Quelle: GeoSN, dl-de/by-2-0"
    assert tile.products.lsc
    assert tile.tree_cadastre is not None and tile.tree_cadastre.id == "dresden"
    # JSON integers would leak numpy integers into the GeoJSON the bakes write
    assert all(isinstance(b, float) for b in tile.bounds)


def test_citygml_2_reads_like_1_and_an_empty_tile_is_refused(tmp_path):
    gml = tmp_path / "v2.gml"
    gml.write_text(
        GML.replace("citygml/building/1.0", "citygml/building/2.0")
        .replace("citygml/1.0", "citygml/2.0")
        .replace("citygml/generics/1.0", "citygml/generics/2.0")
    )
    doc = convert([gml], (0.0, 0.0, 2000.0, 2000.0), 25833)
    assert list(doc["CityObjects"]) == ["B1", "P1"]
    try:
        write_cityjson([gml], (5000.0, 5000.0, 7000.0, 7000.0), 25833, tmp_path / "x.json")
    except ValueError:
        pass
    else:
        raise AssertionError("a tile without buildings must not be written")
    assert not (tmp_path / "x.json").exists()


def test_a_site_without_a_tree_cadastre_skips_the_trees(tmp_path):
    from bake import trees
    from bake.common import Tile

    tile = Tile("t", (0.0, 0.0, 2000.0, 2000.0), 25833, tmp_path / "raw", tmp_path / "data")
    (tmp_path / "raw" / "trees").mkdir(parents=True)
    (tmp_path / "raw" / "trees" / "t.geojson").write_text('{"features": []}')
    trees.run(tile)
    assert not (tmp_path / "data" / "dlm").exists()


def test_the_cadastre_query_carries_the_sites_crs():
    from bake.cadastre import REGISTERS

    q = REGISTERS["dresden"].query(
        "cls:L1261", (0.0, 0.0, 2000.0, 2000.0), 25832, resultType="hits"
    )
    assert "EPSG%3A%3A25832" in q and "cls%3AL1261" in q and "resultType=hits" in q


def test_saxony_links_come_from_the_batch_pages_current_shares(tmp_path, monkeypatch):
    # The link service has named retired shares (LoD2 and the laser scan
    # answered 503), so every tile product is taken from the catalogue the
    # batch page embeds today.
    from bake.fetch import Ctx
    from bake.providers import sn

    page = (
        "<script>batchConfig.products="
        '{"LSC":{"share_id":"NewLsc123","packagesize":2000,'
        '"filename":"lsc_33$Rechtswert$_$Hochwert$_2_sn_laz.zip"}};</script>'
    )
    fetched = []
    monkeypatch.setattr(sn, "fetch_text", lambda url: page)
    monkeypatch.setattr(sn, "download", lambda url, dest: fetched.append(url) or dest)
    sn.products.cache_clear()
    try:
        sn._zip(Ctx(tmp_path, tmp_path, 25833), "LSC", 414, 5656)
    finally:
        sn.products.cache_clear()
    assert fetched == [f"{sn.CLOUD}/NewLsc123/lsc_33414_5656_2_sn_laz.zip"]


def _http(code):
    import urllib.error

    return urllib.error.HTTPError("https://example.invalid/x.zip", code, "x", None, None)


def test_saxony_lod2_reads_the_ring_and_skips_only_missing_neighbours(tmp_path, monkeypatch):
    # A seam building may be filed in a neighbour's 2 km ZIP: the LoD2 fetch
    # asks for the 3x3 cells. A neighbour the server has no file for is
    # skipped; any other failure (a 503, a cut connection) raises, so the
    # tile is not written without its seam buildings.
    import pytest

    from bake.fetch import Ctx
    from bake.providers import sn

    tile = _tile((408000.0, 5708000.0, 410000.0, 5710000.0))
    asked = []
    failures = {}

    def fake_zip(ctx, product, e, n, keep=False):
        asked.append((e, n))
        if (e, n) in failures:
            raise failures[(e, n)]
        return tmp_path / f"{e}_{n}.zip"

    monkeypatch.setattr(sn, "_zip", fake_zip)
    monkeypatch.setattr(sn, "unzip_members", lambda path, pattern, dest: [path])
    ctx = Ctx(tmp_path, tmp_path, 25833)

    failures[(406, 5706)] = _http(404)
    files = sn.lod2(ctx, tile)
    assert sorted(asked) == sorted(cells(tile, 2, margin=1))
    assert len(files) == 8

    for err in (_http(503), OSError("cut connection")):
        failures[(406, 5706)] = err
        with pytest.raises(OSError):
            sn.lod2(ctx, tile)
    failures.clear()
    failures[(408, 5708)] = _http(404)
    with pytest.raises(OSError):
        sn.lod2(ctx, tile)


def test_saxony_extracts_each_cells_members_into_a_folder_of_its_own(tmp_path, monkeypatch):
    # GeoSN names a member alike in every cell's ZIP; extracted into one
    # folder, the first cell's file would stand in for all the others (the
    # extraction keeps a file already there).
    import zipfile

    from bake.providers import sn

    odd = _tile((409000.0, 5709000.0, 411000.0, 5711000.0))

    def fake_zip(ctx, product, e, n, keep=False):
        path = tmp_path / "zips" / f"{e}_{n}.zip"
        path.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(path, "w") as z:
            z.writestr("tile.gml", f"{e}_{n}")
        return path

    monkeypatch.setattr(sn, "_zip", fake_zip)
    files = sn._files(Ctx(tmp_path, tmp_path / "scratch", 25833), odd, "LoD2_CityGML", r"\.gml$")
    assert len(set(files)) == 4
    assert sorted(f.read_text() for f in files) == sorted(f"{e}_{n}" for e, n in cells(odd, 2))


def test_berlin_and_nrw_keep_the_lod2_ring_for_the_neighbouring_tiles(tmp_path, monkeypatch):
    # a 1 km cell of the ring is read by up to four tiles: it is downloaded
    # once into downloads/lod2/, not into each tile's scratch folder
    from bake.providers import be, nw

    tile = _tile((408000.0, 5708000.0, 410000.0, 5710000.0))
    names = [
        nw.PATTERNS["lod2"].format(e=e, n=n).replace("\\", "") for e, n in cells(tile, 1, margin=1)
    ]
    monkeypatch.setattr(nw, "listing", lambda product: names)
    monkeypatch.setattr(be, "unzip_members", lambda path, pattern, dest: [path])
    ctx = Ctx(tmp_path / "raw", tmp_path / "scratch", 25832)
    dests = {be: [], nw: []}
    for module, into in dests.items():
        monkeypatch.setattr(
            module, "download", lambda url, dest, into=into: into.append(dest) or dest
        )
        module.lod2(ctx, tile)
        assert len(into) == 16
        assert all(d.parent == ctx.downloads / "lod2" for d in into)


def test_nrw_lod2_reads_the_ring_and_skips_neighbours_the_listing_lacks(tmp_path, monkeypatch):
    import pytest

    from bake.fetch import Ctx
    from bake.providers import nw

    tile = _tile((408000.0, 5708000.0, 410000.0, 5710000.0))
    present = {c for c in cells(tile, 1, margin=1) if c != (407, 5707)}
    pattern = nw.PATTERNS["lod2"]
    names = [pattern.format(e=e, n=n).replace("\\", "") for e, n in present]
    monkeypatch.setattr(nw, "listing", lambda product: names)
    asked = []
    monkeypatch.setattr(nw, "download", lambda url, dest: asked.append(url) or dest)
    files = nw.lod2(Ctx(tmp_path, tmp_path, 25832), tile)
    assert len(files) == len(asked) == 15

    names.remove(pattern.format(e=408, n=5708).replace("\\", ""))
    with pytest.raises(FileNotFoundError):
        nw.lod2(Ctx(tmp_path, tmp_path, 25832), tile)


def _fetch_run(tmp_path, monkeypatch, fail: str, dlm: bool = False):
    """`fetch.run` over one tile with a fake adapter whose `fail` product
    raises ("osm": the OSM extract's download; "dlm": the Basis-DLM, which
    the spec asks for with `dlm`); nothing touches the network."""
    from types import SimpleNamespace

    from bake import fetch

    spec = parse(
        json.dumps(
            {
                "site": "x",
                "provider": "sn",
                "epsg": 25833,
                "products": {"dom": True, "dop": "rgbi", "dlm": dlm, "lsc": False},
                "credit": "Quelle: GeoSN, dl-de/by-2-0",
                "raw": str(tmp_path / "raw"),
                "data": str(tmp_path / "data"),
                "osm": "https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf",
                "tiles": [{"id": "t_sn", "bounds": [412000, 5656000, 414000, 5658000]}],
            }
        )
    )
    tried = []

    def product(name):
        def get(ctx, tile):
            tried.append(name)
            if name == fail:
                raise OSError(f"{name} unavailable")
            return [Path(name)]

        return get

    fake = SimpleNamespace(**{p: product(p) for p in ("dgm", "dom", "dop", "lod2", "lsc")})

    def fake_dlm(ctx):
        tried.append("dlm")
        if fail == "dlm":
            raise OSError("dlm unavailable")

    fake.dlm = fake_dlm

    def fake_download(url, dest, md5_url=None):
        tried.append("osm")
        if fail == "osm":
            raise OSError("osm unavailable")

    def touch(dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("x")

    monkeypatch.setattr(fetch, "adapter", lambda provider: fake)
    monkeypatch.setattr(fetch, "download", fake_download)
    monkeypatch.setattr(fetch, "dlm_complete", lambda folder: False)
    monkeypatch.setattr(fetch, "write_tile_raster", lambda files, tile, dest, *a, **k: touch(dest))
    monkeypatch.setattr(fetch, "write_cityjson", lambda files, bounds, epsg, dest: touch(dest))
    extras = []
    monkeypatch.setattr(fetch.cadastre, "fetch", lambda tile: extras.append("trees"))
    monkeypatch.setattr(fetch.traffic_sources, "fetch", lambda tile: extras.append("traffic"))

    def broken_wikidata(*args):
        extras.append("bridges")
        raise ValueError("not JSON")

    monkeypatch.setattr(fetch.bridge, "fetch_wikidata", broken_wikidata)
    monkeypatch.setattr(fetch.landmarks, "fetch_wikidata", lambda *a: extras.append("landmarks"))
    monkeypatch.setattr(fetch.monuments, "fetch_wikidata", lambda *a: extras.append("monuments"))
    fetch.run(spec, spec.tiles)
    return tried, extras


def test_a_failed_required_product_fails_the_fetch_after_the_rest(tmp_path, monkeypatch):
    import pytest

    with pytest.raises(SystemExit) as exit_info:
        _fetch_run(tmp_path, monkeypatch, "dgm")
    assert exit_info.value.code == 1
    # the other products and the extras were still tried
    assert (tmp_path / "data" / "cityjson" / "lod2_t_sn.city.json").exists()
    assert (tmp_path / "raw" / "dop" / "t_sn.tif").exists()


def test_a_failed_optional_product_or_extra_is_a_note(tmp_path, monkeypatch):
    # the orthophoto fails, and the bridges' Wikidata answer is not JSON:
    # both are a printed line, and the landmarks after it are still fetched
    tried, extras = _fetch_run(tmp_path, monkeypatch, "dop")
    assert set(tried) == {"osm", "dgm", "lod2", "dom", "dop"}
    assert extras == ["trees", "traffic", "bridges", "landmarks", "monuments"]


def test_a_failed_basis_dlm_or_osm_extract_fails_the_fetch_after_the_tiles(tmp_path, monkeypatch):
    # the land cover is not baked without the Basis-DLM (where the provider
    # has one), nor any OSM layer without the extract: the fetch still
    # fetches every tile, then exits 1
    import pytest

    for fail in ("dlm", "osm"):
        with pytest.raises(SystemExit) as exit_info:
            _fetch_run(tmp_path / fail, monkeypatch, fail, dlm=True)
        assert exit_info.value.code == 1
        assert (tmp_path / fail / "data" / "cityjson" / "lod2_t_sn.city.json").exists()
        assert (tmp_path / fail / "raw" / "dop" / "t_sn.tif").exists()


def test_a_fetched_basis_dlm_and_osm_extract_pass(tmp_path, monkeypatch):
    tried, _ = _fetch_run(tmp_path, monkeypatch, "none", dlm=True)
    assert {"dlm", "osm"} <= set(tried)
