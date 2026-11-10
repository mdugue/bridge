"""Whether a street photo shows a wall as glass: a curtain wall of panes and
mullions rather than a solid wall with windows cut into it.

Nothing the facade profiles measure tells the two apart (facade_traits.py):
the openings' share reads a stucco house at 0.99 and the Frauenkirche at
0.94, and the edge grid, the plaster's share and its colour overlap too
(Dresden's Altstadt, Prager Straße and Wiener Platz, 2026-11-10). An open
image model does: CLIP (OpenAI's ViT-B/32, MIT licence, as ONNX) set the
rectified upper wall against two descriptions, "a glass facade" and "a
wall with windows" (`PROMPTS`), and gave every known glass front of the
probe 0.91–1.00 (the Prager Spitze, the Glaskugelhaus, the Gläserne
Manufaktur, the Ammonhof, the Congress Center), and no plastered or stone
wall above 0.9 but one clad in white panels (docs/transformations.md,
*Glass facades from street photos*).

Mapillary never segmented its older uploads (none before 2021 on the
Congress Center's tile) and misses the building on many newer ones. Such a
photo is read on the wall the geometry puts in it, less what its
segmentation found in front, and only where a third description, "other"
(sky, trees, a street), is the less likely: a crop of sky above a
cantilevered roof reads 0.92 glass against the two walls alone.

The model is a fetch's download, like the photos: `<raw>/../models/`,
checked by its SHA-256, never committed and never in the viewer. Text
embeddings are computed once a process from `PROMPTS`. `glass_of` gives
one image's probability that the wall it sees is glass; windows.py decides
per wall from all the images that saw it."""

from __future__ import annotations

import hashlib
import os
from functools import cache
from pathlib import Path

import numpy as np
from PIL import Image

from .net import download

# Xenova's ONNX export of openai/clip-vit-base-patch32, pinned to a commit
REPO = "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/6b7c523703ae26e39be4b03774966f8571c7f523"
FILES = {
    "vision_model.onnx": "fd6e1402a588279d1723c7534d4bcba5bc0b14b47dfab0e46f8c47b8270d7d40",
    "text_model.onnx": "3f6571f5bad13a97c469c1622e1cfc4d9aef78b79fdbfcff804ca357bfada8cc",
    "tokenizer.json": "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd",
}
MODEL_DIR = "clip-vit-base-patch32"
SOURCE = {
    "vision_model.onnx": "onnx/vision_model.onnx",
    "text_model.onnx": "onnx/text_model.onnx",
    "tokenizer.json": "tokenizer.json",
}
PROMPTS = {
    "glass": (
        "a glass curtain wall facade",
        "a modern office building with an all-glass facade",
        "a facade made of glass panels and metal mullions",
    ),
    "wall": (
        "a plastered house facade with windows",
        "a stone facade with windows",
        "a brick wall with windows",
        "a building facade with rows of windows in a solid wall",
    ),
    # what an unsegmented photo's crop may show instead of a wall (`OTHER_MAX`)
    "other": (
        "the sky",
        "trees and bushes",
        "a street with cars",
        "a blurry photo of a road",
    ),
}
# the classes' rows in the embeddings, in this order (`Model.glass`)
CLASSES = ("glass", "wall", "other")
LOGIT_SCALE = 100.0  # CLIP's learned temperature
MEAN = np.array([0.48145466, 0.4578275, 0.40821073])
STD = np.array([0.26862954, 0.26130258, 0.27577711])
SIZE = 224
PAD_ID = 49407  # CLIP's end-of-text token, its padding too
MIN_PX = 1200  # an upper wall seen by fewer pixels (20 a metre) is not read
MIN_COVER = 0.25  # nor one a photo sees less of (its share of the upper wall)
OTHER_MAX = 0.5  # an unsegmented crop more likely sky, trees or street is not read
# bump when the rectification or the crop changes what is read
# (2: a photo turned back into its pose's frame, facades.raw_frame)
READ_VERSION = 2


def _prompts() -> tuple:
    return tuple((c, PROMPTS[c]) for c in CLASSES)


def reading_key() -> str:
    """What a cached reading depends on, hashed: the prompts in their order,
    the model, the crop's limits and the rectification's (facade_measure,
    the camera's height among them).
    It names the cache (facades.glass_path), so a change reads every photo
    again instead of mixing old readings with new."""
    from .facade_measure import EYE_M, GROUND_M, MAX_RES_M, PX

    what = (
        READ_VERSION,
        _prompts(),
        REPO,
        (MIN_PX, MIN_COVER, OTHER_MAX, SIZE, LOGIT_SCALE, MEAN.tolist(), STD.tolist()),
        (PX, GROUND_M, MAX_RES_M, EYE_M),
    )
    return hashlib.sha256(repr(what).encode()).hexdigest()[:10]


def model_dir(raw: Path) -> Path:
    """Where the model lives: beside the providers' raw folders, shared."""
    return raw.parent / "models" / MODEL_DIR


def _sha256(path: Path) -> str:
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


@cache
def fetch_model(raw: Path) -> Path:
    """The model's files, downloaded once and checked by their SHA-256 (once
    a process: hashing the encoders takes seconds, and a fetch runs tile
    after tile)."""
    root = model_dir(raw)
    for name, sha in FILES.items():
        path = root / name
        for _ in range(2):  # a file of an older pin is fetched again
            download(f"{REPO}/{SOURCE[name]}", path)
            if _sha256(path) == sha:
                break
            path.unlink()
        else:
            raise OSError(f"{name}: SHA-256 differs from the pinned model")
    return root


def write_classes(root: Path) -> Path:
    """The prompts' embeddings (`PROMPTS`, one row a class), computed with the
    text encoder and saved beside the model, so a worker loads the vision
    encoder alone. Named by the prompts, their order and the model, so a
    change computes them again; written whole or not at all."""
    key = hashlib.sha256(repr((_prompts(), REPO)).encode()).hexdigest()[:12]
    path = root / f"classes-{key}.npy"
    if not path.exists():
        import onnxruntime as ort
        from tokenizers import Tokenizer

        text = ort.InferenceSession(str(root / "text_model.onnx"))
        tok = Tokenizer.from_file(str(root / "tokenizer.json"))
        classes = np.stack([_text_embedding(text, tok, ps) for _, ps in _prompts()])
        part = path.with_suffix(f".{os.getpid()}.npy")
        np.save(part, classes.astype(np.float32))
        part.replace(path)
    return path


class Model:
    """The vision encoder and the prompts' embeddings (`write_classes`)."""

    def __init__(self, root: Path, classes: Path):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 1  # one process a worker
        self.vision = ort.InferenceSession(str(root / "vision_model.onnx"), opts)
        self.classes = np.load(classes)

    def embed(self, rgb: np.ndarray) -> np.ndarray:
        """One uint8 image's unit embedding."""
        e = self.vision.run(None, {"pixel_values": _pixels(rgb)})[0][0]
        return e / np.linalg.norm(e)

    def glass(self, rgb: np.ndarray) -> tuple[float, float]:
        """The probability that `rgb` shows a glass facade rather than a
        wall, and that it shows neither (`PROMPTS`' "other")."""
        logits = LOGIT_SCALE * self.classes @ self.embed(rgb)
        p = np.exp(logits - logits.max())
        return float(p[0] / (p[0] + p[1])), float(p[2] / p.sum())


def _text_embedding(session, tok, prompts: tuple[str, ...]) -> np.ndarray:
    ids = [tok.encode(p).ids for p in prompts]
    n = max(map(len, ids))
    arr = np.array([i + [PAD_ID] * (n - len(i)) for i in ids], np.int64)
    e = session.run(None, {"input_ids": arr})[0]
    e = e / np.linalg.norm(e, axis=1, keepdims=True)
    m = e.mean(0)
    return m / np.linalg.norm(m)


def _pixels(rgb: np.ndarray) -> np.ndarray:
    """CLIP's input: the image padded to a square with the mean colour (a
    long wall keeps its ends, a centre crop would cut them), resized."""
    h, w = rgb.shape[:2]
    s = max(h, w)
    pad = np.empty((s, s, 3), np.uint8)
    pad[:] = np.round(MEAN * 255).astype(np.uint8)
    pad[(s - h) // 2 : (s - h) // 2 + h, (s - w) // 2 : (s - w) // 2 + w] = rgb
    im = np.asarray(Image.fromarray(pad).resize((SIZE, SIZE), Image.BICUBIC), float) / 255
    return ((im - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)


def upper_crop(rgb: np.ndarray, upper: np.ndarray) -> np.ndarray | None:
    """The seen upper wall as uint8, its unseen pixels the mean colour, cut
    to the box it fills; None where it is too little."""
    if upper.sum() < MIN_PX:
        return None
    ys, xs = np.where(upper)
    box = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    crop = (np.clip(rgb[box], 0, 1) * 255).astype(np.uint8)
    crop[~upper[box]] = np.round(MEAN * 255).astype(np.uint8)
    return crop


@cache
def model(root: str, classes: str) -> Model:
    """The worker's model, loaded on first use."""
    return Model(Path(root), Path(classes))


def glass_of(
    rgb: np.ndarray, upper: np.ndarray, root: str, classes: str, segmented: bool = True
) -> int | None:
    """One image's reading of a wall: the glass probability, ‰, or None. A
    crop no segmentation cut to the building is read only where the model
    takes it for a facade at all (`OTHER_MAX`)."""
    crop = upper_crop(rgb, upper)
    if crop is None:
        return None
    glass, other = model(root, classes).glass(crop)
    if not segmented and other > OTHER_MAX:
        return None
    return round(1000 * glass)


def unsegmented(cls: np.ndarray) -> bool:
    """Whether Mapillary's segmentation drew no building in the photo: an
    older upload never segmented, or a newer one it missed."""
    return not (cls == 1).any()


def measure(wall: dict, img, cls, rot, cam: tuple, camera: dict | None, model_files: tuple) -> dict:
    """One photo's reading of one wall (facades.measure_image's measurer):
    the share of the upper wall it sees (`cov`), the median metres a pixel
    there (`res`) and the glass probability (`gl`, ‰) where it sees enough;
    `seg` 0 where the photo had no segmentation of the building."""
    from .facade_measure import GROUND_M, PX, rectify, valid_mask

    bare = unsegmented(cls)
    # unsegmented, the wall is wherever the geometry puts it, less what the
    # segmentation did find in front of it
    seg = np.where(cls == 0, 1, cls).astype(cls.dtype) if bare else cls
    rgb, res, lat, klass = rectify(wall, img, seg, rot, cam, camera)
    valid = valid_mask(res, lat, klass)
    upper = valid.copy()
    upper[: int(0.3 * PX)] = False
    upper[int((wall["eave"] - GROUND_M) * PX) :] = False
    rows = max(1, int((wall["eave"] - GROUND_M - 0.3) * PX))
    out: dict = {"cov": round(float(upper.sum() / max(1, rgb.shape[1] * rows)), 3)}
    if upper.any():
        out["res"] = round(float(np.median(res[upper])), 3)
    if out["cov"] >= MIN_COVER and (g := glass_of(rgb, upper, *model_files, not bare)) is not None:
        out["gl"] = g
    if bare:
        out["seg"] = 0
    return out
