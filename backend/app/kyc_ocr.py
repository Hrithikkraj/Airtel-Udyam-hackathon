"""Turn an uploaded image into lines of text, using only memory. Nothing is written to disk."""
import io
import threading

import cv2
import numpy as np
import pypdfium2
from PIL import Image, ImageOps, UnidentifiedImageError
from rapidocr_onnxruntime import RapidOCR

# Phone photos are often 3 to 8 MB, so the limit is set well above that.
MAX_FILE_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 50_000_000
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
# Larger images read no better and take much longer, so they are shrunk to this size first.
LONGEST_SIDE = 2200
PDF_RENDER_SCALE = 2  # About 150 dots per inch, which OCR reads well.

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


def first_pdf_page(file_bytes: bytes) -> Image.Image:
    """Bills often arrive as PDFs. Only the first page is read, as that is where the address is."""
    try:
        document = pypdfium2.PdfDocument(file_bytes)
        try:
            return document[0].render(scale=PDF_RENDER_SCALE).to_pil()
        finally:
            document.close()
    except (pypdfium2.PdfiumError, IndexError) as error:
        raise BadImage("This PDF could not be opened. Upload a photo or another copy of the document.") from error


def shrink_if_large(image: Image.Image) -> Image.Image:
    longest = max(image.size)
    if longest <= LONGEST_SIDE:
        return image
    ratio = LONGEST_SIDE / longest
    return image.resize((round(image.width * ratio), round(image.height * ratio)), Image.LANCZOS)


def open_image(file_bytes: bytes) -> np.ndarray:
    """Check the file is a safe image or PDF, and return the pixels the right way up."""
    if len(file_bytes) > MAX_FILE_BYTES:
        raise BadImage("This file is larger than 15 MB. Upload a smaller photo or scan.")
    if file_bytes.startswith(b"%PDF"):
        return np.array(shrink_if_large(first_pdf_page(file_bytes).convert("RGB")))
    try:
        image = Image.open(io.BytesIO(file_bytes))
        if image.format not in ALLOWED_FORMATS:
            raise BadImage("Upload a photo (JPEG or PNG) or a PDF.")
        if image.width * image.height > MAX_PIXELS:
            raise BadImage("This image is too large. Upload a smaller photo or scan.")
        # Phones save photos sideways with a note saying how to turn them. Apply that note.
        upright = ImageOps.exif_transpose(image)
        return np.array(shrink_if_large(upright.convert("RGB")))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise BadImage("This file could not be opened. Upload a photo (JPEG or PNG) or a PDF.") from error


def turned(pixels: np.ndarray, quarter_turns: int) -> np.ndarray:
    """The same image turned by 90 degrees at a time, for photos taken sideways."""
    return np.ascontiguousarray(np.rot90(pixels, quarter_turns))


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
