"""Dresden's street-tree cadastre (Stadtbaumkataster) → the canonical raw
layout the `trees` bake reads (trees.py):

    <raw>/trees/<tile>.geojson        one Point per tree, EPSG of the site,
                                      properties {taxon, name, h, d}, and
                                      the credit as an `attribution` member
    <raw>/trees/<tile>.meta.json      the request, the date, numberMatched

Source: the city's WFS 2.0, feature type cls:L1261 "Stadtbäume" — street
trees, parks, schools and other municipal land (NOT the Großer Garten, NOT
private courtyards). Licence dl-de/by-2-0, credit "Landeshauptstadt Dresden".
The service implements no paging, so one request per tile returns every tree;
the response is trusted only when its feature count equals the server's
numberMatched. The raw WFS response is cached under <raw>/downloads/ and never
fetched twice. Usage (via `bun run bake --ingest`, or directly):

    python -m bake.ingest_trees_dresden --raw data/_raw/dresden \\
        --tile 33412_5656_2_sn --bounds 412000 5656000 414000 5658000
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

WFS = "https://kommisdd.dresden.de/net3/public/ogcsl.ashx"
TYPE_NAME = "cls:L1261"
# A tree on the seam lands in both requests; the bake keeps it in its owner.
MARGIN_M = 10
STUMP = "Stammstück"
ATTRIBUTION = "Stadtbaumkataster © Landeshauptstadt Dresden (dl-de/by-2-0)"


def wfs_url(bounds: list[float], extra: dict[str, str]) -> str:
    xmin, ymin, xmax, ymax = bounds
    bbox = (
        f"{xmin - MARGIN_M:.0f},{ymin - MARGIN_M:.0f},{xmax + MARGIN_M:.0f},{ymax + MARGIN_M:.0f},"
        "urn:ogc:def:crs:EPSG::25833"
    )
    query = {
        "NODEID": "1633",
        "Service": "WFS",
        "Version": "2.0.0",
        "Request": "GetFeature",
        "TypeNames": TYPE_NAME,
        "BBOX": bbox,
        **extra,
    }
    return f"{WFS}?{urllib.parse.urlencode(query)}"


def number_matched(bounds: list[float]) -> int:
    with urllib.request.urlopen(wfs_url(bounds, {"resultType": "hits"}), timeout=300) as res:
        m = re.search(r'numberMatched="(\d+)"', res.read().decode("utf-8", "replace"))
    if not m:
        raise SystemExit("trees: the WFS hits request failed")
    return int(m.group(1))


def fetch(raw: Path, tile: str, bounds: list[float]) -> tuple[dict, int]:
    """The complete WFS response for the tile, cached."""
    cache = raw / "downloads" / f"stadtbaum_{tile}.geojson"
    meta_path = cache.with_suffix(".meta.json")
    if cache.exists() and meta_path.exists():
        doc = json.loads(cache.read_text())
        matched = json.loads(meta_path.read_text())["numberMatched"]
        if len(doc.get("features", [])) == matched:
            return doc, matched
    matched = number_matched(bounds)
    url = wfs_url(bounds, {"outputFormat": "application/geo+json"})
    print(f"{tile}: fetching the Stadtbaumkataster ({matched} trees)")
    with urllib.request.urlopen(url, timeout=300) as res:
        doc = json.load(res)
    if len(doc.get("features", [])) != matched:
        raise SystemExit(f"trees: incomplete WFS response ({matched} expected)")
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(doc))
    meta_path.write_text(
        json.dumps(
            {
                "service": f"{WFS}?NODEID=1633&Service=WFS",
                "typeName": TYPE_NAME,
                "bbox": wfs_url(bounds, {}),
                "numberMatched": matched,
                "retrieved": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
                "licence": "dl-de/by-2-0, Landeshauptstadt Dresden",
            },
            indent=2,
        )
    )
    return doc, matched


def positive(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and value > 0 else None


def canonical(doc: dict) -> list[dict]:
    """The cadastre's trees as canonical Points: the surveyed UTM position
    (gis_x_utm/gis_y_utm, the geometry to the µm), taxon, German name,
    height and crown diameter (m, None where not surveyed). Trunk stumps are
    no trees."""
    out = []
    for f in doc.get("features", []):
        p = f.get("properties") or {}
        x, y = p.get("gis_x_utm"), p.get("gis_y_utm")
        taxon = (p.get("art_botanisch") or "").strip()
        if x is None or y is None or taxon == STUMP:
            continue
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "taxon": taxon,
                    "name": (p.get("art_deutsch") or "").strip(),
                    "h": positive(p.get("baumhoehe_akt")),
                    "d": positive(p.get("kronendurchmesser_akt")),
                },
                "geometry": {"type": "Point", "coordinates": [float(x), float(y)]},
            }
        )
    return out


def ingest(raw: Path, tile: str, bounds: list[float]) -> None:
    target = raw / "trees" / f"{tile}.geojson"
    if target.exists():
        return
    doc, _ = fetch(raw, tile, bounds)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(
            {"type": "FeatureCollection", "attribution": ATTRIBUTION, "features": canonical(doc)}
        )
    )
    print(f"{tile}: cadastre trees → {target}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="bake.ingest_trees_dresden")
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--tile", required=True)
    parser.add_argument("--bounds", nargs=4, type=float, required=True)
    args = parser.parse_args()
    ingest(args.raw, args.tile, args.bounds)


if __name__ == "__main__":
    main()
