"""rasterio.windows as the bakes call it (rasterio 1.5.2).

`Window` is an attrs class of the old style (`@attr.s`, fields as
`col_off = attr.ib()` without annotations), whose constructor pyright cannot
see: it reads `Window(c0, r0, w, h)` as taking no arguments. Here it is what
attrs builds: the four fields as the constructor's parameters, in order,
frozen. The fields are floats (the class's docstring); `round_offsets` and
`round_lengths` make them whole; `from_slices` reads a pair of slices (or
2-sequences of start and stop). `from_bounds` and `transform` are typed from
`windows.py`: a Window (its `height`, `width` and `precision` unused and
deprecated there), and the window's `Affine`.

This file replaces `windows.py` for the checker, so it holds only what the
bakes use: a bake that imports another name from `rasterio.windows` gets
"unknown import symbol" until that name is added here, typed from
`windows.py`. rasterio's own modules that import more from it (`io.py`'s
`WindowMethodsMixin`, `features.py`'s `union`) read those names as unknown,
which changes no finding: the checker reports on `bake/` alone.

Check against the source on a bump of rasterio (plan 089, maintenance notes).
"""

from affine import Affine
from rasterio.errors import WindowError

class Window:
    @property
    def col_off(self) -> float: ...
    @property
    def row_off(self) -> float: ...
    @property
    def width(self) -> float: ...
    @property
    def height(self) -> float: ...
    def __init__(self, col_off: float, row_off: float, width: float, height: float) -> None: ...
    @classmethod
    def from_slices(
        cls,
        rows: slice | tuple[int | None, int | None] | list[int | None],
        cols: slice | tuple[int | None, int | None] | list[int | None],
        height: float = -1,
        width: float = -1,
        boundless: bool = False,
    ) -> Window: ...
    def flatten(self) -> tuple[float, float, float, float]: ...
    def toranges(self) -> tuple[tuple[float, float], tuple[float, float]]: ...
    def toslices(self) -> tuple[slice, slice]: ...
    def round_lengths(self, **kwds: object) -> Window: ...
    def round_offsets(self, **kwds: object) -> Window: ...

def from_bounds(
    left: float,
    bottom: float,
    right: float,
    top: float,
    transform: Affine | None = None,
    height: int | None = None,
    width: int | None = None,
    precision: int | None = None,
) -> Window: ...
def transform(window: Window, transform: Affine) -> Affine: ...

# The module's public names: in a stub, an imported name is public only when
# it is named here.
__all__ = [
    "from_bounds",
    "transform",
    "Window",
    "WindowError",
]
