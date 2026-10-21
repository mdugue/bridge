"""OSM crossings, signals and lane tags → road markings: zebra crossings,
signalled crossings (a *Furt*: two broken lines), stop lines, cycle lanes
and centre lines, painted by the terrain shader in the ground's own
fragment pass (app/_components/road-markings.ts), like the sports grounds.

The table (`markings_<tile>.json`) is one row per painted crossing or stop
line:

    [cx, cy, angle, halfLength, halfWidth, kind]

`cx, cy` is the centre in metres from the tile's north-west corner (x east,
y north, so y ≤ 0 on the tile); `angle` the marking's long axis — ACROSS the
road, the way a pedestrian walks (radians from east, counter-clockwise);
`halfLength` half its extent across the road (the carriageway measured on
the class raster), `halfWidth` half its extent along the road. `kind`
indexes `KINDS` (keep them in step with lib/city/markings.ts).

- A crossing (`highway=crossing` node) is painted when OSM says how it is
  marked (`crossing_kind`): a zebra only where OSM says zebra
  (`crossing:markings` zebra or ladder, `crossing_ref=zebra`, the zebra's
  sign `DE:350`), a furt where `crossing:markings` says lines, dashes, dots
  or yes, or the crossing is signalled (German signalled crossings are
  broken lines, not a zebra); `marked` or `uncontrolled` alone, or
  `crossing:markings=no|surface`, paints nothing. Its axis is the normal of
  the nearest carriageway way at the node; its extent the contiguous DLM
  road texels (class 7) along that normal.
- A stop line: 3 m before a `highway=traffic_signals` node whose
  `traffic_signals:direction` (or `direction`) is forward or backward, on
  the right half of the approach (right-hand traffic; the whole carriageway
  on a oneway), 0.5 m wide.
- Across a seam: the rows are measured on the class raster of this tile and
  its neighbours (`SEAM_MARGIN_M` around it), so a carriageway is not cut
  at the tile edge, and a neighbour's crossing or stop line whose painted
  rectangle (grown by the raster's fringe) reaches into the tile joins
  this tile's rows too — paint only: its owner (the tile holding its node)
  counts it. Both tiles measure it alike, so its halves meet at the seam.
- Overlapping rows are merged: OSM often maps one crossing twice (a node on
  each way, a zebra and a signal node side by side), and the raster holds
  one row per texel, so the second would clip the first's paint. Rows of
  the same family (crossings, stop lines) whose axes agree within
  `MERGE_ANGLE_DEG` and whose outlines come within 2 · `CORE_M` of each
  other — or whose centres lie within `CORE_M`, whatever their axes: one
  node read twice, each way through it giving its own tangent — become
  one row covering both across the road, in the frame and
  kind of the preferred one (a zebra over a furt, else the larger); along
  the road the union too when they are parallel, else the preferred one's
  width — unless the row would reach further across than one carriageway
  (`MAX_MERGED_HALF_M`: two carriageways' crossings in line, a median
  between). Rows that still overlap (two arms of a junction, a stop line on a
  crossing) keep their order in the raster's core pass: the smaller on
  top, so it loses nothing and the larger only the overlap, which the
  smaller paints.

The raster (`markings_<tile>.png`, 2048² over a 2 km tile, ≈1 m; phones read
`markings_low_<tile>.png`, the same at 1024² with a 1.45 m core) is four
bytes per texel, interleaved in an 8-bit greyscale PNG four times as wide
(R0 G0 B0 A0 R1 …, read by lib/city/png-raster.ts):

    R, A  = 1 + the row whose outline, grown by 1 m, reaches the texel
            (low, high byte; 0 none). Texels within `CORE_M` of a row's
            rectangle are that row's before any other row's margin, so
            every point of its paint has a texel of its own among the four
            the shader reads (`paint_lost` checks it, the run logs it)
    G     = lane bits on road texels: 1 = a cycle lane runs along the kerb on
            THIS side of the way (2 = its line is solid, 128 = it lies at
            2.25 m), 4 = a centre line road (16 = solid, 32 = lane lines
            too); and on any texel 8 = a kerb stands near (`KERB`, below),
            64 = a red cycle surface (`RED`)
    B     = 128 + 20 · the signed distance (m) to the carriageway's middle
            (centre-line roads only; ±6.35 m)

The side is resolved here, per texel (which side of the nearest way it lies
on), because the paving raster's bearing is only known modulo 180°. Centre
lines (`centre_bits`): two-way (no `oneway`) primary/secondary/tertiary/
trunk/unclassified roads with `lanes` ≥ 2, not `lane_markings=no` nor a
physical `divider`, where the carriageway is at least 5.5 m wide, not
within 12 m of a junction node, and not within `TRAM_CLEAR_M` of a tram
track (the tracks run on the axis there). The middle is where the
distances to the kerbs on the way's two sides are equal. Solid where
overtaking is forbidden or the `divider` is a solid line; with four lanes
or more solid (the directions' Fahrstreifenbegrenzung), and dashed lane
lines halfway to each kerb too. Cycle lanes
(`cycle_sides`): `cycleway:right|left|both=lane`, `cycleway=lane` (both
sides of a two-way road, the right of a oneway); a solid line for a
Radfahrstreifen (`:lane=exclusive`), dashed for a Schutzstreifen, none for
pictograms only; red where `:surface:colour=red`. The shader moves the
line out past a parking lane on that side (the paving raster's). A
cycleway mapped on its own with a red surface sets `RED` on its whole
track.

The kerb bit marks every texel whose centre lies within `KERB_REACH_M` (and
a texel's diagonal) of a kerb line edges.py baked (`kerbs_<tile>.geojson`).
The terrain shader draws its painted kerb band — the stone's top, the
gutter and the kerb's shadow on the road — only where it is set
(app/_components/ground-detail.ts), so the band follows the same rule as
the stones: none along a road out of town, beside water or rails, or over
a tunnel. Read from the class raster alone, the band ran on along every
road edge beside ground, out of town too.
"""

from __future__ import annotations

import json
import math

import numpy as np
import shapely
import shapely.geometry
import shapely.ops
from rasterio.features import rasterize
from scipy import ndimage as ndi

from .common import OSM_ATTRIBUTION, Tile, column, overlaps, owns, save_grey_png
from .osm import has_extract, read_osm, read_ways, tag

# id → key; keep in step with `MARKING_KINDS` in lib/city/markings.ts.
KINDS = {0: "none", 1: "zebra", 2: "furt", 3: "stop"}
ZEBRA, FURT, STOP = 1, 2, 3
HALF_WIDTH = {ZEBRA: 2.0, FURT: 1.5, STOP: 0.25}  # m along the road
STOP_BEFORE_M = 3.0
ROAD = 7
MOTOR = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "busway",
    "road",
)
CENTRE_ROADS = ("trunk", "primary", "secondary", "tertiary", "unclassified")
CENTRE_MIN_WIDTH_M = 5.5
JUNCTION_CLEAR_M = 12.0
MAX_CARRIAGEWAY_M = 30.0  # wider runs are a square or a junction box: not painted
SNAP_M = 3.0  # how far along the normal the carriageway may start from the node
CROSSING_SAMPLES = (0.0, -5.0, 5.0, -10.0, 10.0)  # m along the road
STOP_SAMPLES = (0.0, 4.0, 8.0)  # m back along the approach
LOCAL_SLACK_M = 1.5
GROW_M = 1.0
# Half a texel's diagonal (0.69 m at 2048² over 2 km) and a little: the four
# texels around any point include one this close to it.
CORE_M = 0.75
# Crossings closer than this in axis are one crossing (a node on a curve,
# a node on each way of a junction's arm); farther apart they are two arms.
MERGE_ANGLE_DEG = 30.0
# A merge that would paint further across than one carriageway (plus a
# metre for nodes at an angle) joins the crossings of two carriageways in
# line — a dual carriageway, a tram median between them (Leipzig's ring,
# Hamburg's wide streets): they stay two rows.
MAX_MERGED_HALF_M = MAX_CARRIAGEWAY_M / 2 + 1.0
PARALLEL_DEG = 10.0
CROSSINGS = (ZEBRA, FURT)
EDGE_SCALE = 20.0  # bytes per metre, as edges.py
SIDE_REACH_M = 20.0  # texels farther from every way get no side
# The G channel's bits; keep them in step with `LANE_BITS` in
# lib/city/markings.ts. On road texels: a cycle lane along the kerb on this
# side of the way (its line solid, its width 2.25 m), a centre-line road
# (its line solid, dashed lane lines too); on any texel: a kerb near, a red
# cycle surface.
CYCLE, CYCLE_SOLID, CENTRE, CENTRE_SOLID, LANE_LINES = 1, 2, 4, 16, 32
RED, CYCLE_WIDE = 64, 128
WIDE_CYCLE_M = 2.05  # a tagged cycle-lane width from which its line moves out
# No centre line within this of a tram track (a track on the road's axis:
# Dresden's, Leipzig's and München's trams mostly run in the middle).
TRAM_CLEAR_M = 2.0
# The kerb bit: the band, its gutter and the kerb's shadow reach 1.5 m across
# the kerb line, and the shader reads the four texels round a point, so a
# texel carries it out to KERB_REACH_M plus its diagonal.
KERB = 8
KERB_REACH_M = 2.0
# How far past the tile the rows are measured and a neighbour's node is
# read: a row's centre lies within SNAP_M + MAX_CARRIAGEWAY_M / 2 + the
# farthest sample (10 m) of its node, its paint half a carriageway past that.
SEAM_MARGIN_M = 64.0


def _base(highway: str | None) -> str | None:
    if not highway:
        return None
    return highway.removesuffix("_link")


# `crossing:markings` values (the OSM wiki's list; `;`-lists are read as a
# set): the zebra's bars, the two lines of a *Furt* (solid, dashed, dotted),
# and none. `yes` says marked without saying how: in Dresden's orthophoto
# nearly all of them are two lines (over a tram track or a cycle track, or
# a signalled Furt) and only a few a zebra, so it paints the two lines.
ZEBRA_MARKINGS = {
    "zebra",
    "zebra:double",
    "zebra:paired",
    "zebra:bicolour",
    "ladder",
    "ladder:skewed",
    "ladder:paired",
}
LINE_MARKINGS = {"lines", "lines:paired", "dashes", "dots", "yes"}
NO_MARKINGS = {"no", "surface", "pictograms"}
# Signalled crossings by their reference name (UK and elsewhere); German
# ones carry `crossing=traffic_signals` or `crossing:signals=yes`.
SIGNAL_REFS = {"pelican", "toucan", "puffin", "pegasus"}
ZEBRA_SIGN = "DE:350"  # Zeichen 350, Fußgängerüberweg


def crossing_kind(other_tags: str | None) -> int:
    """The paint of a `highway=crossing` node (0: nothing). A zebra only
    where OSM says zebra (`crossing:markings` zebra or ladder,
    `crossing_ref=zebra`, the deprecated `crossing=zebra`, or the zebra's
    sign `DE:350`); two lines where `crossing:markings` says lines, dashes,
    dots or just yes; a signalled crossing two lines too (German signalled
    crossings are a Furt of broken lines: 97 % of Dresden's and Leipzig's
    that say so). `marked` or `uncontrolled` alone paints nothing: in the
    orthophotos they are mostly unmarked, or cross a cycle track, and only
    about 30 % of the zebras they drew were there."""
    values = {v.strip() for v in (tag(other_tags, "crossing:markings") or "").split(";")} - {""}
    if values & ZEBRA_MARKINGS:
        return ZEBRA
    crossing = tag(other_tags, "crossing")
    ref = tag(other_tags, "crossing_ref")
    sign = tag(other_tags, "traffic_sign") or ""
    if ref == "zebra" or crossing == "zebra" or ZEBRA_SIGN in sign:
        return ZEBRA if not values & NO_MARKINGS else 0
    if values & LINE_MARKINGS:
        return FURT
    if values & NO_MARKINGS:
        return 0
    signals = (
        crossing == "traffic_signals"
        or tag(other_tags, "crossing:signals") == "yes"
        or ref in SIGNAL_REFS
    )
    return FURT if signals else 0


def signal_direction(other_tags: str | None) -> int:
    """+1 forward, −1 backward, 0 unknown/both."""
    value = tag(other_tags, "traffic_signals:direction") or tag(other_tags, "direction")
    return {"forward": 1, "backward": -1}.get(value or "", 0)


def is_oneway(other_tags: str | None) -> bool:
    return tag(other_tags, "oneway") in ("yes", "true", "1", "-1")


def lane_count(other_tags: str | None) -> int:
    try:
        return int(float((tag(other_tags, "lanes") or "0").split(";")[0]))
    except ValueError:
        return 0


def has_centre_line(highway: str | None, other_tags: str | None) -> bool:
    return centre_bits(highway, other_tags) != 0


# A `divider` that is a thing, not paint: no line between the directions.
PHYSICAL_DIVIDERS = {"barrier", "kerb", "grass_verge", "planter", "median", "guard_rail", "rail"}
SOLID_DIVIDERS = {"solid_line", "double_solid_line", "solid_line_dashed_line"}


def centre_bits(highway: str | None, other_tags: str | None) -> int:
    """The way's centre-line bits (G, 0 none): `CENTRE` on two-way
    primary…unclassified roads with `lanes` ≥ 2 and not `lane_markings=no`
    nor a physical `divider`; `CENTRE_SOLID` too where overtaking is
    forbidden (`overtaking=no`, or both its directions) or the divider is a
    solid line; `LANE_LINES` on a single carriageway of four lanes or more,
    whose lanes are divided by dashed lines (drawn halfway between the
    middle and each kerb) and whose directions by a solid one (the RMS's
    Fahrstreifenbegrenzung; dashed only where `divider=dashed_line`)."""
    if not (
        _base(highway) in CENTRE_ROADS
        and not is_oneway(other_tags)
        and lane_count(other_tags) >= 2
        and tag(other_tags, "lane_markings") != "no"
        and tag(other_tags, "divider") not in PHYSICAL_DIVIDERS
    ):
        return 0
    bits = CENTRE
    no_pass = tag(other_tags, "overtaking") == "no" or all(
        tag(other_tags, f"overtaking:{d}") == "no" for d in ("forward", "backward")
    )
    divider = tag(other_tags, "divider")
    if no_pass or divider in SOLID_DIVIDERS:
        bits |= CENTRE_SOLID
    if lane_count(other_tags) >= 4:
        bits |= LANE_LINES | (CENTRE_SOLID if divider != "dashed_line" else 0)
    return bits


def _cycle_tag(other_tags: str | None, side: str, key: str) -> str | None:
    """`cycleway:<side>:<key>`, else `cycleway:both:<key>`, else
    `cycleway:<key>`."""
    for prefix in (f"cycleway:{side}", "cycleway:both", "cycleway"):
        value = tag(other_tags, f"{prefix}:{key}")
        if value is not None:
            return value
    return None


def _width_m(value: str | None) -> float:
    try:
        return float((value or "0").split(";")[0].replace(",", ".").removesuffix("m").strip())
    except ValueError:
        return 0.0


def cycle_lane_bits(other_tags: str | None, side: str) -> int:
    """A painted cycle lane's bits on one side (`CYCLE`, 0 none): its line
    solid for a *Radfahrstreifen* (`cycleway:<side>:lane=exclusive`),
    dashed for a *Schutzstreifen* (advisory, or not said), none for a lane
    with only pictograms; `CYCLE_WIDE` where its tagged width is 2.05 m or
    more (the line at 2.25 m, not the kind's own 1.85 or 1.5 m); `RED`
    where its surface is tagged red."""
    lane = _cycle_tag(other_tags, side, "lane")
    if lane == "pictogram":
        return 0
    bits = CYCLE | (CYCLE_SOLID if lane == "exclusive" else 0)
    if _width_m(_cycle_tag(other_tags, side, "width")) >= WIDE_CYCLE_M:
        bits |= CYCLE_WIDE
    if _cycle_tag(other_tags, side, "surface:colour") == "red":
        bits |= RED
    return bits


def cycle_sides(other_tags: str | None) -> tuple[int, int]:
    """The cycle-lane bits (`cycle_lane_bits`) on the way's right and on its
    left, 0 where none: `cycleway:right|left|both=lane`, or `cycleway=lane`
    (both sides of a two-way road, the right of a oneway)."""

    def lane(key: str) -> bool:
        return tag(other_tags, key) == "lane"

    both = lane("cycleway:both")
    plain = lane("cycleway")
    right = both or lane("cycleway:right") or plain
    left = both or lane("cycleway:left") or (plain and not is_oneway(other_tags))
    return (
        cycle_lane_bits(other_tags, "right") if right else 0,
        cycle_lane_bits(other_tags, "left") if left else 0,
    )


# Cycleways mapped on their own (and paths a bicycle may use) whose surface
# is tagged red: the whole track is red (B21; the paving pattern itself is
# not known from open data).
RED_TRACK_HALF_M = 1.0


def is_red_track(highway: str | None, other_tags: str | None) -> bool:
    if highway not in ("cycleway", "path", "footway"):
        return False
    colour = tag(other_tags, "surface:colour") or tag(other_tags, "cycleway:surface:colour")
    return colour == "red" and (
        highway == "cycleway" or tag(other_tags, "bicycle") in ("designated", "yes")
    )


# --- geometry -------------------------------------------------------------


class ClassRaster:
    """The committed class raster with its EPSG mapping (row 0 = north)."""

    def __init__(self, cls: np.ndarray, bounds: tuple[float, float, float, float]):
        self.cls = cls
        self.xmin, self.ymin, self.xmax, self.ymax = bounds
        self.n = cls.shape[0]
        self.res = (self.xmax - self.xmin) / self.n

    def is_road(self, x: np.ndarray, y: np.ndarray) -> np.ndarray:
        c = np.floor((np.asarray(x) - self.xmin) / self.res).astype(np.int64)
        r = np.floor((self.ymax - np.asarray(y)) / self.res).astype(np.int64)
        ok = (c >= 0) & (c < self.n) & (r >= 0) & (r < self.n)
        out = np.zeros(np.shape(c), bool)
        out[ok] = self.cls[r[ok], c[ok]] == ROAD
        return out


def carriageway(
    raster: ClassRaster, p: np.ndarray, n: np.ndarray, step: float = 0.25
) -> tuple[float, float] | None:
    """The contiguous road run through (or within SNAP_M of) p along the unit
    normal n, as (t0, t1) in metres from p; None where there is no road or
    the run is wider than MAX_CARRIAGEWAY_M."""
    reach = MAX_CARRIAGEWAY_M + SNAP_M
    t = np.arange(-reach, reach + step / 2, step)
    road = raster.is_road(p[0] + t * n[0], p[1] + t * n[1])
    near = np.flatnonzero(road & (np.abs(t) <= SNAP_M))
    if len(near) == 0:
        return None
    start = near[np.argmin(np.abs(t[near]))]
    lo = start
    while lo > 0 and road[lo - 1]:
        lo -= 1
    hi = start
    while hi < len(t) - 1 and road[hi + 1]:
        hi += 1
    if lo == 0 or hi == len(t) - 1:
        return None
    t0, t1 = t[lo] - step / 2, t[hi] + step / 2
    if t1 - t0 > MAX_CARRIAGEWAY_M:
        return None
    return float(t0), float(t1)


def tangent_at(line: shapely.Geometry, p: shapely.Point) -> np.ndarray:
    """The unit direction of the line at its point nearest p (digitised
    direction)."""
    s = line.project(p)
    a = line.interpolate(max(s - 1.0, 0.0))
    b = line.interpolate(min(s + 1.0, line.length))
    d = np.array([b.x - a.x, b.y - a.y])
    norm = np.hypot(*d)
    return d / norm if norm > 1e-9 else np.array([1.0, 0.0])


def nearest_way(tree: shapely.STRtree, ways, p: shapely.Point, within: float):
    """Index of the nearest way within `within` metres, or None."""
    hit = tree.query_nearest(p, max_distance=within, all_matches=False)
    return int(hit[0]) if len(hit) else None


def carriageway_near(
    raster: ClassRaster, p: np.ndarray, t: np.ndarray, n: np.ndarray, offsets
) -> tuple[float, float] | None:
    """The carriageway across n at p, measured also a few metres along the
    road (`offsets` along t): at a junction the normal through the node runs
    down the crossing street, so the arm's narrowest valid run nearby wins;
    the run at p itself when it is within `LOCAL_SLACK_M` of that."""
    runs = {}
    for k in offsets:
        run = carriageway(raster, p + t * k, n)
        if run is not None:
            runs[k] = run
    if not runs:
        return None
    best = min(runs.values(), key=lambda r: r[1] - r[0])
    here = runs.get(0.0)
    if here is not None and (here[1] - here[0]) - (best[1] - best[0]) <= LOCAL_SLACK_M:
        return here
    return best


def crossing_row(raster, ways, tree, p, kind):
    i = nearest_way(tree, ways, p, 3.0)
    if i is None:
        return None
    t = tangent_at(ways[i], p)
    n = np.array([-t[1], t[0]])
    run = carriageway_near(raster, np.array([p.x, p.y]), t, n, CROSSING_SAMPLES)
    if run is None:
        return None
    t0, t1 = run
    c = np.array([p.x, p.y]) + n * (t0 + t1) / 2
    return [c[0], c[1], math.atan2(n[1], n[0]), (t1 - t0) / 2, HALF_WIDTH[kind], kind]


def stop_row(raster, ways, tree, oneway, p, direction):
    i = nearest_way(tree, ways, p, 1.0)
    if i is None:
        return None
    travel = tangent_at(ways[i], p) * direction
    at = np.array([p.x, p.y]) - travel * STOP_BEFORE_M
    right = np.array([travel[1], -travel[0]])
    # back along the approach, away from the junction the signal guards
    run = carriageway_near(raster, at, -travel, right, STOP_SAMPLES)
    if run is None:
        return None
    t0, t1 = run
    if not oneway[i]:
        t0 = (t0 + t1) / 2
    c = at + right * (t0 + t1) / 2
    return [c[0], c[1], math.atan2(right[1], right[0]), (t1 - t0) / 2, HALF_WIDTH[STOP], STOP]


def _family(kind: int) -> int:
    return 0 if kind in CROSSINGS else kind


def _preferred(a, b):
    """The row whose frame and kind a merge keeps: a zebra over a furt,
    else the larger."""
    if a[5] != b[5] and {a[5], b[5]} == {ZEBRA, FURT}:
        return a if a[5] == ZEBRA else b
    return a if a[3] * a[4] >= b[3] * b[4] else b


def _axis_gap_deg(a, b) -> float:
    d = abs(a[2] - b[2]) % math.pi
    return math.degrees(min(d, math.pi - d))


def merge_pair(a, b) -> list[float]:
    """One row covering both rectangles, in the preferred row's frame. Rows
    on one axis (within `PARALLEL_DEG`) take the union both ways — two
    nodes of one crossing a little apart along the road; rows at an angle
    are one crossing whose nodes found different tangents, so the merge
    keeps the preferred row's extent along the road and only widens it
    across (a union along would draw an 11 m zebra)."""
    keep = _preferred(a, b)
    cx, cy, angle, _, _, kind = keep
    u = np.array([math.cos(angle), math.sin(angle)])
    v = np.array([-u[1], u[0]])
    corners = [shapely.get_coordinates(rotated_rect(r))[:4] for r in (a, b)]
    pts = np.concatenate(corners) - np.array([cx, cy])
    s = pts @ u
    along = pts if _axis_gap_deg(a, b) <= PARALLEL_DEG else corners[a is not keep] - [cx, cy]
    t = along @ v
    c = np.array([cx, cy]) + u * (s.min() + s.max()) / 2 + v * (t.min() + t.max()) / 2
    return [
        float(c[0]),
        float(c[1]),
        angle,
        float(s.max() - s.min()) / 2,
        float(t.max() - t.min()) / 2,
        kind,
    ]


def _mergeable(a, b) -> bool:
    if _family(a[5]) != _family(b[5]):
        return False
    if math.dist(a[:2], b[:2]) < CORE_M:
        return True  # one crossing read twice, whatever its tangents
    if _axis_gap_deg(a, b) > MERGE_ANGLE_DEG:
        return False
    return rotated_rect(a).distance(rotated_rect(b)) < 2 * CORE_M


def merge_rows(rows: list[list[float]]) -> list[list[float]]:
    """Merges overlapping rows of one family on one axis until none are
    left (see the module docstring); the rest keep their order."""
    rows = [list(r) for r in rows]
    merged = True
    while merged:
        merged = False
        for i in range(len(rows)):
            for j in range(i + 1, len(rows)):
                if not _mergeable(rows[i], rows[j]):
                    continue
                pair = merge_pair(rows[i], rows[j])
                if pair[3] <= MAX_MERGED_HALF_M:
                    rows[i] = pair
                    del rows[j]
                    merged = True
                    break
            if merged:
                break
    return rows


def rotated_rect(row) -> shapely.Geometry:
    cx, cy, angle, hl, hw, _ = row
    u = np.array([math.cos(angle), math.sin(angle)])
    v = np.array([-u[1], u[0]])
    c = np.array([cx, cy])
    corners = [c + su * hl * u + sv * hw * v for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    return shapely.Polygon(corners)


# --- the per-texel lane fields ------------------------------------------------


def junctions(ways, highways) -> list[shapely.Point]:
    """Road junction nodes: vertices where three or more segment ends of
    the (non-service) road ways meet — a way running through counts two, a
    way ending there one, so a way merely split in two is no junction."""
    degree: dict[tuple[float, float], int] = {}
    for g, hw in zip(ways, highways, strict=True):
        if _base(hw) == "service":
            continue
        for part in shapely.get_parts(g):
            xy = np.round(np.asarray(part.coords)[:, :2], 2)
            for k, (x, y) in enumerate(xy):
                ends = 1 if k in (0, len(xy) - 1) else 2
                degree[(x, y)] = degree.get((x, y), 0) + ends
    return [shapely.Point(xy) for xy, d in degree.items() if d >= 3]


def nearest_way_fields(tile: Tile, px: int, ways):
    """Per texel: the index of the nearest way (−1 far from all), whether
    the texel lies on its right (digitised direction) and within reach."""
    res = (tile.bounds[2] - tile.bounds[0]) / px
    transform = tile.transform(px)
    ids = np.zeros((px, px), np.int32)
    heading = np.zeros((px, px), np.float32)
    idx, angles = [], []
    for i, g in enumerate(ways):
        for part in shapely.get_parts(g):
            xy = np.asarray(part.coords)[:, :2]
            for a, b in zip(xy[:-1], xy[1:], strict=True):
                if np.hypot(*(b - a)) > 1e-6:
                    seg = shapely.LineString([a, b])
                    idx.append((seg, i + 1))
                    angles.append((seg, math.atan2(b[1] - a[1], b[0] - a[0])))
    if not idx:
        return np.full((px, px), -1), np.zeros((px, px), bool), np.zeros((px, px), bool)
    rasterize(idx, out=ids, transform=transform, all_touched=True, dtype=np.int32)
    rasterize(angles, out=heading, transform=transform, all_touched=True, dtype=np.float32)
    dist, (ri, ci) = ndi.distance_transform_edt(ids == 0, return_indices=True)
    way = ids[ri, ci] - 1
    ang = heading[ri, ci]
    rows, cols = np.mgrid[0:px, 0:px]
    dx = (cols - ci) * res  # east
    dy = -(rows - ri) * res  # north
    right = np.cos(ang) * dy - np.sin(ang) * dx < 0
    near = dist * res <= SIDE_REACH_M
    return np.where(near, way, -1), right, near


def burn_mask(tile: Tile, px: int, lines, half: float) -> np.ndarray:
    """Texels of a px² raster within `half` metres of any of the lines."""
    shapes = [(shapely.buffer(g, half), 1) for g in lines if g is not None and not g.is_empty]
    if not shapes:
        return np.zeros((px, px), bool)
    return rasterize(shapes, out_shape=(px, px), transform=tile.transform(px), dtype=np.uint8) > 0


def lane_fields(
    tile: Tile,
    px: int,
    road: np.ndarray,
    ways,
    highways,
    centre,
    cycle,
    trams=(),
    red_tracks=(),
) -> tuple[np.ndarray, np.ndarray]:
    """(G lane bits, B centre offset byte), px² each. `road` is the class
    raster's road mask at px²; `centre[i]` way i's centre-line bits
    (`centre_bits`, 0 none); `cycle[i]` its (right, left) cycle-lane bits
    (`cycle_sides`). No centre line within `TRAM_CLEAR_M` of a tram track
    (`trams`); `RED` on every texel of a red cycle track (`red_tracks`)."""
    bits = np.zeros((px, px), np.uint8)
    offset = np.full((px, px), 128, np.uint8)
    if len(red_tracks):
        res = (tile.bounds[2] - tile.bounds[0]) / px
        bits |= burn_mask(tile, px, red_tracks, RED_TRACK_HALF_M + res / 2).astype(np.uint8) * RED
    if not any(centre) and not any(any(c) for c in cycle):
        return bits, offset
    way, right, _ = nearest_way_fields(tile, px, ways)
    n = len(ways)
    w = np.where(way >= 0, way, n)  # n: no way
    lane_r = np.array([c[0] for c in cycle] + [0], np.uint8)
    lane_l = np.array([c[1] for c in cycle] + [0], np.uint8)
    bits |= np.where(road, np.where(right, lane_r[w], lane_l[w]), 0).astype(np.uint8)
    centre_of = np.array(list(centre) + [0], np.uint8)[w]
    is_c = centre_of != 0
    if not is_c.any():
        return bits, offset
    res = (tile.bounds[2] - tile.bounds[0]) / px
    kerb_r = ~road & right & is_c
    kerb_l = ~road & ~right & is_c
    if not (kerb_r.any() and kerb_l.any()):
        return bits, offset
    d_r = ndi.distance_transform_edt(~kerb_r) * res
    d_l = ndi.distance_transform_edt(~kerb_l) * res
    width = d_r + d_l
    s = (d_l - d_r) / 2  # + right of the middle
    clear = np.ones((px, px), bool)
    pts = junctions(ways, highways)
    if pts:
        burned = rasterize(
            [(pt.buffer(JUNCTION_CLEAR_M), 1) for pt in pts],
            out_shape=(px, px),
            transform=tile.transform(px),
            dtype=np.uint8,
        )
        clear = burned == 0
    ok = road & is_c & clear & (width >= CENTRE_MIN_WIDTH_M) & (width <= MAX_CARRIAGEWAY_M)
    if len(trams):
        ok &= ~burn_mask(tile, px, trams, TRAM_CLEAR_M)
    bits |= np.where(ok, centre_of, 0).astype(np.uint8)
    code = np.clip(np.round(128 + EDGE_SCALE * s), 1, 255).astype(np.uint8)
    return bits, np.where(ok, code, offset)


def kerb_lines(tile: Tile) -> list[shapely.Geometry] | None:
    """The tile's baked kerb lines (edges.py) where the kerb stands its full
    height (`full_height`), or None before that step ran."""
    path = tile.out("dlm", f"kerbs_{tile.id}.geojson")
    if not path.exists():
        return None
    doc = json.loads(path.read_text())
    return [
        part
        for f in doc["features"]
        for part in full_height(
            shapely.geometry.shape(f["geometry"]), (f.get("properties") or {}).get("low") or []
        )
    ]


def full_height(line: shapely.Geometry, low: list[list[float]]) -> list[shapely.Geometry]:
    """A kerb line less its lowered stretches (`low`: from, to in metres
    along it, kerb_drops.py): at a crossing or a driveway the stone stands
    3 cm or flush, so the ground there takes no kerb band and no kerb
    shadow (ground-detail.ts). The ramps at a stretch's ends keep it."""
    if not low or not isinstance(line, shapely.LineString):
        return [line]
    parts, at = [], 0.0
    for a, b, *_ in sorted(low):
        if a > at:
            parts.append(shapely.ops.substring(line, at, a))
        at = max(at, b)
    if at < line.length:
        parts.append(shapely.ops.substring(line, at, line.length))
    return [p for p in parts if p.length > 0.05]


def kerb_bits(tile: Tile, px: int, kerbs: list[shapely.Geometry]) -> np.ndarray:
    """`KERB` on every texel of a px² raster whose centre lies within
    KERB_REACH_M plus a texel's diagonal of a kerb line, else 0."""
    out = np.zeros((px, px), np.uint8)
    lines = [g for g in kerbs if g is not None and not g.is_empty]
    if lines:
        res = (tile.bounds[2] - tile.bounds[0]) / px
        reach = KERB_REACH_M + res * math.sqrt(2)
        rasterize(
            ((shapely.buffer(g, reach), KERB) for g in lines),
            out=out,
            transform=tile.transform(px),
        )
    return out


def road_mask(tile: Tile, px: int) -> ClassRaster | None:
    cls = tile.classes()
    return None if cls is None else ClassRaster(cls, tile.bounds)


def wide_mask(tile: Tile, own: ClassRaster, margin: float = SEAM_MARGIN_M) -> ClassRaster:
    """The class raster over the tile and `margin` around it: this tile's,
    and each committed neighbour's (`Tile.neighbours`) where it
    has one at the same resolution; 0 (no road) where none reaches."""
    m = int(math.ceil(margin / own.res))
    n = own.n + 2 * m
    xmin, ymin = own.xmin - m * own.res, own.ymin - m * own.res
    xmax, ymax = xmin + n * own.res, ymin + n * own.res
    wide = np.zeros((n, n), np.uint8)
    wide[m : m + own.n, m : m + own.n] = own.cls
    for tid, b in tile.neighbours():
        if tid == tile.id or not overlaps(b, (xmin, ymin, xmax, ymax)):
            continue
        cls = tile.classes(tid)
        if cls is None or abs((b[2] - b[0]) / cls.shape[1] - own.res) > 1e-9:
            continue
        c0 = int(round((b[0] - xmin) / own.res))
        r0 = int(round((ymax - b[3]) / own.res))
        rs, cs = max(r0, 0), max(c0, 0)
        re_, ce = min(r0 + cls.shape[0], n), min(c0 + cls.shape[1], n)
        if rs < re_ and cs < ce:
            wide[rs:re_, cs:ce] = cls[rs - r0 : re_ - r0, cs - c0 : ce - c0]
    return ClassRaster(wide, (xmin, ymin, xmax, ymax))


def reaches_tile(tile: Tile, row, grow: float) -> bool:
    """Whether a row's rectangle, grown by the raster's fringe, reaches into
    the tile."""
    return rotated_rect(row).buffer(grow).intersects(shapely.box(*tile.bounds))


def _frame(row, x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Points in the row's frame: across (s) and along (t) the road."""
    cx, cy, angle, _, _, _ = row
    dx, dy = x - cx, y - cy
    c, s = math.cos(angle), math.sin(angle)
    return dx * c + dy * s, -dx * s + dy * c


def _rect_distance(row, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    s, t = _frame(row, x, y)
    return np.hypot(np.maximum(np.abs(s) - row[3], 0.0), np.maximum(np.abs(t) - row[4], 0.0))


def reach(tile: Tile, px: int) -> tuple[float, float]:
    """(grow, core) for a px² raster: `GROW_M` and `CORE_M` at ≈1 m texels;
    coarser texels need a core past half their diagonal (1.38 m at 1024²)."""
    res = (tile.bounds[2] - tile.bounds[0]) / px
    core = max(CORE_M, math.ceil((res * math.sqrt(0.5) + 0.02) * 20) / 20)
    return max(GROW_M, core + 0.1), core


def index_raster(
    rows: list[list[float]],
    tile: Tile,
    px: int,
    grow: float | None = None,
    core: float | None = None,
) -> np.ndarray:
    """1 + the row reaching each texel, uint16: every outline grown by
    `grow` (the box filter's fringe), then, on top, each texel within `core`
    of a rectangle goes to the nearest one (inside two, the smaller) — so
    every point of a row's paint keeps a texel of its own among the four
    the shader reads, unless another row paints it too."""
    out = np.zeros((px, px), np.uint16)
    if not rows:
        return out
    auto_grow, auto_core = reach(tile, px)
    grow = auto_grow if grow is None else grow
    core = auto_core if core is None else core
    transform = tile.transform(px)
    shapes = [(rotated_rect(r).buffer(grow), i + 1) for i, r in enumerate(rows)]
    rasterize(shapes, out=out, transform=transform, dtype=np.uint16)
    xmin, _, xmax, ymax = tile.bounds
    res = (xmax - xmin) / px
    best = np.full((px, px), np.inf)
    for i in sorted(range(len(rows)), key=lambda i: -rows[i][3] * rows[i][4]):
        x0, y0, x1, y1 = rotated_rect(rows[i]).buffer(core).bounds
        c0, c1 = max(int((x0 - xmin) / res), 0), min(int((x1 - xmin) / res) + 1, px)
        r0, r1 = max(int((ymax - y1) / res), 0), min(int((ymax - y0) / res) + 1, px)
        if c0 >= c1 or r0 >= r1:
            continue
        cc, rr = np.meshgrid(np.arange(c0, c1), np.arange(r0, r1))
        d = _rect_distance(rows[i], xmin + (cc + 0.5) * res, ymax - (rr + 0.5) * res)
        win = (slice(r0, r1), slice(c0, c1))
        take = (d <= core) & (d <= best[win])
        out[win][take] = i + 1
        best[win][take] = d[take]
    return out


def _inside(row, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    s, t = _frame(row, x, y)
    return (np.abs(s) <= row[3] + 1e-6) & (np.abs(t) <= row[4] + 1e-6)


def paint_lost(
    rows: list[list[float]], index: np.ndarray, tile: Tile, step: float = 0.2
) -> list[tuple[float, float]]:
    """Per row, over its rectangle sampled every `step` m, the fraction where
    none of the four texels the shader reads names it, and of that the part
    no other row read there paints over either — (clipped, dropped). A
    clipped sample lies in an overlap another row paints; a dropped one is
    paint gone. Paint past the tile's edge is the neighbour's: not sampled."""
    px = index.shape[0]
    xmin, ymin, xmax, ymax = tile.bounds
    res = (xmax - xmin) / px
    out = []
    for i, (cx, cy, angle, hl, hw, _) in enumerate(rows):
        s = np.arange(-hl + step / 2, hl, step) if hl > step / 2 else np.zeros(1)
        t = np.arange(-hw + step / 2, hw, step) if hw > step / 2 else np.zeros(1)
        ss, tt = (a.ravel() for a in np.meshgrid(s, t))
        x = cx + ss * math.cos(angle) - tt * math.sin(angle)
        y = cy + ss * math.sin(angle) + tt * math.cos(angle)
        on = (x >= xmin) & (x < xmax) & (y > ymin) & (y <= ymax)
        if not on.any():
            out.append((0.0, 0.0))
            continue
        x, y = x[on], y[on]
        c0 = np.floor((x - xmin) / res - 0.5).astype(np.int64)
        r0 = np.floor((ymax - y) / res - 0.5).astype(np.int64)
        ids = np.stack(
            [
                index[np.clip(r0 + dr, 0, px - 1), np.clip(c0 + dc, 0, px - 1)]
                for dc, dr in ((0, 0), (1, 0), (0, 1), (1, 1))
            ]
        ).astype(np.int64)
        seen = (ids == i + 1).any(axis=0)
        covered = seen.copy()
        for other in np.unique(ids[:, ~seen]):
            if other > 0:
                read = (ids == other).any(axis=0) & ~covered
                covered[read] = _inside(rows[other - 1], x[read], y[read])
        out.append((float(1.0 - seen.mean()), float(1.0 - covered.mean())))
    return out


def table_row(tile: Tile, row: list[float]) -> list:
    xmin, _, _, ymax = tile.bounds
    cx, cy, angle, hl, hw, kind = row
    return [round(cx - xmin, 2), round(cy - ymax, 2), round(angle, 4), round(hl, 2), hw, kind]


def table_json(table: dict, rows: list[list]) -> str:
    """One marking per line (diffable, still plain JSON)."""
    head = json.dumps(table, indent=2)[:-2]
    body = ",\n".join(f"    {json.dumps(r)}" for r in rows)
    listed = f"[\n{body}\n  ]" if rows else "[]"
    return f'{head},\n  "markings": {listed}\n}}\n'


def build(
    tile: Tile,
    raster: ClassRaster,
    sizes: tuple[int, ...],
    points,
    pt_fields,
    lines,
    ln_fields,
    wide: ClassRaster | None = None,
    trams=(),
):
    """The rows (the tile's own, then a neighbour's that reach into it), the
    lane fields (bits, offset) at each raster size, and the counts (own rows
    only). Rows are measured on `wide` (the tile and its neighbours) when
    given; `trams` are the tram tracks (no centre line on them)."""
    highways = column(ln_fields, "highway", lines)
    line_tags = column(ln_fields, "other_tags", lines)
    motor = [i for i, h in enumerate(highways) if _base(h) in MOTOR]
    ways = [lines[i] for i in motor]
    tags = [line_tags[i] for i in motor]
    tree = shapely.STRtree(ways) if ways else None
    oneway = [is_oneway(t) for t in tags]
    rows, seam = [], []
    counts = {"crossings": 0, "crossings_unplaced": 0, "stops": 0, "stops_unplaced": 0}
    measure = wide if wide is not None else raster
    grow = reach(tile, max(sizes))[0]
    if tree is not None:
        for p, hw, t in zip(
            points,
            column(pt_fields, "highway", points),
            column(pt_fields, "other_tags", points),
            strict=True,
        ):
            own = owns(tile.bounds, p.x, p.y)
            if not own and (wide is None or not _near(tile, p, SEAM_MARGIN_M)):
                continue
            if hw == "crossing" and (kind := crossing_kind(t)):
                row = crossing_row(measure, ways, tree, p, kind)
                key = "crossings"
            elif hw == "traffic_signals" and (direction := signal_direction(t)):
                row = stop_row(measure, ways, tree, oneway, p, direction)
                key = "stops"
            else:
                continue
            if not own:
                if row is not None and reaches_tile(tile, row, grow):
                    seam.append(row)
            elif row is None:
                counts[f"{key}_unplaced"] += 1
            else:
                counts[key] += 1
                rows.append(row)
    counts["seam"] = len(seam)
    rows += seam
    motor_hw = [highways[i] for i in motor]
    centre = [centre_bits(h, t) for h, t in zip(motor_hw, tags, strict=True)]
    cycle = [cycle_sides(t) for t in tags]
    red = [g for g, h, t in zip(lines, highways, line_tags, strict=True) if is_red_track(h, t)]
    fields = {}
    for px in sizes:
        # a texel is road where most of the class raster's texels under it are
        k = raster.n // px
        road = (raster.cls == ROAD).reshape(px, k, px, k).mean(axis=(1, 3)) >= 0.5
        fields[px] = lane_fields(tile, px, road, ways, motor_hw, centre, cycle, trams, red)
    return rows, fields, counts


def _near(tile: Tile, p: shapely.Point, margin: float) -> bool:
    xmin, ymin, xmax, ymax = tile.bounds
    return xmin - margin <= p.x < xmax + margin and ymin - margin <= p.y < ymax + margin


def write_raster(tile: Tile, name: str, rows, index, bits, offset) -> None:
    px = index.shape[0]
    grey = np.stack(
        [(index & 0xFF).astype(np.uint8), bits, offset, (index >> 8).astype(np.uint8)], axis=-1
    ).reshape(px, 4 * px)
    save_grey_png(tile.out("dlm", name), grey)


def run(tile: Tile, px: int = 2048) -> None:
    if not has_extract(tile, "the road markings"):
        return
    raster = road_mask(tile, px)
    if raster is None:
        print(f"{tile.id}: no class raster — skipping the road markings")
        return
    points, pf = read_osm(
        tile, "points", "highway IN ('crossing', 'traffic_signals')", ["highway", "other_tags"]
    )
    lines, lf = read_ways(tile, "highway IS NOT NULL", ["highway", "other_tags"], 0.003)
    trams, _ = read_ways(tile, "railway = 'tram'", ["railway"], 0.003)
    low = px // 2
    wide = wide_mask(tile, raster)
    rows, fields, counts = build(tile, raster, (px, low), points, pf, lines, lf, wide, trams)
    kerbs = kerb_lines(tile)
    if kerbs is None:
        print(f"{tile.id}: no kerb lines yet (run `edges` first) — no kerb band on the ground")
    for size, (bits, offset) in list(fields.items()):
        fields[size] = (bits | kerb_bits(tile, size, kerbs or []), offset)
    placed = len(rows)
    rows = merge_rows(rows)
    report = []
    for size, name in ((px, f"markings_{tile.id}.png"), (low, f"markings_low_{tile.id}.png")):
        index = index_raster(rows, tile, size)
        write_raster(tile, name, rows, index, *fields[size])
        lost = paint_lost(rows, index, tile)
        report.append(
            f"{size}²: clipped by an overlapping row {sum(1 for c, _ in lost if c > 0)}, "
            f"losing paint {sum(1 for _, d in lost if d > 0)}"
        )
    bits = fields[px][0]
    table = {
        "tile": tile.id,
        "crs": f"EPSG:{tile.epsg}",
        "bounds": [round(b) for b in tile.bounds],
        "size": px,
        "lowSize": low,
        "encoding": {
            "layout": "8-bit greyscale, 4 * size wide: R0 G0 B0 A0 R1 ... per row; "
            "markings_low_<tile>.png the same at lowSize (phones)",
            "ra": "1 + the row of `markings` reaching the texel (R low, A high byte; 0 none)",
            "g": f"lane bits: {CYCLE} cycle lane along this side's kerb ({CYCLE_SOLID} its line "
            f"solid, {CYCLE_WIDE} at 2.25 m), {CENTRE} centre-line road ({CENTRE_SOLID} solid, "
            f"{LANE_LINES} lane lines too), {KERB} a kerb line within {KERB_REACH_M:g} m and a "
            f"texel's diagonal, {RED} a red cycle surface",
            "b": f"128 + {EDGE_SCALE:g} * the signed distance (m) to the carriageway's middle",
            "markings": "[cx, cy, angle, halfLength, halfWidth, kind]: the centre in m from "
            "the tile's north-west corner (x east, y north), the axis across the road "
            "(rad from east, ccw), half the extent across and along the road",
        },
        "kinds": {str(k): v for k, v in KINDS.items()},
        "attribution": OSM_ATTRIBUTION,
    }
    listed = [table_row(tile, r) for r in rows]
    tile.out("dlm", f"markings_{tile.id}.json").write_text(table_json(table, listed))
    kinds = {KINDS[k]: sum(1 for r in rows if r[5] == k) for k in (ZEBRA, FURT, STOP)}
    print(
        f"{tile.id}: {len(rows)} markings {kinds} ({placed - len(rows)} merged), {counts}; "
        f"{'; '.join(report)}; "
        f"cycle-lane texels {int(np.count_nonzero(bits & CYCLE))} "
        f"(solid {int(np.count_nonzero(bits & CYCLE_SOLID))}), "
        f"centre-line texels {int(np.count_nonzero(bits & CENTRE))} "
        f"(solid {int(np.count_nonzero(bits & CENTRE_SOLID))}, "
        f"lane lines {int(np.count_nonzero(bits & LANE_LINES))}), "
        f"red {int(np.count_nonzero(bits & RED))}, "
        f"kerb texels {int(np.count_nonzero(bits & KERB))}"
    )
