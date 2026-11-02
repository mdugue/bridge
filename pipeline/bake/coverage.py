"""What the bakes make of OpenStreetMap's things that stand in a city — the
coverage check (`python -m bake coverage --spec …`, `bun run osm-coverage
<site>`).

A thing nobody decided about is a thing the twin silently lacks: Dresden's
Standseilbahn was mapped all along and drawn by nothing until a walk
passed it. So every value of the keys that name a built thing (`KEYS`,
and the single tags of `PAIRS`) is in `LEDGER`, with what becomes of it:

- `Drawn(module)`: a bake in `pipeline/bake/<module>.py` reads it (the
  unit test holds the module to naming the value);
- `Planned(what)`: decided, not built yet — the follow-up that draws it;
- `Left(reason)`: left out, and why (under the ground, flush with the
  paving, a mark on a map rather than a thing, too small to see).

The check counts each value in the site's extract over the site's tiles
(points, lines and areas, one count per OSM object) and fails on a value
seen at least `MIN_COUNT` times that the ledger does not know: a new city
brings its own things (a cable car, a lift up a cliff), and they are
decided before it ships, not found by a visitor.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from . import osm_index
from .common import Tile
from .osm import wgs84_bbox

# The keys whose every value is a decision.
KEYS = ("railway", "aerialway", "man_made", "power", "historic")
# Single tags of other keys that name a built thing.
PAIRS = (("route", "ferry"), ("highway", "elevator"))
# A value seen this often in a site is decided before the site ships.
MIN_COUNT = 3


@dataclass(frozen=True)
class Drawn:
    module: str


@dataclass(frozen=True)
class Planned:
    what: str


@dataclass(frozen=True)
class Left:
    reason: str


Fate = Drawn | Planned | Left

UNDER = Left("under the ground or a mark on the line, nothing to see")
NOT_THERE = Left("not built, or gone: nothing stands")
FLUSH = Left("flush with the ground or the paving")
TINY = Left("smaller than a pixel at walking distance")
AREA = Left("an area's use, not a thing: its buildings are LoD2's")
MEMORY = Left("a remembrance or a mark on a map, not a built thing")
BUILDING = Left("a building: LoD2's")

LEDGER: dict[str, dict[str, Fate]] = {
    "railway": {
        "rail": Drawn("rail_osm"),
        "light_rail": Drawn("rail_osm"),
        "narrow_gauge": Drawn("rail_osm"),
        "subway": Drawn("rail_osm"),
        "tram": Drawn("tram"),
        "platform": Drawn("rail"),
        "tram_stop": Drawn("tram"),
        "stop": Left("where a train halts on the line: its platform is drawn"),
        "crossing": Left("where a path crosses: the tracks and path are drawn"),
        "funicular": Planned("funicular and monorail tracks (#239)"),
        "monorail": Planned("funicular and monorail tracks (#239)"),
        "signal": Planned("railway signals and buffer stops"),
        "buffer_stop": Planned("railway signals and buffer stops"),
        "turntable": Planned("turntables and traversers"),
        "traverser": Planned("turntables and traversers"),
        "disused": Left(
            "out of use: its rails often still lie, overgrown — not drawn yet (a candidate)"
        ),
        "abandoned": NOT_THERE,
        "razed": NOT_THERE,
        "proposed": NOT_THERE,
        "construction": NOT_THERE,
        "platform_edge": Left("the platform's edge: the platform is drawn"),
        "station": Left("a station's name point: its buildings are LoD2's"),
        "halt": Left("a halt's name point: its platform is drawn"),
        "subway_entrance": Left("an entrance into a building or stairs (stairs.py)"),
        "train_station_entrance": Left("a door in a LoD2 station"),
        "level_crossing": Left("where a road crosses: the tracks and road are drawn"),
        "tram_level_crossing": Left("where a road crosses: the tracks and road are drawn"),
        "tram_crossing": Left("where a path crosses: the tracks and path are drawn"),
        "railway_crossing": Left("where two lines cross: both are drawn"),
        "switch": UNDER,
        "switch;signal": UNDER,
        "milestone": TINY,
        "derail": UNDER,
        "balise_group": UNDER,
        "vacancy_detection": UNDER,
        "key_switch": TINY,
        "owner_change": UNDER,
        "junction": UNDER,
        "phone": TINY,
        "radio": TINY,
        "power_supply": TINY,
        "water_crane": TINY,
        "fuel": TINY,
        "site": Left("a railway site's area: its buildings are LoD2's"),
        "yard": Left("a yard's name: its tracks are drawn"),
        "signal_box": BUILDING,
        "engine_shed": BUILDING,
        "roundhouse": BUILDING,
    },
    "aerialway": {
        "cable_car": Planned("aerial lifts: none mapped in a site yet"),
        "gondola": Planned("aerial lifts: none mapped in a site yet"),
        "chair_lift": Planned("aerial lifts: none mapped in a site yet"),
        "station": Planned("aerial lifts: none mapped in a site yet"),
        "pylon": Planned("aerial lifts: none mapped in a site yet"),
    },
    "man_made": {
        "chimney": Drawn("structures"),
        "tower": Drawn("structures"),
        "mast": Drawn("structures"),
        "communications_tower": Drawn("structures"),
        "water_tower": Drawn("structures"),
        "lighthouse": Drawn("structures"),
        "bridge": Drawn("rail_osm"),
        "pier": Drawn("riverside"),
        "quay": Left("measured where the water meets the land (walls.py), not read from OSM"),
        "embankment": Drawn("walls"),
        "obelisk": Left("drawn where it is a memorial (monuments.py); alone a candidate"),
        "column": Left("drawn where it is a memorial (monuments.py); alone a candidate"),
        "water_tap": TINY,
        "advertising": Drawn("furniture"),
        "planter": Left("a planter box: not drawn yet (a candidate)"),
        "crane": Planned("cranes, storage tanks and silos"),
        "storage_tank": Planned("cranes, storage tanks and silos"),
        "silo": Planned("cranes, storage tanks and silos"),
        "gantry": Planned("cranes, storage tanks and silos"),
        "flagpole": Planned("flagpoles"),
        "maypole": Planned("flagpoles"),
        "antenna": Planned("flagpoles"),
        "tunnel": Left("a tunnel's lid: passages.py cuts building passages"),
        "breakwater": Left("in the water at the harbour: not drawn yet (a candidate)"),
        "dyke": Left("an earth bank: the DGM holds it"),
        "groyne": Drawn("riverside"),
        "pipeline": UNDER,
        "manhole": FLUSH,
        "survey_point": TINY,
        "street_cabinet": Left(
            "a grey box about a metre tall, everywhere: not drawn yet (a candidate)"
        ),
        "surveillance": TINY,
        "monitoring_station": TINY,
        "charge_point": Left("a post at a parking space: not drawn yet (a candidate)"),
        "utility_pole": Planned("overhead power lines"),
        "courtyard": AREA,
        "works": AREA,
        "wastewater_plant": AREA,
        "water_works": AREA,
        "reservoir_covered": Left("a covered reservoir: grass on top, the DGM holds it"),
        "water_well": TINY,
        "beehive": TINY,
        "insect_hotel": TINY,
        "telescope": TINY,
        "observatory": BUILDING,
        "pumping_station": BUILDING,
        "cutline": Left("a strip cleared through a wood: the canopy holds it"),
        "pole": TINY,
        "mineshaft": Left(
            "a shaft: its head frame, where one stands, is not drawn yet (a candidate)"
        ),
        "video_wall": TINY,
        "telephone_box": TINY,
        "ventilation_shaft": TINY,
        "ventilation": TINY,
        "air_shaft": TINY,
        "cross": Left("a wayside cross: monuments.py draws the historic ones"),
        "fuel_pump": TINY,
        "guard_stone": TINY,
        "hole": FLUSH,
        "sport_feature": TINY,
        "unused base for vending machine": TINY,
        "yes": Left("no kind given"),
    },
    "power": {
        "line": Planned("overhead power lines"),
        "minor_line": Planned("overhead power lines"),
        "tower": Planned("overhead power lines"),
        "pole": Planned("overhead power lines"),
        "catenary_mast": Drawn("rail_osm"),
        "cable": UNDER,
        "substation": AREA,
        "plant": AREA,
        "generator": Left("mostly solar panels on roofs: the roof colour holds them"),
        "transformer": Left("inside a substation or a building"),
        "cable_distribution_cabinet": TINY,
        "22000": Left("a mistagged voltage"),
    },
    "historic": {
        "memorial": Drawn("monuments"),
        "monument": Drawn("monuments"),
        "fountain": Left("a historic fountain: drawn as its amenity=fountain (monuments.py)"),
        "stone": Left("drawn where it is a memorial (monuments.py); alone a candidate"),
        "citywalls": Drawn("walls"),
        "ruins": Left("a ruin's walls are LoD2's or the surface model's (structures.py)"),
        "heritage": MEMORY,
        "yes": Left("no kind given"),
        "bridge": Left("a bridge's history: the bridge itself is drawn (rail_osm.py)"),
        "railway": Left("a former line: nothing stands"),
        "boundary_stone": TINY,
        "milestone": TINY,
        "tomb": TINY,
        "wayside_cross": TINY,
        "technical_monument": Left("a building or machine, mostly LoD2's"),
        "locomotive": Left("a locomotive on display: not drawn yet (a candidate)"),
        "highwater_mark": TINY,
        "archaeological_site": MEMORY,
        "building": BUILDING,
        "bunker": BUILDING,
        "castle": BUILDING,
        "city_gate": BUILDING,
        "house": BUILDING,
        "palais": BUILDING,
        "park": Left("a historic park: its trees, lawns and paths are drawn"),
        "ship": Left("a museum ship at its berth: not drawn yet (a candidate)"),
        "church": BUILDING,
        "industrial": BUILDING,
        "railway_station": BUILDING,
    },
    "route": {"ferry": Drawn("riverside")},
    "highway": {"elevator": Planned("lifts")},
}

_HSTORE = re.compile(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"')
# The layers' own tag columns (GDAL's osmconf.ini); the rest is in other_tags.
_LAYERS = ("points", "lines", "multipolygons")


def tags_of(row: dict[str, object]) -> dict[str, str]:
    """An OSM feature's tags: its `other_tags` and its own tag columns."""
    tags = dict(_HSTORE.findall(str(row.get("other_tags") or "")))
    for k, v in row.items():
        if k not in ("other_tags", "osm_id", "osm_way_id", "name") and v:
            tags.setdefault(k, str(v))
    return tags


def audited(tags: dict[str, str]) -> list[str]:
    """The `key=value` the ledger decides of one feature's tags."""
    out = [f"{k}={tags[k]}" for k in KEYS if tags.get(k)]
    out += [f"{k}={v}" for k, v in PAIRS if tags.get(k) == v]
    return out


def count(pbf: Path, tiles: list[Tile]) -> Counter[str]:
    """Every audited `key=value` over the tiles, one count per OSM object
    (an object on two tiles counts once)."""
    seen: set[tuple[str, str]] = set()
    out: Counter[str] = Counter()
    for tile in tiles:
        bbox = wgs84_bbox(tile, 0.0)
        for layer in _LAYERS:
            _, names, columns = osm_index.read(pbf, layer, bbox, None, None)
            n = len(columns[0]) if columns else 0
            for i in range(n):
                row = {k: c[i] for k, c in zip(names, columns, strict=True)}
                ident = str(row.get("osm_id") or row.get("osm_way_id"))
                for kv in audited(tags_of(row)):
                    if (kv, ident) not in seen:
                        seen.add((kv, ident))
                        out[kv] += 1
    return out


def fate(kv: str) -> Fate | None:
    key, value = kv.split("=", 1)
    return LEDGER.get(key, {}).get(value)


def report(counts: Counter[str]) -> tuple[list[str], list[str]]:
    """The table's lines, and the values seen `MIN_COUNT` times or more
    that the ledger does not know."""
    lines: list[str] = []
    unknown: list[str] = []
    for kv, n in sorted(counts.items(), key=lambda kn: (-kn[1], kn[0])):
        f = fate(kv)
        if f is None:
            if n >= MIN_COUNT:
                unknown.append(kv)
            what = "UNDECIDED" if n >= MIN_COUNT else "(rare, undecided)"
        elif isinstance(f, Drawn):
            what = f"drawn by {f.module}.py"
        elif isinstance(f, Planned):
            what = f"planned: {f.what}"
        else:
            what = f"left out: {f.reason}"
        lines.append(f"{n:6d}  {kv:40s} {what}")
    return lines, unknown


def run(pbf: Path | None, tiles: list[Tile], site: str) -> int:
    """Print the site's table; 1 when a frequent value is undecided."""
    if pbf is None:
        print(f"{site}: no OSM extract — `bun run fetch {site}` first")
        return 1
    lines, unknown = report(count(pbf, tiles))
    print(f"{site}: what the bakes make of OSM's built things ({pbf.name})")
    for line in lines:
        print(line)
    if unknown:
        print(
            f"\n{site}: {len(unknown)} value(s) seen {MIN_COUNT}+ times that "
            "pipeline/bake/coverage.py LEDGER does not decide: " + ", ".join(unknown)
        )
        return 1
    print(f"\n{site}: every built thing seen {MIN_COUNT}+ times is decided")
    return 0
