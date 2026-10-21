import numpy as np
from PIL import Image, ImageDraw

from bake.dop_lean import (
    LEAN_MIN_TEXELS,
    MAP_STEP,
    Sample,
    building_lean,
    fit_leans,
    lean_map,
    shading_samples,
)
from bake.dop_light import sun_vector

SUN = sun_vector(180, 35)
SOUTH = (0.0, -0.6, 0.8)
NORTH = (0.0, 0.6, 0.8)


def gable(dx=0, dy=0, size=80):
    """A gabled roof's two faces (texels) and an image of it shifted by
    (dx, dy) texels: the south face bright, the north one dark."""
    north = [(20, 20), (60, 20), (60, 40), (20, 40)]
    south = [(20, 40), (60, 40), (60, 60), (20, 60)]
    img = Image.new("F", (size, size), 120.0)
    draw = ImageDraw.Draw(img)
    draw.polygon([(x + dx, y + dy) for x, y in north], fill=50.0)
    draw.polygon([(x + dx, y + dy) for x, y in south], fill=220.0)
    return np.asarray(img), [(north, NORTH), (south, SOUTH)]


def test_lean_map_finds_the_roof_where_the_image_shows_it():
    lum, faces = gable(dx=4, dy=-6)
    grid = lean_map(lum, faces, SUN, reach=10)
    i, j = np.unravel_index(int(np.nanargmax(grid)), grid.shape)
    assert (j * MAP_STEP - 10, i * MAP_STEP - 10) == (4, -6)


def test_lean_map_skips_a_roof_without_shading():
    lum, faces = gable()
    flat = [(ring, (0.0, 0.0, 1.0)) for ring, _ in faces]
    assert lean_map(lum, flat, SUN, reach=10) is None


def direct_map(lum, faces, sun, reach):
    """The map shift by shift in float32, as lean_map summed it before the
    FFT: the mean of ev · (seen − mean) / std over the samples inside."""
    picked = shading_samples(lum.shape, faces, sun)
    if picked is None:
        return None
    rows, cols, ev = picked
    h, w = lum.shape
    shifts = np.arange(-reach, reach + 1, MAP_STEP)
    out = np.full((len(shifts), len(shifts)), np.nan, np.float32)
    for i, dy in enumerate(shifts):
        for j, dx in enumerate(shifts):
            r, c = rows + dy, cols + dx
            ok = (r >= 0) & (r < h) & (c >= 0) & (c < w)
            if ok.sum() < LEAN_MIN_TEXELS:
                continue
            seen = lum[r[ok], c[ok]]
            if seen.std() > 0:
                out[i, j] = np.mean(ev[ok] * (seen - seen.mean()) / seen.std())
    return out


def test_the_maps_correlation_by_fft_is_the_direct_sum():
    rng = np.random.default_rng(7)
    for _ in range(40):
        h, w = rng.integers(40, 140, 2)
        reach = int(rng.integers(2, 12)) * 2
        lum = rng.uniform(0, 255, (h, w)).astype(np.float32)
        # a uniform patch: the shifts that read only it show nothing
        lum[: h // 3, : w // 3] = 120.0
        faces = []
        for _ in range(int(rng.integers(1, 4))):
            x0, y0 = rng.uniform(-10, w - 10), rng.uniform(-10, h - 10)
            sx, sy = rng.uniform(15, 50, 2)
            ring = [(x0, y0), (x0 + sx, y0), (x0 + sx, y0 + sy), (x0, y0 + sy)]
            normal = rng.normal(size=3)
            faces.append((ring, tuple(normal / np.linalg.norm(normal))))
        a, b = lean_map(lum, faces, SUN, reach), direct_map(lum, faces, SUN, reach)
        assert (a is None) == (b is None)
        if a is None:
            continue
        assert np.array_equal(np.isnan(a), np.isnan(b))
        assert np.nanmax(np.abs(a - b), initial=0.0) < 1e-5


def test_the_lean_is_the_one_every_building_near_agrees_on():
    # buildings of different heights, each shifted 0.1 m north per metre
    samples = []
    for i, height in enumerate((10, 15, 20, 25, 30, 35)):
        shift = round(0.1 * height / 0.2)  # texels north = rows up
        shift -= shift % 2
        lum, faces = gable(dy=-shift, size=120)
        reach = 16
        grid = lean_map(lum, faces, SUN, reach=reach)
        samples.append(Sample(100.0 + 10 * i, 100.0, height, grid, reach, 0.2))
    nodes = fit_leans(samples, (0, 0, 250, 250))
    assert nodes
    kx, ky = building_lean(nodes, 120, 100, samples[2])
    assert abs(kx) < 0.02 and abs(ky - 0.1) < 0.02
    assert building_lean([], 0, 0, None) == (0.0, 0.0)
