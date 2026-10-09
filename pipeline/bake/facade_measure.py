"""One street panorama measured on one LoD2 wall (facades.py).

The panorama is rectified onto the wall's plane with Mapillary's computed
pose, `PX` pixels a metre, eave at the top row; Mapillary's own semantic
segmentation of the image (its "detections", one Mapbox vector tile per
class) masks everything that is not building — a tree, a car, a person,
the sky — and a pixel the photo resolves coarser than `MAX_RES_M` on the
wall (distance and obliquity) is masked too. On what is left:

  - the openings are the holes in the plaster: the wall's local colour is
    a normalised Gaussian mean over its smooth pixels, what differs from it
    by more than a threshold (three times the median difference, clamped)
    and is enclosed by wall is an opening (`_holes`);
  - `open` is their share of the visible upper wall (from `GROUND_M` to
    the eave), `dark` the share clearly darker than the local plaster,
    `gf_open` the openings' share of the ground floor (0.3–3.4 m).

None of it is a window drawn later: the values are only graded per
building (facades.py) into what the clay already paints."""

from __future__ import annotations

import base64
import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

PX = 20  # px a metre on the wall
GROUND_M = 3.6  # the ground-floor band's top
MAX_RES_M = 0.10  # a wall pixel the photo resolves coarser is masked
EYE_M = 2.0  # the camera above the DGM
MIN_COVER = 0.35  # the share of the upper wall that must be visible
MIN_UPPER_M = 2.5  # an upper wall shorter than this is not measured
CLASS_W, CLASS_H = 1024, 512  # the segmentation's raster

# The segmentation's classes: building is the only one that counts; the
# road, markings and unlabeled are left out (they never cover a facade).
BUILDING = "construction--structure--building"
STORE_SIGN = "object--sign--store"
SKIP = ("construction--flat", "marking", "void--unlabeled")

# The ground floor's profile along the wall (shopfronts.py): in BIN_M bins
# from the wall's start vertex, the openings' share of GF_BAND (metres above
# the ground) where at least BIN_SEEN of the bin's band is visible; the
# store signs between SIGN_BAND; the openings' tops below TOP_BAND[1].
BIN_M = 0.5
GF_BAND = (0.3, 3.4)
ROW_M = 0.3  # `gz`: the band in rows this tall, from GF_BAND[0] up (ten rows)
BIN_SEEN = 0.4
SIGN_BAND = (1.5, 6.5)
SIGN_MIN_M2 = 0.1  # a bin's sign pixels: at least this much wall
SIGN_MAX_RES_M = 0.15  # a sign pixel the photo resolves coarser is ignored
GF_DIFF = 0.15  # a ground-floor pixel this far from the plaster's colour is no plaster
TOP_BAND = (0.3, 5.0)
TOP_MIN_W_M = 0.8  # an opening at least this wide ...
TOP_MAX_FOOT_M = 1.2  # ... reaching this low tells the ground floor's top
TOP_MIN_M = 2.0  # (a top lower than a door is no ground floor's)


# --- Mapillary's detection geometries: a base64 Mapbox vector tile --------


def _varint(b: bytes, i: int) -> tuple[int, int]:
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        s += 7
        if c < 0x80:
            return r, i


def _fields(b: bytes):
    i = 0
    while i < len(b):
        key, i = _varint(b, i)
        f, t = key >> 3, key & 7
        if t == 0:
            v, i = _varint(b, i)
        elif t == 2:
            n, i = _varint(b, i)
            v = b[i : i + n]
            i += n
        elif t == 1:
            v = b[i : i + 8]
            i += 8
        elif t == 5:
            v = b[i : i + 4]
            i += 4
        else:
            raise ValueError(f"wire type {t}")
        yield f, t, v


def _packed(b: bytes) -> list[int]:
    out, i = [], 0
    while i < len(b):
        v, i = _varint(b, i)
        out.append(v)
    return out


def _zigzag(v: int) -> int:
    return (v >> 1) ^ -(v & 1)


def _feature_rings(g: list[int], extent: int) -> list[list[tuple[float, float]]]:
    out, cur = [], []
    x = y = i = 0
    while i < len(g):
        cmd, cnt = g[i] & 7, g[i] >> 3
        i += 1
        if cmd == 7:  # ClosePath
            if cur:
                out.append(cur)
                cur = []
            continue
        for _ in range(cnt):
            x += _zigzag(g[i])
            y += _zigzag(g[i + 1])
            i += 2
            if cmd == 1 and cur:  # MoveTo starts a new ring
                out.append(cur)
                cur = []
            cur.append((x, y))
    if cur:
        out.append(cur)
    return [[(px / extent, py / extent) for px, py in r] for r in out]


def rings(geom_b64: str) -> list[list[tuple[float, float]]]:
    """A detection's polygon rings in [0, 1] image coordinates."""
    out = []
    for f, _, layer in _fields(base64.b64decode(geom_b64)):
        if f != 3:
            continue
        extent, feats = 4096, []
        for lf, _, lv in _fields(layer):
            if lf == 5:
                extent = lv
            elif lf == 2:
                feats.append(lv)
        for feat in feats:
            g = next((_packed(fv) for ff, _, fv in _fields(feat) if ff == 4), None)
            if g:
                out.extend(_feature_rings(g, extent))
    return out


def class_map(dets: list[dict], w: int = CLASS_W, h: int = CLASS_H) -> np.ndarray:
    """uint8 raster: 1 building, 2 anything else detected, 3 a store sign,
    0 nothing. The polygons are drawn largest first, so a smaller occluder
    ends on top."""
    items = []
    for d in dets:
        value = d.get("value", "")
        if any(s in value for s in SKIP):
            continue
        code = 1 if value == BUILDING else 3 if value == STORE_SIGN else 2
        for r in rings(d["geometry"]):
            if len(r) < 3:
                continue
            pts = [(px * w, py * h) for px, py in r]
            area = abs(
                sum(pts[k][0] * pts[k - 1][1] - pts[k - 1][0] * pts[k][1] for k in range(len(pts)))
            )
            items.append((area, code, pts))
    im = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(im)
    for _, code, pts in sorted(items, key=lambda t: -t[0]):
        draw.polygon(pts, fill=code)
    return np.asarray(im)


# --- the rectification ------------------------------------------------------


def rotation_matrix(rotvec) -> np.ndarray:
    """Mapillary's `computed_rotation` (an axis-angle vector, world → camera)
    as a matrix (Rodrigues)."""
    v = np.asarray(rotvec, float)
    theta = float(np.linalg.norm(v))
    if theta < 1e-12:
        return np.eye(3)
    k = v / theta
    kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(theta) * kx + (1 - math.cos(theta)) * kx @ kx


def rectify(wall: dict, img: np.ndarray, cls: np.ndarray, rot: np.ndarray, cam: tuple):
    """The wall as the panorama sees it: (rgb, metres a pixel, latitude,
    class) per wall pixel, row 0 at the eave. `wall` carries a, b (its ends),
    L, n (outward normal), eave (height) and zg (the ground in front of
    it); `cam` is (x, y, z) of the camera."""
    h, wd = img.shape[:2]
    (ax, ay), (bx, by), length, height = wall["a"], wall["b"], wall["L"], wall["eave"]
    x, y, z0 = cam
    s = (np.arange(int(length * PX)) + 0.5) / PX
    zz = height - (np.arange(int(height * PX)) + 0.5) / PX
    S, ZZ = np.meshgrid(s, zz)
    X = ax + (bx - ax) / length * S - x
    Y = ay + (by - ay) / length * S - y
    Z = wall["zg"] + ZZ - z0
    P = np.stack([X, Y, Z], -1)
    C = P @ rot.T
    lon = np.arctan2(C[..., 0], C[..., 2])
    lat = np.arctan2(-C[..., 1], np.hypot(C[..., 0], C[..., 2]))
    u = (lon / (2 * np.pi) + 0.5) * wd
    v = (0.5 - lat / np.pi) * h
    out = np.stack(
        [ndi.map_coordinates(img[..., c], [v, u], order=1, mode="wrap") for c in range(3)], -1
    )
    cu = (u * cls.shape[1] / wd) % cls.shape[1]
    cv = v * cls.shape[0] / h
    klass = ndi.map_coordinates(cls, [cv, cu], order=0, mode="nearest")
    dist = np.linalg.norm(C, axis=-1)
    normal = np.array([wall["n"][0], wall["n"][1], 0.0])
    cosi = np.abs((P @ normal) / np.maximum(dist, 1e-6))
    res = dist * 2 * np.pi / wd / np.maximum(cosi, 0.2)
    return out, res, lat, klass


def valid_mask(res: np.ndarray, lat: np.ndarray, klass: np.ndarray) -> np.ndarray:
    """Where the segmentation says building, the photo resolves the wall and
    it is not the nadir; kept 0.25 m clear of everything else."""
    bad = (klass != 1) | (res > MAX_RES_M) | (lat < -1.1)
    bad = ndi.binary_dilation(bad, np.ones((3, 3)), iterations=int(0.25 * PX))
    return ~bad


def _holes(img: np.ndarray, valid: np.ndarray, z_top: float, z_bot: float):
    """The openings between rows z_top and z_bot (metres below the eave),
    and the local plaster colour; None when too little plaster is smooth."""
    a, b = int(z_top * PX), int(z_bot * PX)
    lum = ndi.gaussian_filter(img.mean(-1), 1.0)
    grad = np.hypot(ndi.sobel(lum, 0), ndi.sobel(lum, 1)) / 8
    smooth = (grad < 0.012) & valid
    sig = 1.5 * PX
    wsum = ndi.gaussian_filter(smooth.astype(float), sig) + 1e-6
    local = np.stack([ndi.gaussian_filter(img[..., c] * smooth, sig) / wsum for c in range(3)], -1)
    diff = np.linalg.norm(img - local, axis=-1)
    dv = diff[smooth]
    if dv.size < 400:
        return None
    t = float(np.clip(3.0 * np.median(dv), 0.06, 0.14))
    zone = np.zeros_like(valid)
    zone[a:b] = True
    nonwall = ndi.binary_closing((diff >= t) & valid & zone, np.ones((3, 3)))
    # small pockets of plaster inside a non-wall area belong to it
    gaps = ndi.binary_fill_holes(nonwall) & ~nonwall
    labels, n = ndi.label(gaps)
    if n:
        size = ndi.sum(np.ones_like(labels), labels, np.arange(1, n + 1)) / PX / PX
        nonwall |= np.concatenate([[False], size < 4.0])[labels]
    holes = ndi.binary_opening(nonwall, np.ones((int(0.3 * PX), int(0.3 * PX))))
    return holes, local


def _band(eave: float, lo: float, hi: float) -> tuple[int, int]:
    """The rows (from the eave down) between lo and hi metres above ground."""
    return int((eave - hi) * PX), int((eave - lo) * PX)


def bin_shares(mask: np.ndarray, seen: np.ndarray, n_bins: int) -> list[int]:
    """Per BIN_M column bin: mask's share of the seen pixels in percent, or
    -1 where less than BIN_SEEN of the bin is seen. Both are the band's rows
    only."""
    w = int(BIN_M * PX)
    out = []
    for k in range(n_bins):
        s = seen[:, k * w : (k + 1) * w]
        if s.size == 0 or s.sum() < BIN_SEEN * s.size:
            out.append(-1)
            continue
        out.append(round(100 * float((mask[:, k * w : (k + 1) * w] & s).sum() / s.sum())))
    return out


def ground_top(holes: np.ndarray, eave: float) -> float | None:
    """The ground floor's top in metres above ground: the median top of the
    openings at least TOP_MIN_W_M wide that reach below TOP_MAX_FOOT_M and
    end between TOP_MIN_M and the band's top (a shop window, a door); None
    unless two do or one is 3 m wide."""
    a, b = _band(eave, *TOP_BAND)
    labels, n = ndi.label(holes[a:b])
    tops, widest = [], 0.0
    for sl in ndi.find_objects(labels):
        if sl is None:
            continue
        rows, cols = sl
        width = (cols.stop - cols.start) / PX
        top = TOP_BAND[1] - rows.start / PX
        foot = TOP_BAND[1] - rows.stop / PX
        if width < TOP_MIN_W_M or foot > TOP_MAX_FOOT_M or top < TOP_MIN_M or rows.start == 0:
            continue
        tops.append(top)
        widest = max(widest, width)
    if len(tops) >= 2 or widest >= 3.0:
        return round(float(np.median(tops)), 2)
    return None


def plaster_colour(rgb: np.ndarray, valid: np.ndarray, eave: float) -> np.ndarray | None:
    """The ground floor's own plaster: the median colour of the brighter
    half of its smooth pixels (a pier, a plinth). Openings are mostly darker
    than the render around them (glass, a recess, a shutter), and a mean over
    both, as _holes takes, makes every pixel of a shopfront differ."""
    a, b = _band(eave, *GF_BAND)
    lum = ndi.gaussian_filter(rgb.mean(-1), 1.0)
    grad = np.hypot(ndi.sobel(lum, 0), ndi.sobel(lum, 1)) / 8
    smooth = (grad < 0.012) & valid
    px = rgb[a:b][smooth[a:b]]
    if len(px) < 0.5 * PX * PX:
        return None
    lp = px.mean(-1)
    return np.median(px[lp >= np.median(lp)], axis=0)


def gf_holes(rgb: np.ndarray, valid: np.ndarray, eave: float, lo: float, hi: float):
    """The ground floor's openings between lo and hi metres above ground:
    what is clearly darker than its plaster (plaster_colour) or differs from
    it in colour, cleaned of specks smaller than 0.3 m. None when no plaster
    is seen."""
    plaster = plaster_colour(rgb, valid, eave)
    if plaster is None:
        return None
    a, b = _band(eave, lo, hi)
    a = max(a, 0)
    img = ndi.gaussian_filter(rgb, (1.0, 1.0, 0))
    lum = img.mean(-1)
    diff = np.linalg.norm(img - plaster, axis=-1)
    off = (lum < 0.75 * plaster.mean()) | (diff > GF_DIFF)
    zone = np.zeros_like(valid)
    zone[a:b] = True
    holes = ndi.binary_closing(off & valid & zone, np.ones((3, 3)))
    k = int(0.3 * PX)
    return ndi.binary_opening(holes, np.ones((k, k))) & zone


def profile(rgb, valid, res, lat, klass, eave: float, length: float) -> dict:
    """The ground floor along the wall (see GF_BAND): `gf` the openings'
    share per bin (bin_shares), `gz` the same per ROW_M row of the band
    (bottom row first: tells a shop window or a door, open from knee height,
    from a house window above its sill and from a dark plinth), `sg` the
    bins a store sign covers, `sz` the signs' band in metres above ground,
    `gt` the ground floor's top (ground_top). Empty where the ground floor
    is not seen."""
    n_bins = max(1, math.ceil(length / BIN_M - 1e-6))
    out: dict = {}
    a, b = _band(eave, *GF_BAND)
    if valid[a:b].sum() < 0.1 * valid.shape[1] * (b - a):
        return out
    holes = gf_holes(rgb, valid, eave, *GF_BAND)
    if holes is not None:
        out["gf"] = bin_shares(holes[a:b], valid[a:b], n_bins)
        n_rows = int((GF_BAND[1] - GF_BAND[0]) / ROW_M + 1e-6)
        out["gz"] = []
        for r in range(n_rows):
            ra, rb = _band(eave, GF_BAND[0] + r * ROW_M, GF_BAND[0] + (r + 1) * ROW_M)
            out["gz"].append(bin_shares(holes[ra:rb], valid[ra:rb], n_bins))
        tall = gf_holes(rgb, valid, eave, *TOP_BAND)
        if (gt := ground_top(tall, eave)) is not None:
            out["gt"] = gt
    sa, sb = _band(eave, *SIGN_BAND)
    sa = max(sa, 0)
    sign = (klass[sa:sb] == 3) & (res[sa:sb] <= SIGN_MAX_RES_M) & (lat[sa:sb] > -1.1)
    if sign.any():
        w = int(BIN_M * PX)
        per_bin = [int(sign[:, k * w : (k + 1) * w].sum()) for k in range(n_bins)]
        bins = [k for k, c in enumerate(per_bin) if c >= SIGN_MIN_M2 * PX * PX]
        if bins:
            out["sg"] = bins
            rows = np.nonzero(sign.any(1))[0]
            z = eave - (sa + rows + 0.5) / PX
            out["sz"] = [
                round(float(np.percentile(z, 10)), 2),
                round(float(np.percentile(z, 90)), 2),
            ]
    return out


def measure(wall: dict, img: np.ndarray, cls: np.ndarray, rot: np.ndarray, cam: tuple) -> dict:
    """The image's values on the wall: cov (visible share of the upper
    wall), res (median metres a pixel), and when enough is seen open, dark
    and gf_open (None where the ground floor is hidden); and the ground
    floor's profile (profile) wherever it is seen."""
    rgb, res, lat, klass = rectify(wall, img, cls, rot, cam)
    eave = wall["eave"]
    valid = valid_mask(res, lat, klass)
    z_top, z_bot = 0.3, eave - GROUND_M  # rows below the eave
    upper = valid.copy()
    upper[: int(z_top * PX)] = False
    upper[int(z_bot * PX) :] = False
    rows = max(1, int((z_bot - z_top) * PX))
    cov = float(upper.sum() / max(1, rgb.shape[1] * rows))
    out = {
        "cov": round(cov, 3),
        "res": round(float(np.median(res[upper])), 3) if upper.any() else 9,
    }
    prof = profile(rgb, valid, res, lat, klass, eave, wall["L"])
    if cov < MIN_COVER or z_bot - z_top < MIN_UPPER_M:
        return out | prof
    found = _holes(rgb, valid, z_top, z_bot)
    if found is None:
        return out | prof
    holes, local = found
    seen = upper.sum()
    lum, plaster = rgb.mean(-1), local.mean(-1)
    out["open"] = round(float((holes & upper).sum() / seen), 3)
    out["dark"] = round(float(((lum < 0.7 * plaster) & upper).sum() / seen), 3)
    out["gf_open"] = None
    gz0, gz1 = eave - 3.4, eave - 0.3
    ground = valid.copy()
    ground[: int(gz0 * PX)] = False
    ground[int(gz1 * PX) :] = False
    if ground.sum() > 0.3 * rgb.shape[1] * 3.1 * PX:
        gf = _holes(rgb, valid, gz0, gz1)
        if gf is not None:
            out["gf_open"] = round(float((gf[0] & ground).sum() / ground.sum()), 3)
    return out | prof


def load_image(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), float) / 255
