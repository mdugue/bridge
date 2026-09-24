"""Grid variants for the terrain study (sharper ground at hard edges).

Writes raw little-endian float32 n*n grids (row 0 = north, pixel centres —
the lib/city/heightfield.ts convention) into <study_dir>:

  v1_2000.f32  DGM1 at its native 1 m (2000²), straight from the GeoTIFF
  v2_4000.f32  LSC ground (class 2, the 90 % TRAIN split of lsc_extract.py)
               binned at 0.5 m (4000²): per-cell mean; cells with no ground
               return (buildings, water, dense shrubs) take the DGM1 bilinear
               value — which is exactly what the scan's own synthetic fill
               classes 8 and 30 carry (verified: they equal DGM1 to the mm).

Run:
  uv run --with numpy --with rasterio --with scipy python \
      scripts/terrain-study/build_grids.py <dgm.tif> <study_dir>
"""

import sys
from pathlib import Path

import numpy as np
import rasterio
from scipy.ndimage import map_coordinates

X0, Y1 = 412000.0, 5658000.0  # tile NW corner (EPSG:25833)
SIZE = 2000.0


def main(dgm_path: str, study: str) -> None:
    out = Path(study)
    with rasterio.open(dgm_path) as ds:
        dgm = ds.read(1).astype(np.float32)
        assert ds.transform.c == X0 and ds.transform.f == Y1, ds.transform
    dgm.astype("<f4").tofile(out / "v1_2000.f32")

    z = np.load(out / "lsc_ground.npz")
    scale, offset = z["scale"], z["offset"]
    g = z["train"]
    x = g[:, 0] * scale[0] + offset[0]
    y = g[:, 1] * scale[1] + offset[1]
    h = g[:, 2] * scale[2] + offset[2]

    n = 4000
    cell = SIZE / n
    col = np.floor((x - X0) / cell).astype(np.int64)
    row = np.floor((Y1 - y) / cell).astype(np.int64)
    ok = (col >= 0) & (col < n) & (row >= 0) & (row < n)
    idx = row[ok] * n + col[ok]
    s = np.bincount(idx, weights=h[ok], minlength=n * n)
    c = np.bincount(idx, minlength=n * n)
    grid = np.full(n * n, np.nan)
    has = c > 0
    grid[has] = s[has] / c[has]

    # Fill: DGM1 bilinear at the empty cells' centres (pixel centres of the
    # 1 m DGM sit at +0.5 m).
    rr, cc = np.divmod(np.nonzero(~has)[0], n)
    ex = X0 + (cc + 0.5) * cell
    ey = Y1 - (rr + 0.5) * cell
    grid[~has] = map_coordinates(
        dgm.astype(np.float64), [Y1 - 0.5 - ey, ex - X0 - 0.5], order=1, mode="nearest"
    )
    grid.astype("<f4").tofile(out / f"v2_{n}.f32")
    np.minimum(c, 255).astype(np.uint8).tofile(out / f"v2_{n}_count.u8")
    print(
        f"v2 {n}²: {has.mean() * 100:.1f} % cells with ground returns, "
        f"mean {c[has].mean():.2f} pts/cell"
    )


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
