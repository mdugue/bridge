"""A facade's character from street panoramas: what one image shows of one
LoD2 wall, reduced to profiles and a few ratios that do not change when
the image is moved along the wall (facades.py rectifies it, 20 px a metre).

The poses of two drives past the same wall differ by about 0.6 m, so where
a single window lies on the wall is not reproducible; a period, a share, a
regularity or a proportion is (docs/transformations.md, *Facade traits*).
The fetch therefore caches, per image and wall, profiles in `STEP_M` bins
and a handful of scalars (`traits`); the features are computed from them
in the bake (windows.py), so a feature can be redefined without fetching
the images again. Over the upper wall (`facade_measure.GROUND_M` to 0.3 m
under the eave):

  - `dm`: the darkness on a `MAP_M` grid (`dark_map`), for the features
    the profiles cannot give;
  - `cd` / `ch`: per column bin the mean darkness against the local
    plaster (0 plaster … 1 black) and the openings' share
    (`facade_measure._holes`), ‰, −1 where less than `MIN_SEEN` is seen;
  - `rd` / `rh`: the same per row bin, bottom row (at GROUND_M) first;
  - `ev` / `eh`: the plaster's vertical edges per column bin (lisenen,
    pilasters) and horizontal edges per row bin (sill bands, cornices,
    panel joints), mean gradient ‰ — on the plaster only, the openings
    held `EDGE_CLEAR_M` clear;
  - `tx`: the plaster's fine texture (stucco, ornament): its mean
    difference from a 0.1 m blur, ‰;
  - `fr` / `fa`: the openings' surround, `RING_M` out of them, against the
    plaster `FAR_M` out: signed (lighter +) and absolute lightness
    difference, ‰ of the plaster (a Fasche: a light or set-off band);
    `nw` the openings of a window's size it was read on;
  - over the ground floor (`GF_M`): `gr` the plaster's lightness per row
    bin against the upper plaster's (‰, 1000 = the same), `ge` its
    horizontal edges per row bin (a rusticated plinth's joints), from
    GF_M[0] up.

Nothing here is a window drawn: windows.py grades the profiles per wall
and keeps only what two drives agree on."""

from __future__ import annotations

import base64

import numpy as np
from scipy import ndimage as ndi

from .facade_measure import (
    GROUND_M,
    MIN_COVER,
    MIN_UPPER_M,
    PX,
    _holes,
    gf_holes,
    rectify,
    valid_mask,
)

STEP_M = 0.1  # a profile's bin
MAP_M = 0.2  # a cell of the darkness map
MIN_SEEN = 0.3  # a bin's share that must be seen
EDGE_CLEAR_M = 0.15  # the edges are read this far clear of an opening
RING_M = (0.05, 0.2)  # a window's surround (a Fasche: 10–20 cm)
FAR_M = (0.35, 0.6)  # the plaster it is held against
WINDOW_W_M = (0.4, 3.0)  # an opening of a window's size
WINDOW_H_M = (0.6, 3.5)
GF_M = (0.3, 4.0)


def _bins(values: np.ndarray, seen: np.ndarray, axis: int) -> list[int]:
    """`values` averaged over `seen` pixels per STEP_M bin along `axis` (0:
    rows, 1: columns), ‰, −1 where less than MIN_SEEN of a bin is seen."""
    k = max(1, int(round(STEP_M * PX)))
    n = values.shape[axis] // k
    out = []
    for i in range(n):
        sl = (
            (slice(i * k, (i + 1) * k), slice(None))
            if axis == 0
            else (slice(None), slice(i * k, (i + 1) * k))
        )
        s = seen[sl]
        if s.size == 0 or s.sum() < MIN_SEEN * s.size:
            out.append(-1)
            continue
        out.append(int(round(1000 * float(values[sl][s].mean()))))
    return out


def dark_map(dark: np.ndarray, seen: np.ndarray) -> dict:
    """The upper wall's darkness in MAP_M cells, eave row first: {"w", "h",
    "d"} with `d` base64 bytes, 0–254 (254 black), 255 where less than
    MIN_SEEN of a cell is seen (decode: `decode_map`)."""
    k = int(round(MAP_M * PX))
    h, w = dark.shape[0] // k, dark.shape[1] // k
    d = dark[: h * k, : w * k].reshape(h, k, w, k)
    s = seen[: h * k, : w * k].reshape(h, k, w, k).astype(float)
    n = s.sum((1, 3))
    mean = (d * s).sum((1, 3)) / np.maximum(n, 1)
    cells = np.where(n >= MIN_SEEN * k * k, np.round(np.clip(mean, 0, 1) * 254), 255)
    return {"w": w, "h": h, "d": base64.b64encode(cells.astype(np.uint8).tobytes()).decode()}


def decode_map(m: dict) -> np.ndarray:
    """A `dark_map` as darkness in [0, 1], NaN where unseen; row 0 at the
    eave's end of the band."""
    raw = np.frombuffer(base64.b64decode(m["d"]), np.uint8)
    a = raw.reshape(m["h"], m["w"]).astype(float)
    return np.where(a == 255, np.nan, a / 254)


def _rows_up(profile: list[int]) -> list[int]:
    """A row profile read from the eave down, bottom row first."""
    return profile[::-1]


def _surround(lum: np.ndarray, holes: np.ndarray, valid: np.ndarray, plaster: np.ndarray):
    """(signed, absolute, count): the lightness of the band RING_M round the
    window-sized openings against the plaster FAR_M out, ‰ of the plaster;
    None where no opening of a window's size is seen."""
    labels, n = ndi.label(holes)
    keep = np.zeros(n + 1, bool)
    for i, sl in enumerate(ndi.find_objects(labels), start=1):
        if sl is None:
            continue
        h = (sl[0].stop - sl[0].start) / PX
        w = (sl[1].stop - sl[1].start) / PX
        keep[i] = WINDOW_W_M[0] <= w <= WINDOW_W_M[1] and WINDOW_H_M[0] <= h <= WINDOW_H_M[1]
    count = int(keep.sum())
    if count == 0:
        return None
    win = keep[labels]

    def grown(m: float) -> np.ndarray:
        return ndi.binary_dilation(win, np.ones((3, 3)), iterations=max(1, int(round(m * PX))))

    others = holes & ~win
    ring = grown(RING_M[1]) & ~grown(RING_M[0]) & valid & ~holes
    far = (
        grown(FAR_M[1])
        & ~grown(FAR_M[0])
        & valid
        & ~holes
        & ~ndi.binary_dilation(others, iterations=2)
    )
    if ring.sum() < 0.5 * PX * PX or far.sum() < 0.5 * PX * PX:
        return None
    rel = lum / np.maximum(plaster, 1e-3)
    signed = float(np.median(rel[ring]) - np.median(rel[far]))
    absolute = float(np.mean(np.abs(rel[ring] - 1)) - np.mean(np.abs(rel[far] - 1)))
    return round(1000 * signed), round(1000 * absolute), count


def traits_of(rgb: np.ndarray, valid: np.ndarray, eave: float) -> dict:
    """The image's trait profiles on one rectified wall (see the module);
    {"cov"} alone where too little of the upper wall is seen."""
    z_top, z_bot = 0.3, eave - GROUND_M  # metres below the eave
    upper = valid.copy()
    upper[: int(z_top * PX)] = False
    upper[int(z_bot * PX) :] = False
    rows = max(1, int((z_bot - z_top) * PX))
    cov = float(upper.sum() / max(1, rgb.shape[1] * rows))
    out: dict = {"cov": round(cov, 3)}
    if cov < MIN_COVER or z_bot - z_top < MIN_UPPER_M:
        return out
    found = _holes(rgb, valid, z_top, z_bot)
    if found is None:
        return out
    holes, local = found
    lum = ndi.gaussian_filter(rgb.mean(-1), 1.0)
    plaster = local.mean(-1)
    dark = np.clip(1 - lum / np.maximum(plaster, 1e-3), 0, 1)
    a, b = int(z_top * PX), int(z_bot * PX)
    band = upper[a:b]
    out["cd"] = _bins(dark[a:b], band, 1)
    out["ch"] = _bins(holes[a:b].astype(float), band, 1)
    out["rd"] = _rows_up(_bins(dark[a:b], band, 0))
    out["rh"] = _rows_up(_bins(holes[a:b].astype(float), band, 0))
    out["dm"] = dark_map(dark[a:b], band)
    # the upper band's rows end at GROUND_M: its first row bin lies there
    out["z0"] = round(eave - z_bot, 2)
    clear = ~ndi.binary_dilation(holes, np.ones((3, 3)), iterations=int(EDGE_CLEAR_M * PX))
    plain = valid & clear
    gs = np.abs(ndi.sobel(lum, 1)) / 8
    gz = np.abs(ndi.sobel(lum, 0)) / 8
    up_plain = plain.copy()
    up_plain[:a] = False
    up_plain[b:] = False
    out["ev"] = _bins(gs[a:b], up_plain[a:b], 1)
    out["eh"] = _rows_up(_bins(gz[a:b], up_plain[a:b], 0))
    if up_plain.sum() > PX * PX:
        fine = np.abs(lum - ndi.gaussian_filter(lum, 2.0))
        out["tx"] = round(1000 * float(fine[up_plain].mean()))
    if (s := _surround(lum, holes & upper, valid, plaster)) is not None:
        out["fr"], out["fa"], out["nw"] = s
    # the ground floor's plaster against the upper's
    ref = (
        float(np.median(lum[up_plain] / np.maximum(plaster[up_plain], 1e-3)))
        if up_plain.any()
        else None
    )
    up_lum = float(np.median(lum[up_plain])) if up_plain.any() else None
    g0, g1 = int((eave - GF_M[1]) * PX), int((eave - GF_M[0]) * PX)
    g0 = max(g0, 0)
    gfh = gf_holes(rgb, valid, eave, *GF_M)
    if up_lum and ref and gfh is not None and g1 > g0:
        gplain = valid & ~ndi.binary_dilation(
            gfh, np.ones((3, 3)), iterations=int(EDGE_CLEAR_M * PX)
        )
        gp = gplain[g0:g1]
        if gp.sum() > 0.2 * gp.size:
            out["gr"] = _rows_up(_bins(lum[g0:g1] / up_lum, gp, 0))
            out["ge"] = _rows_up(_bins(gz[g0:g1], gp, 0))
    return out


def measure(wall: dict, img: np.ndarray, cls: np.ndarray, rot: np.ndarray, cam: tuple) -> dict:
    """One image's traits on one wall (facades.measure_image's measurer)."""
    rgb, res, lat, klass = rectify(wall, img, cls, rot, cam)
    valid = valid_mask(res, lat, klass)
    out = traits_of(rgb, valid, wall["eave"])
    upper = valid[int(0.3 * PX) : int((wall["eave"] - GROUND_M) * PX)]
    if upper.any():
        out["res"] = round(
            float(np.median(res[int(0.3 * PX) : int((wall["eave"] - GROUND_M) * PX)][upper])), 3
        )
    return out
