"""Terrain study, metrics half: profiles across hard edges + held-out accuracy.

Inputs (all in <study_dir>, see build_grids.py / tin-study.ts):
  lsc_ground.npz            class-2 ground points, 90/10 train/test split
  <grid>.f32                raw float32 n*n grids (row 0 = north, pixel centres)
  <grid>_tin<cm>.{coords,tris}.u32   Delatin meshes of those grids
Plus the committed data/dlm/walls_<tile>.geojson and the neighbours'
committed DGMs, resampled to the 512² grid the viewer then drew beyond the
primary, for the seam check.

Metrics:
  1. main-step width (10–90 % of the step between the plateaus 2–3.5 m either
     side of the reference's steepest point, see main_step), max slope, and the
     profile RMSE over ±10 m, on 5 profiles each across the 7 tallest
     retaining/city walls, against a reference profile binned (0.25 m, median)
     from ALL ground returns within 0.75 m of the profile line;
  2. vertical RMSE / p95 |error| against the held-out 10 % of the ground
     returns: tile-wide, in the 20 m band around earth-retaining walls, and on
     steep ground (the train-only 0.5 m DTM's slope > 45°) — the last one is
     the "hard edge" population that does not depend on OSM;
  3. the seam step against the unchanged 512² neighbours.
DGM1 (V0/V1) was produced by GeoSN from ALL ground returns, test split
included, so its accuracy numbers are slightly optimistic; V2 is strictly
out-of-sample.

Run:
  uv run --with numpy --with scipy --with matplotlib --with rasterio python \
      scripts/terrain-study/metrics.py <study_dir> <out.json>
"""

import json
import sys
from pathlib import Path

import numpy as np
from matplotlib.tri import LinearTriInterpolator, Triangulation
from scipy.ndimage import distance_transform_edt, map_coordinates

ROOT = Path(__file__).resolve().parents[2]
TILE = "33412_5656_2_sn"
MINX, MINY, MAXX, MAXY = 412000.0, 5656000.0, 414000.0, 5658000.0
RETAINING = {"retaining_wall", "city_wall", "embankment"}

# Profile sites: (label, wall feature index in walls_<tile>.geojson, anchor).
# Picked as the largest DGM1 steps across earth-retaining OSM walls
# (|z(+8 m) − z(−8 m)| on each wall, see the study notes).
SITES = [
    ("Brühlsche Terrasse N wall (Jungfernbastei)", 4, (412044.3, 5656507.4)),
    ("Jungfernbastei S face", 5, (412053.8, 5656396.6)),
    ("Terrassenufer quay wall", 69, (412849.1, 5656817.3)),
    ("Terrassenufer quay wall W", 35, (412765.3, 5656763.0)),
    ("Königsufer (N bank) wall", 94, (412639.4, 5657061.0)),
    ("retaining wall 53 (Neustadt)", 53, (413111.5, 5657378.2)),
    ("retaining wall 146 (S)", 146, (413074.9, 5656123.6)),
]
ALONG = (-6.0, -3.0, 0.0, 3.0, 6.0)  # profiles per site, offset along the wall
S = np.arange(-15.0, 15.0001, 0.1)


# --- surfaces -------------------------------------------------------------


class Grid:
    def __init__(self, path: Path):
        n = int(path.stem.split("_")[-1])
        self.n = n
        self.z = np.fromfile(path, dtype="<f4").reshape(n, n).astype(np.float64)
        self.d = (MAXX - MINX) / n

    def at(self, x, y):
        col = (np.asarray(x) - MINX) / self.d - 0.5
        row = (MAXY - np.asarray(y)) / self.d - 0.5
        return map_coordinates(self.z, [row, col], order=1, mode="nearest")


class Tin:
    def __init__(self, study: Path, name: str):
        grid, cm = name.rsplit("_tin", 1)
        n = int(grid.split("_")[-1])
        src = np.fromfile(study / f"{grid}.f32", dtype="<f4").reshape(n, n)
        c = np.fromfile(study / f"{name}.coords.u32", dtype="<u4").reshape(-1, 2)
        t = np.fromfile(study / f"{name}.tris.u32", dtype="<u4").reshape(-1, 3)
        d = (MAXX - MINX) / n
        gx, gy = c[:, 0], c[:, 1]
        x = np.where(gx == 0, MINX, np.where(gx == n - 1, MAXX, MINX + (gx + 0.5) * d))
        y = np.where(gy == 0, MAXY, np.where(gy == n - 1, MINY, MAXY - (gy + 0.5) * d))
        # cm quantisation, as shipped
        zq = np.round(src[gy, gx].astype(np.float64) * 100) / 100
        self.tri = Triangulation(x, y, t.astype(np.int64))
        self.interp = LinearTriInterpolator(self.tri, zq)
        self.vertices = len(x)
        self.triangles = len(t)

    def at(self, x, y):
        v = self.interp(np.asarray(x, float), np.asarray(y, float))
        return np.ma.filled(v, np.nan)


# --- walls / profiles -----------------------------------------------------


def load_walls():
    doc = json.loads((ROOT / f"data/dlm/walls_{TILE}.geojson").read_text())
    return doc["features"]


def site_frame(feature, anchor):
    """Unit tangent of the wall segment nearest the anchor + its normal."""
    c = np.array(feature["geometry"]["coordinates"], float)
    a = np.array(anchor)
    best = None
    for p, q in zip(c[:-1], c[1:]):
        L = np.hypot(*(q - p))
        if L < 1e-6:
            continue
        t = (q - p) / L
        s = np.clip(np.dot(a - p, t), 0, L)
        dist = np.hypot(*(p + t * s - a))
        if best is None or dist < best[0]:
            best = (dist, t, p + t * s)
    _, t, foot = best
    return foot, t, np.array([-t[1], t[0]])


PLATEAU = (2.0, 3.5)  # plateau windows either side of the main step (m)


def main_step(rs, rz):
    """The reference profile's main step: the steepest point within 6 m of the
    OSM line and the plateau levels just below / above it. Several of these
    walls are terraced (the Jungfernbastei climbs 108.6 → 117.4 → 119.7 →
    121.1 m within 8 m), so a 10–90 % width over the whole profile would
    measure the staircase, not the wall."""
    ok = ~np.isnan(rz)
    rs, rz = rs[ok], rz[ok]
    slope = np.abs(np.diff(rz)) / np.diff(rs)
    mid = (rs[:-1] + rs[1:]) / 2
    near = np.abs(mid) <= 6
    if not near.any():
        return None
    k = int(np.argmax(np.where(near, slope, -1)))
    s_star = float(mid[k])
    lo_m = (rs >= s_star - PLATEAU[1]) & (rs <= s_star - PLATEAU[0])
    hi_m = (rs >= s_star + PLATEAU[0]) & (rs <= s_star + PLATEAU[1])
    if not (lo_m.any() and hi_m.any()):
        return None
    lo = float(np.median(rz[lo_m]))
    hi = float(np.median(rz[hi_m]))
    if hi - lo < 1.0:
        return None
    return {"sStar": s_star, "lo": lo, "hi": hi}


def ramp(s, z, step):
    """10–90 % width of the main step, max slope within it."""
    if step is None:
        return None
    lo, hi, s_star = step["lo"], step["hi"], step["sStar"]
    drop = hi - lo
    m = (s >= s_star - PLATEAU[1]) & (s <= s_star + PLATEAU[1]) & ~np.isnan(z)
    s, z = s[m], z[m]
    above90 = np.nonzero(z >= lo + 0.9 * drop)[0]
    if len(above90) == 0:
        return None
    i90 = above90[0]
    below10 = np.nonzero(z[:i90] <= lo + 0.1 * drop)[0]
    if len(below10) == 0:
        return None
    i10 = below10[-1]
    slope = np.abs(np.diff(z)) / np.diff(s)
    return {
        "width": float(s[i90] - s[i10]),
        "maxSlope": float(np.max(slope)),
        "drop": float(drop),
        "sStar": s_star,
    }


def profile_rmse(rs, rz, zs):
    ok = ~np.isnan(rz) & (np.abs(rs) <= 10)
    e = zs[ok] - rz[ok]
    return float(np.sqrt(np.mean(e * e)))


def reference_profile(pts_xy, pts_z, foot, t, nrm):
    rel = pts_xy - foot
    along = rel @ t
    across = rel @ nrm
    m = (np.abs(along) <= 0.75) & (np.abs(across) <= 15.2)
    bins = np.arange(-15.0, 15.0001, 0.25)
    idx = np.digitize(across[m], bins) - 1
    zz = pts_z[m]
    centres = (bins[:-1] + bins[1:]) / 2
    med = np.full(len(centres), np.nan)
    for i in range(len(centres)):
        sel = zz[idx == i]
        if len(sel):
            med[i] = np.median(sel)
    return centres, med, int(m.sum())


def profiles(surfaces, walls, all_xy, all_z):
    # KD-free point preselection: points within 30 m of any site anchor.
    out = []
    for label, wi, anchor in SITES:
        feat = walls[wi]
        foot0, t, nrm = site_frame(feat, anchor)
        # orient the normal to the HIGH side (V1 = DGM1 decides)
        v1 = surfaces["V1 DGM1 2000²"]
        if v1.at([foot0[0] + nrm[0] * 8], [foot0[1] + nrm[1] * 8])[0] < v1.at(
            [foot0[0] - nrm[0] * 8], [foot0[1] - nrm[1] * 8]
        )[0]:
            nrm = -nrm
        near = np.hypot(all_xy[:, 0] - foot0[0], all_xy[:, 1] - foot0[1]) < 30
        pxy, pz = all_xy[near], all_z[near]
        for off in ALONG:
            foot = foot0 + t * off
            rs, rz, npts = reference_profile(pxy, pz, foot, t, nrm)
            step = main_step(rs, rz)
            rec = {"site": label, "wall": wi, "kind": feat["properties"]["kind"],
                   "along": off, "refPoints": npts, "step": step,
                   "ref": ramp(rs, rz, step)}
            xs = foot[0] + nrm[0] * S
            ys = foot[1] + nrm[1] * S
            rx = foot[0] + nrm[0] * rs
            ry = foot[1] + nrm[1] * rs
            rec["variants"] = {}
            rec["profileRmse"] = {}
            for name, surf in surfaces.items():
                rec["variants"][name] = ramp(S, surf.at(xs, ys), step)
                rec["profileRmse"][name] = profile_rmse(rs, rz, surf.at(rx, ry))
            out.append(rec)
    return out


# --- accuracy -------------------------------------------------------------


def wall_distance(walls):
    """Distance (m) to the nearest earth-retaining wall line, 0.5 m raster."""
    n = 4000
    mask = np.ones((n, n), bool)
    for f in walls:
        if f["properties"]["kind"] not in RETAINING:
            continue
        c = np.array(f["geometry"]["coordinates"], float)
        for p, q in zip(c[:-1], c[1:]):
            L = max(np.hypot(*(q - p)), 1e-6)
            k = np.linspace(0, 1, int(L / 0.2) + 2)
            x = p[0] + (q[0] - p[0]) * k
            y = p[1] + (q[1] - p[1]) * k
            col = np.clip(((x - MINX) / 0.5).astype(int), 0, n - 1)
            row = np.clip(((MAXY - y) / 0.5).astype(int), 0, n - 1)
            mask[row, col] = False
    return distance_transform_edt(mask) * 0.5


def err_stats(e):
    e = e[~np.isnan(e)]
    a = np.abs(e)
    return {"n": int(len(e)), "rmse": float(np.sqrt(np.mean(e * e))),
            "p95": float(np.percentile(a, 95)), "bias": float(np.mean(e))}


def accuracy(surfaces, test_xy, test_z, subsets):
    res = {}
    for name, surf in surfaces.items():
        z = surf.at(test_xy[:, 0], test_xy[:, 1])
        e = z - test_z
        res[name] = {k: err_stats(e[m]) for k, m in subsets.items()}
    return res


# --- seams -----------------------------------------------------------------


def neighbour_grid(tile, n=512):
    """A neighbour's committed DGM, bilinear-resampled to n² pixel centres
    (the grid bake's resample, scripts/bake-tiles.ts readDgm)."""
    import rasterio

    with rasterio.open(ROOT / f"data/dgm/dgm1_{tile}_tiff/dgm1_{tile}.tif") as src:
        full = src.read(1).astype(np.float64)
        b = src.bounds
    size = full.shape[0]
    centres = (np.arange(n) + 0.5) * size / n - 0.5
    rows, cols = np.meshgrid(centres, centres, indexing="ij")
    z = map_coordinates(full, [rows, cols], order=1, mode="nearest")
    return [b.left, b.bottom, b.right, b.top], z


def seam_edges(surfaces):
    """Along the primary's west (x=412000) and north (y=5658000) edges: the
    neighbour's EDGE ROW (what its snapped border ring shows) vs ours."""
    out = {}
    (wb, wz) = neighbour_grid("33410_5656_2_sn")
    (nb, nz) = neighbour_grid("33412_5658_2_sn")
    d = 2000 / 512
    yw = MAXY - (np.arange(512) + 0.5) * d  # neighbour W: its east column
    xn = MINX + (np.arange(512) + 0.5) * d  # neighbour N: its south row
    for name, surf in surfaces.items():
        a = surf.at(np.full(512, MINX), yw) - wz[:, -1]
        b = surf.at(xn, np.full(512, MAXY)) - nz[-1, :]
        both = np.abs(np.concatenate([a, b]))
        out[name] = {"meanAbs": float(np.nanmean(both)), "p95": float(np.nanpercentile(both, 95)),
                     "max": float(np.nanmax(both))}
    return out


def main(study: str, out_path: str):
    study_dir = Path(study)
    surfaces = {
        "V0 shipped 1024²": Grid(study_dir / "v0_1024.f32"),
        "V0c 1024² + client conflation": Grid(study_dir / "v0c_1024.f32"),
        "V1 DGM1 2000²": Grid(study_dir / "v1_2000.f32"),
        "V1c DGM1 2000² + conflation": Grid(study_dir / "v1c_2000.f32"),
        "V2 LSC 0.5 m": Grid(study_dir / "v2_4000.f32"),
        "V2c LSC 0.5 m + conflation": Grid(study_dir / "v2c_4000.f32"),
    }
    tins = {}
    for grid, cms in (("v1_2000", (25, 20, 15, 10, 5)), ("v1c_2000", (25, 10)),
                      ("v2_4000", (25, 10)), ("v2c_4000", (25, 10))):
        for cm in cms:
            name = f"{grid}_tin{cm}"
            if (study_dir / f"{name}.tris.u32").exists():
                tins[f"TIN {grid} @{cm} cm"] = Tin(study_dir, name)
    surfaces.update(tins)

    z = np.load(study_dir / "lsc_ground.npz")
    sc, of = z["scale"], z["offset"]

    def xyz(a):
        return np.stack([a[:, 0] * sc[0] + of[0], a[:, 1] * sc[1] + of[1]], 1), a[:, 2] * sc[2] + of[2]

    test_xy, test_z = xyz(z["test"])
    train_xy, train_z = xyz(z["train"])
    all_xy = np.concatenate([train_xy, test_xy])
    all_z = np.concatenate([train_z, test_z])
    del train_xy, train_z

    walls = load_walls()
    prof = profiles(surfaces, walls, all_xy, all_z)
    del all_xy, all_z

    dist = wall_distance(walls)
    col = np.clip(((test_xy[:, 0] - MINX) / 0.5).astype(int), 0, 3999)
    row = np.clip(((MAXY - test_xy[:, 1]) / 0.5).astype(int), 0, 3999)
    v2 = surfaces["V2 LSC 0.5 m"].z
    gy, gx = np.gradient(v2, 0.5)
    steep = np.hypot(gx, gy)[row, col] > 1.0
    subsets = {"tile": np.ones(len(test_z), bool), "wallBand20m": dist[row, col] <= 10.0,
               "steep45": steep}
    acc = accuracy(surfaces, test_xy, test_z, subsets)
    seams = seam_edges(surfaces)
    sizes = {k: {"vertices": s.vertices, "triangles": s.triangles} for k, s in tins.items()}
    Path(out_path).write_text(json.dumps({"profiles": prof, "accuracy": acc, "seams": seams,
                                          "tinSizes": sizes}, indent=1))
    summarise(prof, acc, seams, list(surfaces))


def summarise(prof, acc, seams, names):
    print("| variant | step width med (m) | p75 | max slope med (°) | profile RMSE med (m) | RMSE tile | p95 tile "
          "| RMSE wall band | p95 wall band | RMSE steep | p95 steep | seam mean/max |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    ref_w = [p["ref"]["width"] for p in prof if p["ref"]]
    ref_s = [p["ref"]["maxSlope"] for p in prof if p["ref"]]
    print(f"| LSC reference (all returns, 0.25 m bins) | {np.median(ref_w):.2f} | {np.percentile(ref_w, 75):.2f} | "
          f"{np.degrees(np.arctan(np.median(ref_s))):.0f} | | | | | | | | |")
    for n in names:
        w = [p["variants"][n]["width"] for p in prof if p["variants"][n]]
        s = [p["variants"][n]["maxSlope"] for p in prof if p["variants"][n]]
        pr = [p["profileRmse"][n] for p in prof]
        a = acc[n]
        print(f"| {n} | {np.median(w):.2f} | {np.percentile(w, 75):.2f} | {np.degrees(np.arctan(np.median(s))):.0f} | "
              f"{np.median(pr):.2f} | {a['tile']['rmse']:.3f} | {a['tile']['p95']:.3f} | {a['wallBand20m']['rmse']:.3f} | "
              f"{a['wallBand20m']['p95']:.3f} | {a['steep45']['rmse']:.3f} | {a['steep45']['p95']:.3f} | "
              f"{seams[n]['meanAbs']:.2f}/{seams[n]['max']:.2f} |")
    print()
    keys = ["V0 shipped 1024²", "V0c 1024² + client conflation", "V1 DGM1 2000²", "V2 LSC 0.5 m",
            "TIN v1_2000 @10 cm", "TIN v1_2000 @25 cm"]
    print("per site — main-step width med (m) / profile RMSE med (m): ref | " + " | ".join(keys))
    for label, _, _ in SITES:
        rows = [p for p in prof if p["site"] == label]

        def med(key):
            v = [(p["ref"] if key == "ref" else p["variants"].get(key)) for p in rows]
            v = [x["width"] for x in v if x]
            w = f"{np.median(v):.2f}" if v else "-"
            if key == "ref":
                return w
            return f"{w}/{np.median([p['profileRmse'][key] for p in rows]):.2f}"

        drop = [p["ref"]["drop"] for p in rows if p["ref"]]
        off = [p["step"]["sStar"] for p in rows if p["step"]]
        print(f"  {label}: step {np.median(drop) if drop else float('nan'):.1f} m, "
              f"at s={np.median(off) if off else float('nan'):+.1f} m from the OSM line | "
              + " | ".join(med(k) for k in ["ref", *keys]))
    print(f"test subsets: tile {acc[names[0]]['tile']['n']}, wall band {acc[names[0]]['wallBand20m']['n']}, "
          f"steep {acc[names[0]]['steep45']['n']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
