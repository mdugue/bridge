"""CityGML (the AdV LoD2 profile every Land publishes) → the CityJSON the
build reads (scripts/bake-city-mesh.ts, pipeline/bake/roof_colour.py).

Streams the files, so a 150 MB tile never sits in memory as a tree. Per
Building and BuildingPart it keeps what the build uses: the thematic
surfaces (`boundedBy` → Wall/Roof/Ground/ClosureSurface polygons) as one
semantic MultiSurface, `function`, `roofType`, `measuredHeight`,
`storeysAboveGround`, the generic attributes (`Dachneigung`, …), the
envelope, and the Building → BuildingPart links. The `lod2Solid` only
references those same polygons, so it is not repeated. A building belongs
to the tile holding the centre of its envelope, so one on a download seam
exists once.
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from collections.abc import Iterable, Iterator
from pathlib import Path

from .common import owns

NS = {
    "gml": "http://www.opengis.net/gml",
    "bldg": "http://www.opengis.net/citygml/building/1.0",
    "core": "http://www.opengis.net/citygml/1.0",
    "gen": "http://www.opengis.net/citygml/generics/1.0",
}
# CityGML 2.0 has the same building model under new namespaces: its tags
# are read as the 1.0 ones.
V2 = {
    "http://www.opengis.net/citygml/building/2.0": NS["bldg"],
    "http://www.opengis.net/citygml/2.0": NS["core"],
    "http://www.opengis.net/citygml/generics/2.0": NS["gen"],
}
GML_ID = f"{{{NS['gml']}}}id"
SURFACES = ("WallSurface", "RoofSurface", "GroundSurface", "ClosureSurface")
# CityGML generic attribute → JSON type
GENERIC = {"stringAttribute": str, "intAttribute": int, "doubleAttribute": float}
BLDG_ATTRIBUTES = {"function": str, "roofType": str, "measuredHeight": float}
SCALE = 0.001  # millimetres, like the CityJSON the repo started from


def _tag(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _ring(el: ET.Element) -> list[tuple[float, float, float]]:
    pos_list = el.find("gml:posList", NS)
    if pos_list is not None and pos_list.text:
        v = [float(t) for t in pos_list.text.split()]
        pts = list(zip(v[0::3], v[1::3], v[2::3], strict=True))
    else:
        pts = [tuple(float(t) for t in p.text.split()[:3]) for p in el.findall("gml:pos", NS)]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def _polygons(surface: ET.Element) -> Iterator[list[list[tuple[float, float, float]]]]:
    """Every polygon of a thematic surface as [exterior, *interiors]."""
    for poly in surface.iter(f"{{{NS['gml']}}}Polygon"):
        exterior = poly.find("gml:exterior/gml:LinearRing", NS)
        if exterior is None:
            continue
        rings = [_ring(exterior)]
        rings += [_ring(r) for r in poly.findall("gml:interior/gml:LinearRing", NS)]
        if len(rings[0]) >= 3:
            yield [r for r in rings if len(r) >= 3]


def _attributes(el: ET.Element) -> dict:
    attrs: dict = {}
    name = el.find("gml:name", NS)
    if name is not None and name.text:
        attrs["name"] = name.text
    created = el.find("core:creationDate", NS)
    if created is not None and created.text:
        attrs["creationDate"] = created.text
    for child in el:
        kind = _tag(child)
        if kind in GENERIC and child.get("name"):
            value = child.find("gen:value", NS)
            if value is not None and value.text is not None:
                try:
                    attrs[child.get("name")] = GENERIC[kind](value.text)
                except ValueError:
                    attrs[child.get("name")] = value.text
        elif kind in BLDG_ATTRIBUTES and child.text:
            attrs[kind] = BLDG_ATTRIBUTES[kind](child.text.strip())
        elif kind == "storeysAboveGround" and child.text:
            attrs[kind] = int(float(child.text))
    return attrs


def _envelope(el: ET.Element) -> list[float] | None:
    lower = el.find("gml:boundedBy/gml:Envelope/gml:lowerCorner", NS)
    upper = el.find("gml:boundedBy/gml:Envelope/gml:upperCorner", NS)
    if lower is None or upper is None:
        return None
    return [float(t) for t in lower.text.split()[:3]] + [float(t) for t in upper.text.split()[:3]]


class _Builder:
    """Collects city objects with shared, deduplicated integer vertices."""

    def __init__(self) -> None:
        self.objects: dict[str, dict] = {}
        self.vertices: list[tuple[int, int, int]] = []
        self.index: dict[tuple[int, int, int], int] = {}

    def vertex(self, p: tuple[float, float, float]) -> int:
        key = (round(p[0] / SCALE), round(p[1] / SCALE), round(p[2] / SCALE))
        i = self.index.get(key)
        if i is None:
            i = self.index[key] = len(self.vertices)
            self.vertices.append(key)
        return i

    def add(self, el: ET.Element, kind: str, parent: str | None) -> str:
        oid = el.get(GML_ID) or f"{kind}_{len(self.objects)}"
        obj: dict = {"type": kind, "attributes": _attributes(el)}
        boundaries, values, surfaces = [], [], []
        for bounded in el.findall("bldg:boundedBy", NS):
            for surface in bounded:
                if _tag(surface) not in SURFACES:
                    continue
                s = len(surfaces)
                surfaces.append({"type": _tag(surface)})
                for rings in _polygons(surface):
                    boundaries.append([[self.vertex(p) for p in ring] for ring in rings])
                    values.append(s)
        if boundaries:
            obj["geometry"] = [
                {
                    "type": "MultiSurface",
                    "lod": "2",
                    "boundaries": boundaries,
                    "semantics": {"surfaces": surfaces, "values": values},
                }
            ]
        extent = _envelope(el)
        if extent:
            obj["geographicalExtent"] = extent
        if parent:
            obj["parents"] = [parent]
        self.objects[oid] = obj
        children = [
            self.add(part, "BuildingPart", oid)
            for part in el.findall("bldg:consistsOfBuildingPart/bldg:BuildingPart", NS)
        ]
        if children:
            obj["children"] = children
        return oid

    def document(self, epsg: int) -> dict:
        mins = [min((v[k] for v in self.vertices), default=0) for k in range(3)]
        return {
            "type": "CityJSON",
            "version": "2.0",
            "transform": {"scale": [SCALE] * 3, "translate": [round(m * SCALE, 3) for m in mins]},
            "metadata": {"referenceSystem": f"https://www.opengis.net/def/crs/EPSG/0/{epsg}"},
            "CityObjects": self.objects,
            "vertices": [[v[0] - mins[0], v[1] - mins[1], v[2] - mins[2]] for v in self.vertices],
        }


def _centre(el: ET.Element) -> tuple[float, float] | None:
    extent = _envelope(el)
    if extent:
        return (extent[0] + extent[3]) / 2, (extent[1] + extent[4]) / 2
    xs, ys = [], []
    for pos_list in el.iter(f"{{{NS['gml']}}}posList"):
        v = [float(t) for t in pos_list.text.split()]
        xs += v[0::3]
        ys += v[1::3]
    for pos in el.iter(f"{{{NS['gml']}}}pos"):
        v = [float(t) for t in pos.text.split()]
        xs.append(v[0])
        ys.append(v[1])
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2) if xs else None


def buildings(path: Path) -> Iterator[ET.Element]:
    """Each top-level bldg:Building of a CityGML file, parsed, then freed."""
    building = f"{{{NS['bldg']}}}Building"
    member = f"{{{NS['core']}}}cityObjectMember"
    for _, el in ET.iterparse(path, events=("end",)):
        uri, _, local = el.tag[1:].partition("}")
        if uri in V2:
            el.tag = f"{{{V2[uri]}}}{local}"
        if el.tag == member:
            yield from el.findall(building)
            el.clear()


def convert(sources: Iterable[Path], bounds: tuple[float, float, float, float], epsg: int) -> dict:
    """The CityJSON of every building in `sources` owned by `bounds`."""
    out = _Builder()
    for path in sources:
        for b in buildings(path):
            centre = _centre(b)
            if centre and owns(bounds, *centre) and b.get(GML_ID) not in out.objects:
                out.add(b, "Building", None)
    return out.document(epsg)


def write_cityjson(
    sources: Iterable[Path], bounds: tuple[float, float, float, float], epsg: int, dest: Path
) -> int:
    sources = list(sources)
    if not sources:
        raise ValueError(f"no CityGML for {dest.name}")
    doc = convert(sources, bounds, epsg)
    count = sum(1 for o in doc["CityObjects"].values() if o["type"] == "Building")
    if count == 0:
        raise ValueError(f"no building of the CityGML lies on the tile ({dest.name})")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    tmp.write_text(json.dumps(doc, separators=(",", ":")))
    tmp.rename(dest)
    return count
