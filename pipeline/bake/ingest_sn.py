"""Saxony's ingest adapter: GeoSN downloads → the canonical raw layout the
bakes read (bake/common.py `Tile`):

    <raw>/dom1/<tile>.tif (+ .tfw)   DOM1, layer 4 of the download service
    <raw>/dop/<tile>.tif             DOP RGBI, layer 17
    <raw>/dlm/*.shp                  Basis-DLM, the statewide Shape package
    <raw>/osm/*.osm.pbf              OpenStreetMap: the Geofabrik extract

Downloads are cached under <raw>/downloads/ and never fetched twice. The
DGM1 and the CityJSON are committed under data/ (ADR 0004) and not touched.
Usage (via `bun run bake --ingest`, or directly):

    python -m bake.ingest_sn --raw data/_raw/dresden --tile 33412_5656_2_sn \\
        --bounds 412000 5656000 414000 5658000
"""

from __future__ import annotations

import argparse
import json
import shutil
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

SERVICE = (
    "https://geodienste.sachsen.de/ags-relay/ArcGISServer/guest/arcgis/rest/"
    "services/geosn/rest_geosn_downloadlinks/MapServer"
)
LAYERS = {"dom1": 4, "dop": 17}
# One statewide package, replaced quarterly under the same URL (the share
# token may rotate: see docs/data-pipeline.md#provenance).
BASIS_DLM = (
    "https://geocloud.landesvermessung.sachsen.de/public.php/dav/files/"
    "DtPWngtLEJP8K3k/basisdlm_sn_shape.zip"
)
OSM = "https://download.geofabrik.de/europe/germany/sachsen-latest.osm.pbf"


def download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"downloading {url}")
    with urllib.request.urlopen(url) as res, open(tmp, "wb") as out:
        shutil.copyfileobj(res, out, length=1 << 20)
    tmp.rename(dest)
    return dest


def download_link(layer: int, bounds: list[float], tile_key: str) -> str:
    """The product's ZIP for one tile, from the portal's own link service."""
    xmin, ymin, xmax, ymax = bounds
    # A point inside the tile, so neighbouring tiles that touch its edge do
    # not match.
    geometry = {"x": (xmin + xmax) / 2, "y": (ymin + ymax) / 2, "spatialReference": {"wkid": 25833}}
    query = urllib.parse.urlencode(
        {
            "geometry": json.dumps(geometry),
            "geometryType": "esriGeometryPoint",
            "inSR": 25833,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "*",
            "returnGeometry": "false",
            "f": "json",
        }
    )
    with urllib.request.urlopen(f"{SERVICE}/{layer}/query?{query}") as res:
        features = json.load(res).get("features", [])
    for f in features:
        attrs = f.get("attributes", {})
        if str(attrs.get("Kachel")) == tile_key:
            return attrs["Download"]
    if len(features) == 1:
        return features[0]["attributes"]["Download"]
    raise SystemExit(f"layer {layer}: no download for tile {tile_key}")


def extract(zip_path: Path, suffixes: tuple[str, ...], dest: Path, stem: str) -> None:
    """The members with `suffixes` of a ZIP, renamed to `<stem><suffix>`."""
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for member in z.namelist():
            for suffix in suffixes:
                if member.lower().endswith(suffix) and not member.lower().endswith(".aux.xml"):
                    with z.open(member) as src, open(dest / f"{stem}{suffix}", "wb") as out:
                        shutil.copyfileobj(src, out)


def ingest_tile(raw: Path, tile: str, bounds: list[float]) -> None:
    # "33412_5656_2_sn" → the service's tile key "4125656"
    east, north = tile.split("_")[:2]
    key = f"{east[2:]}{north}"
    for product, layer in LAYERS.items():
        target = raw / product / f"{tile}.tif"
        if target.exists():
            continue
        url = download_link(layer, bounds, key)
        zip_path = download(url, raw / "downloads" / Path(urllib.parse.urlparse(url).path).name)
        extract(zip_path, (".tif", ".tfw"), raw / product, tile)
        print(f"{tile}: {product} → {target}")


def ingest_dlm(raw: Path) -> None:
    dlm = raw / "dlm"
    if any(dlm.glob("*.shp")):
        return
    outer = download(BASIS_DLM, raw / "downloads" / "basisdlm_sn_shape.zip")
    dlm.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(outer) as z:
        for member in z.namelist():
            if member.lower().endswith(".zip"):
                with z.open(member) as inner, zipfile.ZipFile(inner) as shapes:
                    for name in shapes.namelist():
                        if Path(name).suffix.lower() in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
                            with shapes.open(name) as src, open(dlm / Path(name).name, "wb") as out:
                                shutil.copyfileobj(src, out)
    print(f"Basis-DLM → {dlm}")


def ingest_osm(raw: Path) -> None:
    osm = raw / "osm"
    if any(osm.glob("*.osm.pbf")):
        return
    try:
        download(OSM, osm / Path(OSM).name)
    except OSError as err:
        print(f"OSM extract not downloaded ({err}); put a .osm.pbf into {osm}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="bake.ingest_sn")
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--tile", required=True)
    parser.add_argument("--bounds", nargs=4, type=float, required=True)
    args = parser.parse_args()
    ingest_dlm(args.raw)
    ingest_osm(args.raw)
    ingest_tile(args.raw, args.tile, args.bounds)


if __name__ == "__main__":
    main()
