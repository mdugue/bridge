"""scipy.ndimage as the bakes call it.

scipy ships no types for ndimage, so pyright infers them from its source, and
for the functions below it infers wrong: it reads `label`'s return off every
branch of its body, the scalar ones included (`Literal[0]`, `Literal[1]`),
`distance_transform_edt`'s as `tuple | None` whatever the flags, and the
binary morphology's as float arrays. Their signatures here are scipy 1.18.1's
(`scipy/ndimage/_measurements.py`, `_morphology.py`), their returns what
that source returns for the arguments the bakes pass. Every other public name
is scipy's own, re-exported from the modules its `__init__.py` reads
(`_ndimage_api.py`), its type inferred as before — `binary_opening` too, for
now: typed like its siblings it re-words a finding in `facade_measure.py`
(`Any | NDArray[bool_] | None` becomes `NDArray[bool_] | None`), which the
gate reads as a new key, so it waits for phase 4 and that finding's fix.

Check against the source on a bump of scipy (plan 089, maintenance notes).
"""

from collections.abc import Sequence
from typing import Literal, overload

import numpy as np
from numpy.typing import ArrayLike, NDArray
from scipy.ndimage import filters, fourier, interpolation, measurements, morphology
from scipy.ndimage._filters import (
    convolve,
    convolve1d,
    correlate,
    correlate1d,
    gaussian_filter,
    gaussian_filter1d,
    gaussian_gradient_magnitude,
    gaussian_laplace,
    generic_filter,
    generic_filter1d,
    generic_gradient_magnitude,
    generic_laplace,
    laplace,
    maximum_filter,
    maximum_filter1d,
    median_filter,
    minimum_filter,
    minimum_filter1d,
    percentile_filter,
    prewitt,
    rank_filter,
    sobel,
    uniform_filter,
    uniform_filter1d,
    vectorized_filter,
)
from scipy.ndimage._fourier import (
    fourier_ellipsoid,
    fourier_gaussian,
    fourier_shift,
    fourier_uniform,
)
from scipy.ndimage._interpolation import (
    affine_transform,
    geometric_transform,
    map_coordinates,
    rotate,
    shift,
    spline_filter,
    spline_filter1d,
    zoom,
)

# Re-exported by name, not by `*`: `_measurements` and `_morphology` less the
# names this stub defines below, which it would otherwise declare twice.
from scipy.ndimage._measurements import (
    center_of_mass,
    extrema,
    find_objects,
    histogram,
    labeled_comprehension,
    maximum,
    maximum_position,
    mean,
    median,
    minimum,
    minimum_position,
    standard_deviation,
    sum,
    sum_labels,
    value_indices,
    variance,
    watershed_ift,
)
from scipy.ndimage._morphology import (
    binary_hit_or_miss,
    binary_opening,
    black_tophat,
    distance_transform_bf,
    distance_transform_cdt,
    generate_binary_structure,
    grey_closing,
    grey_dilation,
    grey_erosion,
    grey_opening,
    iterate_structure,
    morphological_gradient,
    morphological_laplace,
    white_tophat,
)

# `_measurements.py`: the labels are int32, or intp once the input has 2**31 - 2
# cells or more; with `output` an array, only the count is returned; with
# `output` a dtype, the labels are of that dtype.
@overload
def label(
    input: ArrayLike, structure: ArrayLike | None = None, output: None = None
) -> tuple[NDArray[np.int32] | NDArray[np.intp], int]: ...
@overload
def label(input: ArrayLike, structure: ArrayLike | None, output: NDArray[np.integer]) -> int: ...
@overload
def label(
    input: ArrayLike, *, structure: ArrayLike | None = None, output: NDArray[np.integer]
) -> int: ...
@overload
def label(
    input: ArrayLike,
    structure: ArrayLike | None = None,
    *,
    output: type[np.integer] | np.dtype[np.integer] | str,
) -> tuple[NDArray[np.integer], int]: ...

# `_morphology.py`: the distances are float64, the indices int32 of shape
# (input.ndim, *input.shape); the in-place forms (`distances=`, `indices=`)
# are not typed here: the bakes do not use them.
@overload
def distance_transform_edt(
    input: ArrayLike,
    sampling: float | ArrayLike | None = None,
    return_distances: Literal[True] = True,
    return_indices: Literal[False] = False,
    distances: None = None,
    indices: None = None,
) -> NDArray[np.float64]: ...
@overload
def distance_transform_edt(
    input: ArrayLike,
    sampling: float | ArrayLike | None = None,
    return_distances: Literal[True] = True,
    *,
    return_indices: Literal[True],
    distances: None = None,
    indices: None = None,
) -> tuple[NDArray[np.float64], NDArray[np.int32]]: ...
@overload
def distance_transform_edt(
    input: ArrayLike,
    sampling: float | ArrayLike | None = None,
    *,
    return_distances: Literal[False],
    return_indices: Literal[True],
    distances: None = None,
    indices: None = None,
) -> NDArray[np.int32]: ...

# `_morphology.py`: a mask of bools, or the `output` array given, filled
# (`_binary_erosion`; dilation, closing and propagation end in it). An
# `output` array is typed as a keyword only: no bake passes one.
@overload
def binary_erosion(
    input: ArrayLike,
    structure: ArrayLike | None = None,
    iterations: int = 1,
    mask: ArrayLike | None = None,
    output: None = None,
    border_value: int = 0,
    origin: int | Sequence[int] = 0,
    brute_force: bool = False,
    *,
    axes: tuple[int, ...] | None = None,
) -> NDArray[np.bool_]: ...
@overload
def binary_erosion[Out: np.generic](
    input: ArrayLike,
    structure: ArrayLike | None = None,
    iterations: int = 1,
    mask: ArrayLike | None = None,
    *,
    output: NDArray[Out],
    border_value: int = 0,
    origin: int | Sequence[int] = 0,
    brute_force: bool = False,
    axes: tuple[int, ...] | None = None,
) -> NDArray[Out]: ...
@overload
def binary_dilation(
    input: ArrayLike,
    structure: ArrayLike | None = None,
    iterations: int = 1,
    mask: ArrayLike | None = None,
    output: None = None,
    border_value: int = 0,
    origin: int | Sequence[int] = 0,
    brute_force: bool = False,
    *,
    axes: tuple[int, ...] | None = None,
) -> NDArray[np.bool_]: ...
@overload
def binary_dilation[Out: np.generic](
    input: ArrayLike,
    structure: ArrayLike | None = None,
    iterations: int = 1,
    mask: ArrayLike | None = None,
    *,
    output: NDArray[Out],
    border_value: int = 0,
    origin: int | Sequence[int] = 0,
    brute_force: bool = False,
    axes: tuple[int, ...] | None = None,
) -> NDArray[Out]: ...
@overload
def binary_closing(
    input: ArrayLike,
    structure: ArrayLike | None = None,
    iterations: int = 1,
    output: None = None,
    origin: int | Sequence[int] = 0,
    mask: ArrayLike | None = None,
    border_value: int = 0,
    brute_force: bool = False,
    *,
    axes: tuple[int, ...] | None = None,
) -> NDArray[np.bool_]: ...
@overload
def binary_closing[Out: np.generic](
    input: ArrayLike,
    structure: ArrayLike | None = None,
    iterations: int = 1,
    *,
    output: NDArray[Out],
    origin: int | Sequence[int] = 0,
    mask: ArrayLike | None = None,
    border_value: int = 0,
    brute_force: bool = False,
    axes: tuple[int, ...] | None = None,
) -> NDArray[Out]: ...
@overload
def binary_propagation(
    input: ArrayLike,
    structure: ArrayLike | None = None,
    mask: ArrayLike | None = None,
    output: None = None,
    border_value: int = 0,
    origin: int | Sequence[int] = 0,
    *,
    axes: tuple[int, ...] | None = None,
) -> NDArray[np.bool_]: ...
@overload
def binary_propagation[Out: np.generic](
    input: ArrayLike,
    structure: ArrayLike | None = None,
    mask: ArrayLike | None = None,
    *,
    output: NDArray[Out],
    border_value: int = 0,
    origin: int | Sequence[int] = 0,
    axes: tuple[int, ...] | None = None,
) -> NDArray[Out]: ...

# With `output` an array, `binary_fill_holes` fills it and returns None.
@overload
def binary_fill_holes(
    input: ArrayLike,
    structure: ArrayLike | None = None,
    output: None = None,
    origin: int | Sequence[int] = 0,
    *,
    axes: tuple[int, ...] | None = None,
) -> NDArray[np.bool_]: ...
@overload
def binary_fill_holes(
    input: ArrayLike,
    structure: ArrayLike | None = None,
    *,
    output: NDArray[np.generic],
    origin: int | Sequence[int] = 0,
    axes: tuple[int, ...] | None = None,
) -> None: ...

# The module's public names: in a stub, an imported name is public only when
# it is named here.
__all__ = [
    "filters",
    "fourier",
    "interpolation",
    "measurements",
    "morphology",
    "affine_transform",
    "binary_closing",
    "binary_dilation",
    "binary_erosion",
    "binary_fill_holes",
    "binary_hit_or_miss",
    "binary_opening",
    "binary_propagation",
    "black_tophat",
    "center_of_mass",
    "convolve",
    "convolve1d",
    "correlate",
    "correlate1d",
    "distance_transform_bf",
    "distance_transform_cdt",
    "distance_transform_edt",
    "extrema",
    "find_objects",
    "fourier_ellipsoid",
    "fourier_gaussian",
    "fourier_shift",
    "fourier_uniform",
    "gaussian_filter",
    "gaussian_filter1d",
    "gaussian_gradient_magnitude",
    "gaussian_laplace",
    "generate_binary_structure",
    "generic_filter",
    "generic_filter1d",
    "generic_gradient_magnitude",
    "generic_laplace",
    "geometric_transform",
    "grey_closing",
    "grey_dilation",
    "grey_erosion",
    "grey_opening",
    "histogram",
    "iterate_structure",
    "label",
    "labeled_comprehension",
    "laplace",
    "map_coordinates",
    "maximum",
    "maximum_filter",
    "maximum_filter1d",
    "maximum_position",
    "mean",
    "median",
    "median_filter",
    "minimum",
    "minimum_filter",
    "minimum_filter1d",
    "minimum_position",
    "morphological_gradient",
    "morphological_laplace",
    "percentile_filter",
    "prewitt",
    "rank_filter",
    "rotate",
    "shift",
    "sobel",
    "spline_filter",
    "spline_filter1d",
    "standard_deviation",
    "sum",
    "sum_labels",
    "uniform_filter",
    "uniform_filter1d",
    "value_indices",
    "variance",
    "vectorized_filter",
    "watershed_ift",
    "white_tophat",
    "zoom",
]
