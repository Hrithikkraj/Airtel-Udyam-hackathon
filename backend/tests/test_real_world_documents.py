"""Real owners upload PDFs and phone photos with other layouts, not only the clean specimens.
These were refused before, even when the document was correct."""
import io
from datetime import date, timedelta

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app import kyc_ocr, kyc_rules
from app.import_data import DATA_DIR
from app.kyc_parse import ADDRESS_PROOF, GST_CERTIFICATE, detect_document_type, extract_fields
from app.kyc_rules import parse_date

SAMPLE_BILL = DATA_DIR / "kyc_documents" / "K03_address_proof.png"


def as_bytes(image: Image.Image, image_format: str, **options) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, image_format, **options)
    return buffer.getvalue()


# ---------- Dates ----------

@pytest.mark.parametrize(
    "text, expected",
    [
        ("2026-05-30", date(2026, 5, 30)),
        ("30/05/2026", date(2026, 5, 30)),
        ("30-05-2026", date(2026, 5, 30)),
        ("30.05.2026", date(2026, 5, 30)),
        ("05/06/2026", date(2026, 6, 5)),  # Day first, as on Indian documents.
        ("30 May 2026", date(2026, 5, 30)),
        ("30-May-2026", date(2026, 5, 30)),
        ("30 September 2026", date(2026, 9, 30)),
        ("May 30, 2026", date(2026, 5, 30)),
        ("Bill date: 30/05/2026", date(2026, 5, 30)),
    ],
)
def test_common_date_formats_are_read(text, expected):
    assert parse_date(text) == expected


@pytest.mark.parametrize("text", ["31/02/2026", "not a date", "", None, "Shop/Unit 80, Nagpur"])
def test_impossible_or_missing_dates_are_not_read(text):
    assert parse_date(text) is None


def test_a_genuine_bill_from_this_week_is_not_called_future_dated(monkeypatch):
    # Dates used to be checked only against the README's 15 July 2026, so a real recent bill failed.
    monkeypatch.setattr(kyc_rules, "real_today", lambda: date(2026, 11, 6))
    findings = kyc_rules.Findings()
    kyc_rules.check_address_proof({"bill_date": "2026-11-02"}, findings)
    assert findings.status == kyc_rules.VERIFIED


def test_a_bill_after_the_real_date_is_still_flagged(monkeypatch):
    monkeypatch.setattr(kyc_rules, "real_today", lambda: date(2026, 11, 6))
    findings = kyc_rules.Findings()
    kyc_rules.check_address_proof({"bill_date": "2026-12-01"}, findings)
    assert findings.status == kyc_rules.NEEDS_REVIEW


def test_an_id_that_expired_before_the_real_date_fails(monkeypatch):
    monkeypatch.setattr(kyc_rules, "real_today", lambda: date(2026, 11, 6))
    findings = kyc_rules.Findings()
    kyc_rules.check_signatory_id({"valid_till": (date(2026, 11, 6) - timedelta(days=1)).isoformat()}, findings)
    assert findings.status == kyc_rules.FAILED


# ---------- Recognising bills and their labels ----------

OTHER_LAYOUT = [
    "ELECTRICITY BILL",
    "Shree Ganesh Power Distribution Company Ltd",
    "Consumer Name : Ganesh Woodcraft",
    "Consumer No : 3438517928",
    "Address : Shop/Unit 80, Civil Lines, Nagpur, Maharashtra - 411231",
    "Bill Date : 30/05/2026",
    "Due Date : 14/06/2026",
    "Net Amount Payable : Rs 3,615",
]


def test_label_and_value_on_one_line_are_read():
    fields = extract_fields(OTHER_LAYOUT, ADDRESS_PROOF)
    assert fields["billed_to"] == "Ganesh Woodcraft"
    assert fields["address"] == "Shop/Unit 80, Civil Lines, Nagpur, Maharashtra - 411231"
    assert fields["bill_date"] == "30/05/2026"


def test_an_unknown_label_line_does_not_leak_into_the_field_before_it():
    fields = extract_fields(["Supply address", "Shop 80, Nagpur", "Due Date : 14/06/2026"], ADDRESS_PROOF)
    assert fields["address"] == "Shop 80, Nagpur"


def test_bills_with_other_titles_are_recognised_by_their_words():
    assert detect_document_type(["Tax Invoice cum Electricity Bill", "Name : X"]) == ADDRESS_PROOF
    assert detect_document_type(["MSEDCL", "Consumer No : 1", "Units consumed : 231 kWh", "Due Date : 1/1/2026"]) == ADDRESS_PROOF


def test_other_documents_are_not_mistaken_for_bills():
    gst_lines = ["Specimen: GST Registration Certificate", "GSTIN", "Legal name", "Address of principal"]
    assert detect_document_type(gst_lines) == GST_CERTIFICATE
    assert detect_document_type(["Holiday photo", "Beach", "2026"]) is None
    # One bill-like word is not enough.
    assert detect_document_type(["My consumer review", "Five stars"]) is None


# ---------- Opening PDFs and photos ----------

def test_a_pdf_bill_is_opened():
    pixels = kyc_ocr.open_image(as_bytes(Image.open(SAMPLE_BILL).convert("RGB"), "PDF", resolution=150))
    assert pixels.ndim == 3 and max(pixels.shape[:2]) > 1000


def test_a_broken_pdf_gives_a_clear_message():
    with pytest.raises(kyc_ocr.BadImage, match="PDF"):
        kyc_ocr.open_image(b"%PDF-1.7 broken")


def test_a_phone_photo_rotate_tag_is_applied():
    upright = Image.new("RGB", (300, 600), "white")  # Taller than wide when upright.
    sideways = upright.rotate(90, expand=True)
    exif = Image.Exif()
    exif[0x0112] = 6
    pixels = kyc_ocr.open_image(as_bytes(sideways, "JPEG", exif=exif))
    assert pixels.shape[0] > pixels.shape[1]


def test_a_large_phone_photo_is_accepted_and_shrunk():
    photo = Image.new("RGB", (3024, 4032), "white")
    pixels = kyc_ocr.open_image(as_bytes(photo, "JPEG", quality=95))
    assert max(pixels.shape[:2]) == kyc_ocr.LONGEST_SIDE


def test_webp_is_accepted():
    assert kyc_ocr.open_image(as_bytes(Image.new("RGB", (50, 50), "white"), "WEBP")).shape[:2] == (50, 50)


def test_files_over_15_mb_are_still_refused():
    with pytest.raises(kyc_ocr.BadImage, match="15 MB"):
        kyc_ocr.open_image(b"x" * (kyc_ocr.MAX_FILE_BYTES + 1))


def test_turning_keeps_the_pixels():
    pixels = np.zeros((2, 3, 3), dtype=np.uint8)
    assert kyc_ocr.turned(pixels, 1).shape == (3, 2, 3)


# ---------- The same correct bill in every common form, through real OCR ----------

def correct_bill_variants() -> dict[str, tuple[bytes, str]]:
    sample = Image.open(SAMPLE_BILL).convert("RGB")
    soft = sample.filter(ImageFilter.GaussianBlur(0.8))
    sideways = soft.rotate(90, expand=True)
    exif = Image.Exif()
    exif[0x0112] = 6

    font_path = "C:/Windows/Fonts/arial.ttf"
    page = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(page)
    try:
        title_font, body_font = ImageFont.truetype(font_path, 44), ImageFont.truetype(font_path, 30)
    except OSError:
        title_font = body_font = ImageFont.load_default(size=30)
    draw.text((80, 70), "ELECTRICITY BILL", fill="black", font=title_font)
    for row, line in enumerate(OTHER_LAYOUT[2:]):
        draw.text((80, 240 + row * 62), line, fill="black", font=body_font)

    return {
        "specimen": (as_bytes(sample, "PNG"), "image/png"),
        "pdf": (as_bytes(sample, "PDF", resolution=150), "application/pdf"),
        "phone photo with rotate tag": (as_bytes(sideways, "JPEG", quality=88, exif=exif), "image/jpeg"),
        "sideways photo, tag lost": (as_bytes(sideways, "JPEG", quality=88), "image/jpeg"),
        "upside-down photo": (as_bytes(soft.rotate(180), "JPEG", quality=88), "image/jpeg"),
        "full-size phone photo": (as_bytes(sample.resize((3024, 4276)), "JPEG", quality=95), "image/jpeg"),
        "other layout, day-first date": (as_bytes(page, "PNG"), "image/png"),
    }


@pytest.mark.slow
@pytest.mark.parametrize("variant", list(correct_bill_variants()))
def test_a_correct_bill_is_verified_in_every_common_form(client, variant):
    file_bytes, mime = correct_bill_variants()[variant]
    saved = client.post(
        "/api/quotes",
        json={"profile": {"employee_count": 3, "city_tier": 1, "has_gstin": True}, "items": [{"product_id": "P01"}]},
    ).json()
    headers = {"X-Access-Token": saved["access_token"]}
    version = client.get("/api/kyc/notice").json()["version"]
    client.post(f"/api/kyc/{saved['business_id']}/consent", json={"notice_version": version}, headers=headers)

    response = client.post(
        f"/api/kyc/{saved['business_id']}/documents",
        data={"document_type": "address_proof"},
        files={"file": ("bill", file_bytes, mime)},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    document = response.json()["documents"][0]
    assert document["status"] == "verified", document
    assert "Ganesh" in document["fields"]["billed_to"]
    assert parse_date(document["fields"]["bill_date"]) == date(2026, 5, 30)
