"""Turn an uploaded image into lines of text, using only memory. Nothing is written to disk."""
import io
import threading

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError
from rapidocr_onnxruntime import RapidOCR

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 12_000_000
ALLOWED_FORMATS = {"PNG", "JPEG"}

# Below this sharpness score a photo is too blurred to trust, even if some text comes out.
MIN_SHARPNESS = 60

_engine = None
_engine_lock = threading.Lock()  # The OCR engine reads one image at a time.


class BadImage(Exception):
    """The file is not an image we can read. The message is shown to the owner."""


def get_engine() -> RapidOCR:
    # The OCR models take a moment to load, so load them once, on first use.
    global _engine
    if _engine is None:
        _engine = RapidOCR()
    return _engine


def open_image(file_bytes: bytes) -> np.ndarray:
    """Check the file really is a safe image, and return its pixels."""
    if len(file_bytes) > MAX_FILE_BYTES:
        raise BadImage("This file is larger than 5 MB. Upload a smaller photo or scan.")
    try:
        image = Image.open(io.BytesIO(file_bytes))
        if image.format not in ALLOWED_FORMATS:
            raise BadImage("Upload a PNG or JPEG image.")
        if image.width * image.height > MAX_PIXELS:
            raise BadImage("This image is too large. Upload a smaller photo or scan.")
        return np.array(image.convert("RGB"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise BadImage("This file could not be opened as an image. Upload a PNG or JPEG.") from error


def remove_pink_watermark(pixels: np.ndarray) -> np.ndarray:
    """The specimen watermark hides printed text from OCR, so paint its pink pixels white."""
    red, green, blue = (pixels[..., channel].astype(int) for channel in range(3))
    is_pink = (red - green > 18) & (red - blue > 18) & (red > 150)
    cleaned = pixels.copy()
    cleaned[is_pink] = 255
    return cleaned


def sharpness_score(pixels: np.ndarray) -> float:
    """A blurred image has few hard edges, so this edge measure gives a low number."""
    return float(cv2.Laplacian(cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY), cv2.CV_64F).var())


def read_text(pixels: np.ndarray) -> list[tuple[str, float]]:
    """Return (text, confidence) for each line, from the top of the page down."""
    # OpenCV-based models expect blue-green-red order, so the channels are reversed.
    with _engine_lock:
        result, _timings = get_engine()(remove_pink_watermark(pixels)[:, :, ::-1])
    return [(text, float(confidence)) for _box, text, confidence in (result or [])]
