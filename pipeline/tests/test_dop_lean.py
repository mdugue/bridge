import numpy as np
from PIL import Image, ImageDraw

from bake.dop_lean import MAP_STEP, Sample, building_lean, fit_leans, lean_map
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
