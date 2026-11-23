"""The murals' rule (bake/murals.py): what a tag says, which photo shows a
mural straight on, where on its LoD2 wall it hangs and how high. The fetch
itself (Wikidata, Commons) is not run here: its caches are plain JSON the
same functions read."""

import math

import pytest
import shapely

from bake import murals
from tests.synthetic import X0, Y0, blocks_city


def photo(title: str, w: int, h: int, mime: str = "image/jpeg") -> murals.Photo:
    return murals.Photo(
        title=title,
        w=w,
        h=h,
        mime=mime,
        author="A",
        licence="CC BY-SA 4.0",
        url="https://commons.wikimedia.org/wiki/" + title,
        original="https://upload.wikimedia.org/wikipedia/commons/a/ab/" + title[5:],
    )


def test_tags_and_lengths():
    tags = murals.parse_tags('"tourism"=>"artwork","artwork_type"=>"mural","height"=>"9,5 m"')
    assert tags == {"tourism": "artwork", "artwork_type": "mural", "height": "9,5 m"}
    assert murals.metres(tags["height"]) == 9.5
    assert murals.metres("950 cm") == 9.5
    assert murals.metres("30 ft") is None
    assert murals.metres("0.1") is None


def test_commons_titles_from_every_form_a_tag_takes():
    assert murals.commons_titles("File:Dresden-Fuerstenzug3.jpg") == [
        "File:Dresden-Fuerstenzug3.jpg"
    ]
    assert murals.commons_titles(
        "https://commons.wikimedia.org/wiki/File:Poststra%C3%9Fe_45_W.jpg"
    ) == ["File:Poststraße 45 W.jpg"]
    assert murals.commons_titles(
        "https://de.wikipedia.org/wiki/Turmstation#/media/Datei:2017-Turm.jpg"
    ) == ["File:2017-Turm.jpg"]
    assert murals.commons_titles(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Name.jpg/250px-Name.jpg"
    ) == ["File:Name.jpg"]
    # a category, another site, two files
    assert murals.commons_titles("Category:Trinkwasserspeicher Bühlau") == []
    assert murals.commons_titles("https://photos.app.goo.gl/xyz") == []
    assert murals.commons_titles("File:a.jpg;File:b.jpg") == ["File:A.jpg", "File:B.jpg"]


def test_thumbnail_at_a_standard_width():
    p = photo("File:Weg.jpg", 1351, 451)
    assert p.thumb.endswith("/commons/thumb/a/ab/Weg.jpg/1280px-Weg.jpg")
    assert photo("File:Wide.jpg", 19764, 1221).thumb.endswith("/3840px-Wide.jpg")
    assert murals.thumb_url(
        "https://upload.wikimedia.org/wikipedia/commons/a/ab/Scan.tif", 960
    ).endswith("/960px-Scan.tif.jpg")


def test_item_facts_in_metres():
    entity = {
        "claims": {
            "P18": [{"mainsnak": {"datavalue": {"value": "Weg.jpg"}}}],
            "P2048": [
                {
                    "mainsnak": {
                        "datavalue": {
                            "value": {
                                "amount": "+1050",
                                "unit": "http://www.wikidata.org/entity/Q174728",
                            }
                        }
                    }
                }
            ],
            "P2049": [
                {
                    "mainsnak": {
                        "datavalue": {
                            "value": {
                                "amount": "+30",
                                "unit": "http://www.wikidata.org/entity/Q11573",
                            }
                        }
                    }
                }
            ],
        }
    }
    assert murals.item_facts(entity) == {"images": ["File:Weg.jpg"], "height": 10.5, "width": 30.0}


def candidate(geom, **tags) -> murals.Candidate:
    return murals.Candidate("n1", "Bild", "mural", geom, {"tourism": "artwork", **tags})


def test_size_from_osm_a_line_and_the_item():
    point = candidate(shapely.Point(0, 0), width="11", height="23")
    assert murals.size_of(point, None) == (11.0, 23.0)
    line = candidate(shapely.LineString([(0, 0), (100, 0)]), width="5", height="9.5")
    # a line's length is what is measured on the wall
    assert murals.size_of(line, {"height": 10.5}) == (100.0, 9.5)
    assert murals.size_of(candidate(shapely.Point(0, 0)), {"width": 30.0, "height": 10.5}) == (
        30.0,
        10.5,
    )
    # the person a mural shows is not the mural
    assert candidate(shapely.Point(0, 0), **{"subject:wikidata": "Q1"}).item is None


def test_a_frontal_photo_of_the_whole_mural_fits():
    straight = photo("File:Straight.jpg", 1351, 451)
    slanted = photo("File:Slanted.jpg", 4298, 2241)
    pick = murals.choose(30.0, 10.5, False, [slanted, straight])
    assert pick == (straight, 30.0, 10.5, "whole")
    # of two that fit, the larger
    bigger = photo("File:Bigger.jpg", 2702, 902)
    assert murals.choose(30.0, 10.5, False, [straight, bigger])[0] == bigger
    # a drawing or an animation is no photo
    drawing = photo("File:S.svg", 300, 100, "image/svg+xml")
    assert murals.choose(30.0, 10.5, False, [drawing]) is None
    # nor is one too coarse to paint a wall with
    assert murals.choose(30.0, 10.5, False, [photo("File:Small.jpg", 400, 134)]) is None


def test_aspects_fit_within_fit_either_way():
    assert murals.fits(3.0, 3.0 * 1.149)
    assert murals.fits(3.0 * 1.149, 3.0)
    assert not murals.fits(3.0, 3.0 * 1.16)


def test_a_line_takes_a_band_of_its_whole_length():
    strip = photo("File:Strip.jpg", 19764, 1221)
    pick = murals.choose(102.0, 9.5, True, [strip])
    assert pick is not None and pick[3] == "band"
    assert pick[2] == pytest.approx(102.0 / (19764 / 1221))
    # a point's width is not measured on the wall: no band
    assert murals.choose(102.0, 9.5, False, [strip]) is None
    # a band less than half the height is a detail, not the mural
    assert murals.choose(102.0, 20.0, True, [strip]) is None


def city_box(height: float = 17.7):
    """One building 100 m along x and 10 m deep, its foot at 100 m."""
    return murals.Buildings(blocks_city({"a": (0, 0, 100, 10, height)}))


def test_a_line_follows_its_wall_and_ends_at_the_corners():
    b = city_box()
    # mapped a little past both ends, on the north side, west to east
    line = shapely.LineString([(X0 - 0.4, Y0 + 10.6), (X0 + 100.4, Y0 + 10.5)])
    placed = murals.place_line(line, b)
    assert placed is not None
    path = murals.clean(placed[0])
    # the north wall's outside on the right: it runs east to west
    assert path[0] == pytest.approx((X0 + 100, Y0 + 10))
    assert path[-1] == pytest.approx((X0, Y0 + 10))
    # far from any wall: none
    assert murals.place_line(shapely.LineString([(X0, Y0 + 30), (X0 + 50, Y0 + 30)]), b) is None


def test_a_point_centres_its_width_on_its_wall():
    b = city_box()
    placed = murals.place_point(shapely.Point(X0 + 50, Y0 - 1), 20.0, b)
    assert placed is not None
    path = placed[0]
    # the south wall, its outside on the right: west to east
    assert path[0] == pytest.approx((X0 + 40, Y0))
    assert path[-1] == pytest.approx((X0 + 60, Y0))
    # near a corner it is kept on the wall
    near_end = murals.place_point(shapely.Point(X0 + 95, Y0 - 1), 20.0, b)[0]
    assert near_end[-1] == pytest.approx((X0 + 100, Y0))
    # wider than its wall: none
    assert murals.place_point(shapely.Point(X0 + 100.5, Y0 + 5), 30.0, b) is None


def test_a_straight_stretch_runs_over_split_edges():
    ring = shapely.Polygon([(0, 0), (40, 0), (100, 0.5), (100, 10), (0, 10)]).exterior
    begin, end = murals.straight_stretch(ring, 20.0)
    assert begin == pytest.approx(0.0)
    assert end == pytest.approx(40 + math.hypot(60, 0.5))


class Flat:
    def sample(self, points):
        return [[100.0] for _ in points]


def test_placed_with_its_ground_top_and_building():
    b = city_box()
    c = candidate(shapely.Point(X0 + 50, Y0 - 1))
    placed = murals.place(c, 20.0, b, Flat())
    assert placed is not None
    assert placed.of == "a-root"
    assert placed.ground == 100.0
    assert placed.top == pytest.approx(117.7)


def test_a_storey_up_where_the_wall_has_room():
    placed = murals.Placed([(0, 0), (10, 0)], "a", 100.0, 117.7)
    assert murals.heights_on(placed, 6.3, None) == pytest.approx((103.0, 109.3))
    # less room above: lower
    assert murals.heights_on(placed, 16.0, None) == pytest.approx((101.7, 117.7))
    # as high as the wall: on the ground; much taller: a mapping error
    assert murals.heights_on(placed, 18.0, None) == pytest.approx((100.0, 118.0))
    assert murals.heights_on(placed, 19.0, None) is None
    # where OSM says, whatever the wall
    assert murals.heights_on(placed, 6.3, 5.0) == pytest.approx((105.0, 111.3))


def test_offset_to_the_outside():
    assert murals.offset_path([(0, 0), (10, 0)], 0.03) == [(0.0, -0.03), (10.0, -0.03)]
