"""Extract the ground-ish classes of the GeoSN laser scan (LSC) for the TIN study.

Reads the primary tile's LAZ once (laspy + lazrs, streamed in chunks) and
writes a compact .npz with the classes the terrain study needs:

  2  = ground           (real returns — split 90/10 into train / held-out test)
  8  = synthetic water fill (1 m grid)
  30 = synthetic fill on a 1 m grid (under buildings?)

Coordinates stay as the LAS integers (scale 0.001, offsets from the header)
to keep the file small. The split is seeded, so every run holds out the
same points.

Run (the system numpy is broken; use uv):
  uv run --with numpy --with 'laspy[lazrs]' python \
      scripts/terrain-study/lsc_extract.py <laz> <out_dir>
"""

import sys
from pathlib import Path

import laspy
import numpy as np

KEEP = (2, 8, 30)
HOLDOUT = 0.10
SEED = 20260923
CHUNK = 5_000_000


def main(laz: str, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    parts: dict[int, list[np.ndarray]] = {c: [] for c in KEEP}
    counts: dict[int, int] = {}
    with laspy.open(laz) as f:
        h = f.header
        scale = np.array(h.scales)
        offset = np.array(h.offsets)
        for chunk in f.chunk_iterator(CHUNK):
            cls = np.asarray(chunk.classification, dtype=np.uint8)
            u, n = np.unique(cls, return_counts=True)
            for c, k in zip(u.tolist(), n.tolist()):
                counts[c] = counts.get(c, 0) + k
            X = np.asarray(chunk.X, dtype=np.int32)
            Y = np.asarray(chunk.Y, dtype=np.int32)
            Z = np.asarray(chunk.Z, dtype=np.int32)
            for c in KEEP:
                m = cls == c
                if m.any():
                    parts[c].append(np.stack([X[m], Y[m], Z[m]], axis=1))
    arrays = {
        f"c{c}": np.concatenate(parts[c]) if parts[c] else np.zeros((0, 3), np.int32)
        for c in KEEP
    }
    rng = np.random.default_rng(SEED)
    g = arrays.pop("c2")
    test = rng.random(len(g)) < HOLDOUT
    np.savez(
        out / "lsc_ground.npz",
        train=g[~test],
        test=g[test],
        water=arrays["c8"],
        fill=arrays["c30"],
        scale=scale,
        offset=offset,
    )
    print("class counts:", dict(sorted(counts.items())))
    print(
        f"ground train {int((~test).sum())}, test {int(test.sum())}, "
        f"water {len(arrays['c8'])}, fill30 {len(arrays['c30'])}"
    )


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
