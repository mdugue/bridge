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
from scipy.ndimage import (
    filters as filters,
)
from scipy.ndimage import (
    fourier as fourier,
)
from scipy.ndimage import (
    interpolation as interpolation,
)
from scipy.ndimage import (
    measurements as measurements,
)
from scipy.ndimage import (
    morphology as morphology,
)
from scipy.ndimage._filters import *  # noqa: F403
from scipy.ndimage._fourier import *  # noqa: F403
from scipy.ndimage._interpolation import *  # noqa: F403

# Re-exported by name, not by `*`: `_measurements` and `_morphology` less the
# names this stub defines below, which it would otherwise declare twice.
from scipy.ndimage._measurements import (
    center_of_mass as center_of_mass,
)
from scipy.ndimage._measurements import (
    extrema as extrema,
)
from scipy.ndimage._measurements import (
    find_objects as find_objects,
)
from scipy.ndimage._measurements import (
    histogram as histogram,
)
from scipy.ndimage._measurements import (
    labeled_comprehension as labeled_comprehension,
)
from scipy.ndimage._measurements import (
    maximum as maximum,
)
from scipy.ndimage._measurements import (
    maximum_position as maximum_position,
)
from scipy.ndimage._measurements import (
    mean as mean,
)
from scipy.ndimage._measurements import (
    median as median,
)
from scipy.ndimage._measurements import (
    minimum as minimum,
)
from scipy.ndimage._measurements import (
    minimum_position as minimum_position,
)
from scipy.ndimage._measurements import (
    standard_deviation as standard_deviation,
)
from scipy.ndimage._measurements import (
    sum as sum,
)
from scipy.ndimage._measurements import (
    sum_labels as sum_labels,
)
from scipy.ndimage._measurements import (
    value_indices as value_indices,
)
from scipy.ndimage._measurements import (
    variance as variance,
)
from scipy.ndimage._measurements import (
    watershed_ift as watershed_ift,
)
from scipy.ndimage._morphology import (
    binary_hit_or_miss as binary_hit_or_miss,
)
from scipy.ndimage._morphology import (
    binary_opening as binary_opening,
)
from scipy.ndimage._morphology import (
    black_tophat as black_tophat,
)
from scipy.ndimage._morphology import (
    distance_transform_bf as distance_transform_bf,
)
from scipy.ndimage._morphology import (
    distance_transform_cdt as distance_transform_cdt,
)
from scipy.ndimage._morphology import (
    generate_binary_structure as generate_binary_structure,
)
from scipy.ndimage._morphology import (
    grey_closing as grey_closing,
)
from scipy.ndimage._morphology import (
    grey_dilation as grey_dilation,
)
from scipy.ndimage._morphology import (
    grey_erosion as grey_erosion,
)
from scipy.ndimage._morphology import (
    grey_opening as grey_opening,
)
from scipy.ndimage._morphology import (
    iterate_structure as iterate_structure,
)
from scipy.ndimage._morphology import (
    morphological_gradient as morphological_gradient,
)
from scipy.ndimage._morphology import (
    morphological_laplace as morphological_laplace,
)
from scipy.ndimage._morphology import (
    white_tophat as white_tophat,
)

# `_measurements.py`: the labels are int32, or intp once the input has 2**31 - 2
# cells or more; with `output` an array, only the count is returned; with
# `output` a dtype, the labels are of that dtype.
def label(
    input: ArrayLike, structure: ArrayLike | None = None, output: None = None
) -> tuple[NDArray[np.int32] | NDArray[np.intp], int]: ...

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
