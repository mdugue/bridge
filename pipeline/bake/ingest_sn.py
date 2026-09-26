"""Saxony's ingest adapter: GeoSN downloads → the canonical raw layout the
bakes read (bake/common.py `Tile`):

    <raw>/dom1/<tile>.tif (+ .tfw)   DOM1, layer 4 of the download service
    <raw>/dop/<tile>.tif             DOP RGBI, layer 17
    <raw>/dlm/*.shp                  Basis-DLM, the statewide Shape package
    <raw>/osm/*.osm.pbf              OpenStreetMap: the Geofabrik extract
    <raw>/trees/<tile>.geojson       Dresden's street-tree cadastre (the
                                     city's WFS; empty outside Dresden)
    <raw>/lsc/<tile>.laz             the GeoSN laser scan, layer 1 — only
                                     with --lsc (≈380 MB a tile), for the
                                     hedge heights and the scan trees
    <raw>/wikidata/bridges_<tile>.json   the bridges Wikidata knows (bridge.py)

Downloads are cached under <raw>/downloads/ and never fetched twice. The
DGM1 and the CityJSON are committed under data/ (ADR 0004) and not touched.
Usage (via `bun run bake --ingest`, or directly):

    python -m bake.ingest_sn --raw data/_raw/dresden --tile 33412_5656_2_sn \\
        --bounds 412000 5656000 414000 5658000
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import http.client
import json
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from .bridge import fetch_wikidata

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
# The portal's batch download page carries the catalogue of every product's
# current share (id + file name pattern). The link service above has lagged
# behind a rotated share before (LoD2 and the laser scan answered 503 under
# the id it still named), so a failed download is retried under the share
# the catalogue names today.
BATCH_PAGE = "https://www.geodaten.sachsen.de/batch-download-4719.html"
GEOCLOUD = "https://geocloud.landesvermessung.sachsen.de/public.php/dav/files"


def _check_zip(path: Path, url: str) -> None:
    """Raises OSError unless every member of the ZIP reads back intact."""
    try:
        with zipfile.ZipFile(path) as z:
            bad = z.testzip()
    except zipfile.BadZipFile as err:
        raise OSError(f"{url}: not a ZIP ({err})") from err
    if bad is not None:
        raise OSError(f"{url}: corrupt member {bad}")


def _published_md5(md5_url: str) -> str | None:
    """The hash a `<hash>  <name>` file publishes, or None when it cannot be
    read (the download then goes on unverified rather than being lost)."""
    try:
        with urllib.request.urlopen(md5_url) as res:
            return res.read().decode("ascii", "replace").split()[0].lower()
    except (OSError, http.client.HTTPException, IndexError) as err:
        print(f"{md5_url}: {err} — keeping the download unverified")
        return None


def download(url: str, dest: Path, md5_url: str | None = None) -> Path:
    """`url` to `dest`, checked before it takes the name: the byte count
    against Content-Length (a cut connection), a ZIP's CRCs, and the
    published md5 when there is one (read first, so an extract replaced
    mid-download fails the check instead of passing a stale one). A download
    that fails a check is deleted and raises OSError, so the cache never
    holds a broken file; a ZIP cached before these checks is tested once."""
    marker = dest.with_suffix(dest.suffix + ".checked")
    if dest.exists() and dest.stat().st_size > 0:
        if dest.suffix.lower() != ".zip" or marker.exists():
            return dest
        try:
            _check_zip(dest, url)
            marker.touch()
            return dest
        except OSError as err:
            print(f"{err} — the cached copy is dropped and fetched again")
            dest.unlink()
    dest.parent.mkdir(parents=True, exist_ok=True)
    # A marker left from a deleted copy must not vouch for the next one.
    marker.unlink(missing_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    published = _published_md5(md5_url) if md5_url is not None else None
    print(f"downloading {url}")
    digest = hashlib.md5()
    written = 0
    try:
        try:
            with urllib.request.urlopen(url) as res, open(tmp, "wb") as out:
                expected = res.headers.get("Content-Length")
                while chunk := res.read(1 << 20):
                    out.write(chunk)
                    digest.update(chunk)
                    written += len(chunk)
        except http.client.HTTPException as err:  # e.g. IncompleteRead
            raise OSError(f"{url}: {err!r}") from err
        if expected is not None and written != int(expected):
            raise OSError(f"{url}: {written} of {expected} bytes")
        if dest.suffix.lower() == ".zip":
            _check_zip(tmp, url)
        if published is not None and published != digest.hexdigest():
            raise OSError(f"{url}: md5 {digest.hexdigest()}, published {published}")
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    tmp.rename(dest)
    if dest.suffix.lower() == ".zip":
        marker.touch()
    return dest


def share_catalogue(page: str) -> list[tuple[str, str]]:
    """(share id, file name pattern) per product, from the batch page's
    embedded configuration. Patterns name the tile as `$Rechtswert$` and
    `$Hochwert$`."""
    return re.findall(r'"share_id":"(\w+)","packagesize":\d+,"filename":"([^"]+)"', page)


def current_share_url(name: str, catalogue: list[tuple[str, str]]) -> str | None:
    """The URL of the product file `name` under the share the catalogue
    names today, or None when no product's pattern matches."""
    for share, pattern in catalogue:
        rx = (
            re.escape(pattern)
            .replace(re.escape("$Rechtswert$"), r"\d+")
            .replace(re.escape("$Hochwert$"), r"\d+")
        )
        if re.fullmatch(rx, name):
            return f"{GEOCLOUD}/{share}/{name}"
    return None


def download_product(url: str, downloads: Path) -> Path:
    """A product ZIP into `downloads`; when its share answers with an error,
    again under the share the batch page names today."""
    name = Path(urllib.parse.urlparse(url).path).name
    try:
        return download(url, downloads / name)
    except urllib.error.HTTPError as err:
        with urllib.request.urlopen(BATCH_PAGE) as res:
            page = res.read().decode("utf-8", "replace")
        fresh = current_share_url(name, share_catalogue(page))
        if fresh is None or fresh == url:
            raise
        print(f"{name}: {err} under the linked share; retrying under the current one")
        return download(fresh, downloads / name)


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
        zip_path = download_product(url, raw / "downloads")
        extract(zip_path, (".tif", ".tfw"), raw / product, tile)
        print(f"{tile}: {product} → {target}")


def ingest_lsc(raw: Path, tile: str, bounds: list[float]) -> None:
    """The laser scan for one tile (opt-in: ≈380 MB). A failed download is a
    note, not an error: the hedge step then falls back to OSM only."""
    target = raw / "lsc" / f"{tile}.laz"
    if target.exists():
        return
    east, north = tile.split("_")[:2]
    try:
        url = download_link(1, bounds, f"{east[2:]}{north}")
        zip_path = download_product(url, raw / "downloads")
    except (OSError, SystemExit) as err:
        print(f"{tile}: laser scan not downloaded ({err}); put the LAZ at {target} by hand")
        return
    extract(zip_path, (".laz",), raw / "lsc", tile)
    print(f"{tile}: lsc → {target}")


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
        download(OSM, osm / Path(OSM).name, md5_url=f"{OSM}.md5")
    except OSError as err:
        print(f"OSM extract not downloaded ({err}); put a .osm.pbf into {osm}")


# The city's WFS 2.0, feature type cls:L1261 "Stadtbäume" (dl-de/by-2-0,
# Landeshauptstadt Dresden). It implements no paging and no count default, so
# one request returns every tree; the cache is trusted only when its feature
# count equals the server's numberMatched.
TREES_WFS = "https://kommisdd.dresden.de/net3/public/ogcsl.ashx"
TREES_MARGIN = 10  # m: a tree on the seam lands in both requests


def _trees_query(bounds: list[float], **extra: str) -> str:
    xmin, ymin, xmax, ymax = bounds
    m = TREES_MARGIN
    bbox = (
        f"{xmin - m:.0f},{ymin - m:.0f},{xmax + m:.0f},{ymax + m:.0f},urn:ogc:def:crs:EPSG::25833"
    )
    params = {
        "NODEID": "1633",
        "Service": "WFS",
        "Version": "2.0.0",
        "Request": "GetFeature",
        "TypeNames": "cls:L1261",
        "BBOX": bbox,
        **extra,
    }
    return f"{TREES_WFS}?{urllib.parse.urlencode(params)}"


def _trees_complete(raw_path: Path, meta_path: Path) -> bool:
    try:
        doc = json.loads(raw_path.read_text())
        meta = json.loads(meta_path.read_text())
    except (OSError, ValueError):
        return False
    feats = doc.get("features")
    return isinstance(feats, list) and len(feats) == meta.get("numberMatched")


def ingest_trees(raw: Path, tile: str, bounds: list[float]) -> None:
    """The street-tree cadastre over the tile (+ a margin) as GeoJSON, with a
    sidecar recording the request, the date and the server's count."""
    out = raw / "trees"
    raw_path = out / f"{tile}.geojson"
    meta_path = out / f"{tile}.meta.json"
    if _trees_complete(raw_path, meta_path):
        return
    out.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(_trees_query(bounds, resultType="hits"), timeout=300) as res:
            m = re.search(r'numberMatched="(\d+)"', res.read().decode("utf-8", "replace"))
        if not m:
            print(f"{tile}: tree cadastre hits request failed — no inventory trees")
            return
        query = _trees_query(bounds, outputFormat="application/geo+json")
        with urllib.request.urlopen(query, timeout=300) as res:
            raw_path.write_bytes(res.read())
    except OSError as err:
        print(f"{tile}: tree cadastre not downloaded ({err})")
        return
    meta_path.write_text(
        json.dumps(
            {
                "service": f"{TREES_WFS}?NODEID=1633&Service=WFS",
                "typeName": "cls:L1261",
                "bounds": bounds,
                "outputFormat": "application/geo+json",
                "numberMatched": int(m.group(1)),
                "retrieved": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
                "licence": "dl-de/by-2-0, Landeshauptstadt Dresden",
            },
            indent=2,
        )
    )
    if not _trees_complete(raw_path, meta_path):
        raw_path.unlink(missing_ok=True)
        print(f"{tile}: the tree cadastre response is incomplete — retry later")
        return
    print(f"{tile}: tree cadastre → {raw_path}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="bake.ingest_sn")
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--tile", required=True)
    parser.add_argument("--bounds", nargs=4, type=float, required=True)
    parser.add_argument("--lsc", action="store_true", help="also the laser scan (≈380 MB a tile)")
    args = parser.parse_args()
    ingest_dlm(args.raw)
    ingest_osm(args.raw)
    ingest_tile(args.raw, args.tile, args.bounds)
    ingest_trees(args.raw, args.tile, args.bounds)
    if args.lsc:
        ingest_lsc(args.raw, args.tile, args.bounds)
    # Saxony's grid is EPSG:25833
    fetch_wikidata(args.raw, args.tile, args.bounds, 25833)


if __name__ == "__main__":
    main()
