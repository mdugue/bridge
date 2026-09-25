"""Units of the fetch step that need no network: the CityGML converter, the
provider-grid helper, the XYZ gridding, the OSM class mapping and the spec."""

import json
from pathlib import Path

import numpy as np
import rasterio

from bake.citygml import convert, write_cityjson
from bake.common import Tile
from bake.fetch import cells
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
                "products": {"dom": True, "dop": None, "dlm": False},
                "credit": "Quelle: GeoSN, dl-de/by-2-0",
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
