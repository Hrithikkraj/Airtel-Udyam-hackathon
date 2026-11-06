"""KYC tests. OCR is replaced with known text here, so each rule can be tested on its own."""
import io
from datetime import date, timedelta

import pandas as pd
import pytest
from PIL import Image

from app import kyc_ocr
from app.database import SessionLocal
from app.import_data import DATA_DIR
from app.kyc_parse import (
    ADDRESS_PROOF,
    GST_CERTIFICATE,
    SIGNATORY_ID,
    UDYAM_CERTIFICATE,
    clean_gstin,
    clean_udyam,
    detect_document_type,
    extract_fields,
    gstin_check_character,
    is_valid_gstin,
    mask_identifier,
)
from app.kyc_rules import TODAY, FAILED, NEEDS_REVIEW, VERIFIED, check_document, compare_documents
from app.models import Consent, KycRecord

# A clean sample applicant (K03), as the OCR reads it.
GOOD_GST = {
    "gstin": "27XUIXG0767D1ZP",
    "legal_name": "Joseph Singh (Prop. Ganesh Woodcraft)",
    "trade_name": "Ganesh Woodcraft",
    "constitution": "Proprietorship",
    "address": "Shop/Unit 80, Civil Lines, Nagpur, Maharashtra -411231",
    "registration_date": "2020-02-10",
}
GOOD_UDYAM = {
    "udyam_number": "UDYAM-MH-00-9516696",
    "enterprise_name": "GaneshWoodcraft",
    "major_activity": "Manufacturing",
    "city": "Nagpur",
    "state": "Maharashtra",
    "registration_date": "2024-11-21",
}
GOOD_ID = {"name": "JosephSingh", "business_name": "Ganesh Woodcraft", "id_number": "SYN-ID-447889", "valid_till": "2028-07-04"}
GOOD_BILL = {
    "billed_to": "Ganesh Woodcraft",
    "address": "Shop/Unit 80, Civil Lines, Nagpur, Maharashtra-411231",
    "bill_date": "2026-05-30",
}


def check(document_type, fields):
    with SessionLocal() as db:
        return check_document(document_type, fields, db)


def gstin_with_status(status):
    registry = pd.read_csv(DATA_DIR / "mock_gstin_registry.csv")
    return registry[registry["status"] == status].iloc[0]


# ---------- GSTIN format and check digit ----------

def test_every_registry_gstin_passes_the_check_digit():
    registry = pd.read_csv(DATA_DIR / "mock_gstin_registry.csv")
    assert registry["gstin"].map(is_valid_gstin).all()


def test_one_changed_digit_fails_the_check_digit():
    # K06 shows this number. The registry has 5189, so the document was altered.
    assert not is_valid_gstin("08YKZXS8189L1Z0")
    assert not is_valid_gstin(clean_gstin("08YKZXS8189L1Z0"))
    assert is_valid_gstin("08YKZXS5189L1ZO")


def test_wrong_length_and_bad_format_are_invalid():
    assert not is_valid_gstin("27XUIXG0767D1Z")
    assert not is_valid_gstin("ABXUIXG0767D1ZP")


@pytest.mark.parametrize(
    "as_read, expected",
    [
        ("19E0GXH4115Y1ZL", "19EOGXH4115Y1ZL"),  # 0 in a position that must be a letter
        ("24X0RXG9365M1Z3", "24XORXG9365M1Z3"),
        ("27xuixg0767d1zp", "27XUIXG0767D1ZP"),  # lowercase
        ("27 XUIXG 0767 D1ZP", "27XUIXG0767D1ZP"),  # spaces
    ],
)
def test_common_ocr_slips_are_corrected(as_read, expected):
    assert clean_gstin(as_read) == expected
    assert is_valid_gstin(clean_gstin(as_read))


def test_last_character_look_alike_is_fixed_only_if_check_digit_passes():
    good = next(g for g in pd.read_csv(DATA_DIR / "mock_gstin_registry.csv")["gstin"] if g.endswith("O"))
    assert clean_gstin(good[:14] + "0") == good


def test_udyam_digits_are_corrected():
    assert clean_udyam("UDYAM-MH-00-95I6696") == "UDYAM-MH-00-9516696"


def test_identifiers_are_masked():
    assert mask_identifier("27XUIXG0767D1ZP") == "•••••••••••D1ZP"
    assert mask_identifier(None) is None


# ---------- Reading fields from OCR text ----------

def test_document_types_are_told_apart():
    assert detect_document_type(["Specimen: Udyam Registration Certificate"]) == UDYAM_CERTIFICATE
    assert detect_document_type(["Specimen: GST Registration Certificate"]) == GST_CERTIFICATE
    assert detect_document_type(["Specimen: Authorised Signatory ID"]) == SIGNATORY_ID
    assert detect_document_type(["Specimen: Electricity Bill"]) == ADDRESS_PROOF
    assert detect_document_type(["Holiday photo"]) is None


def test_fields_handle_lost_spaces_wrapped_addresses_and_small_print():
    lines = [
        "Specimen: GST Registration Certificate",
        "GSTIN", "27XUIXG0767D1ZP",
        "Legal name", "Joseph Singh (Prop. Ganesh Woodcraft)",
        "Address of principal", "Shop/Unit 80, Civil Lines, Nagpur, Maharashtr",
        "place of business", "a -411231",
        "Dateofliability", "2020-02-10",
        "Type of registration", "Regular",
        "Accel YTL Hackathor - Track A test oata.",
    ]
    fields = extract_fields(lines, GST_CERTIFICATE)
    assert fields["address"] == "Shop/Unit 80, Civil Lines, Nagpur, Maharashtra -411231"
    assert fields["registration_date"] == "2020-02-10"
    assert fields["registration_type"] == "Regular"


def test_blank_value_stays_missing():
    # K01 prints the Udyam number label with nothing beside it.
    fields = extract_fields(["Udyam reg. number", "Enterprise name", "Vindhya Tours"], UDYAM_CERTIFICATE)
    assert "udyam_number" not in fields
    assert fields["enterprise_name"] == "Vindhya Tours"


# ---------- One document at a time ----------

def test_clean_documents_are_verified():
    assert check(GST_CERTIFICATE, GOOD_GST).status == VERIFIED
    assert check(UDYAM_CERTIFICATE, GOOD_UDYAM).status == VERIFIED
    assert check(SIGNATORY_ID, GOOD_ID).status == VERIFIED
    assert check(ADDRESS_PROOF, GOOD_BILL).status == VERIFIED


@pytest.mark.parametrize("status", ["Cancelled", "Suspended"])
def test_inactive_gstin_fails(status):
    record = gstin_with_status(status)
    fields = {
        "gstin": record["gstin"], "legal_name": record["legal_name"], "trade_name": record["trade_name"],
        "constitution": record["constitution"], "address": record["principal_place_of_business"],
        "registration_date": record["registration_date"],
    }
    findings = check(GST_CERTIFICATE, fields)
    assert findings.status == FAILED
    assert status.lower() in findings.reasons[0]


def test_valid_gstin_not_in_registry_fails():
    first_14 = "27ZZZXZ9999Z1Z"
    unknown = first_14 + gstin_check_character(first_14)
    assert is_valid_gstin(unknown)
    findings = check(GST_CERTIFICATE, {**GOOD_GST, "gstin": unknown})
    assert findings.status == FAILED
    assert "not in the GST registry" in findings.reasons[0]


def test_failure_message_never_shows_the_full_gstin():
    first_14 = "27ZZZXZ9999Z1Z"
    unknown = first_14 + gstin_check_character(first_14)
    findings = check(GST_CERTIFICATE, {**GOOD_GST, "gstin": unknown})
    assert unknown not in findings.reasons[0]


@pytest.mark.parametrize(
    "field, value, expected",
    [
        ("legal_name", "Someone Else (Prop. Ganesh Woodcraft)", "legal name"),
        ("trade_name", "Other Traders", "trade name"),
        ("address", "Shop/Unit 80, Civil Lines, Nagpur, Maharashtra -411299", "address"),
        ("constitution", "Private Limited Company", "business type"),
        ("registration_date", "2021-02-10", "registration date"),
    ],
)
def test_gst_mismatch_goes_to_review(field, value, expected):
    findings = check(GST_CERTIFICATE, {**GOOD_GST, field: value})
    assert findings.status == NEEDS_REVIEW
    assert expected in findings.reasons[0]


def test_small_ocr_differences_are_not_mismatches():
    assert check(GST_CERTIFICATE, {**GOOD_GST, "legal_name": "JosephSingh(Prop.GaneshWoodcraft)"}).status == VERIFIED


def test_udyam_with_no_number_goes_to_review():
    fields = {key: value for key, value in GOOD_UDYAM.items() if key != "udyam_number"}
    findings = check(UDYAM_CERTIFICATE, fields)
    assert findings.status == NEEDS_REVIEW
    assert "no registration number" in findings.reasons[0]


def test_unknown_udyam_fails():
    assert check(UDYAM_CERTIFICATE, {**GOOD_UDYAM, "udyam_number": "UDYAM-MH-00-0000000"}).status == FAILED


def test_udyam_name_mismatch_goes_to_review():
    assert check(UDYAM_CERTIFICATE, {**GOOD_UDYAM, "enterprise_name": "Other Traders"}).status == NEEDS_REVIEW


def test_expired_signatory_id_fails():
    yesterday = (TODAY - timedelta(days=1)).isoformat()
    findings = check(SIGNATORY_ID, {**GOOD_ID, "valid_till": yesterday})
    assert findings.status == FAILED
    assert "expired" in findings.reasons[0]


def test_id_valid_until_today_passes():
    # "Expired" is judged against the real date, so a real ID that has run out is caught.
    today = max(TODAY, date.today())
    assert check(SIGNATORY_ID, {**GOOD_ID, "valid_till": today.isoformat()}).status == VERIFIED


@pytest.mark.parametrize("days_old, expected", [(0, VERIFIED), (90, VERIFIED), (91, FAILED), (257, FAILED)])
def test_address_proof_age_limit(days_old, expected):
    bill_date = (TODAY - timedelta(days=days_old)).isoformat()
    assert check(ADDRESS_PROOF, {**GOOD_BILL, "bill_date": bill_date}).status == expected


def test_address_proof_from_the_future_goes_to_review():
    # "Future" is judged against the real date, so a genuine recent bill is not flagged.
    bill_date = (date.today() + timedelta(days=1)).isoformat()
    assert check(ADDRESS_PROOF, {**GOOD_BILL, "bill_date": bill_date}).status == NEEDS_REVIEW


# ---------- All documents together ----------

GOOD_SET = {GST_CERTIFICATE: GOOD_GST, UDYAM_CERTIFICATE: GOOD_UDYAM, SIGNATORY_ID: GOOD_ID, ADDRESS_PROOF: GOOD_BILL}


def test_matching_documents_have_no_problems():
    assert compare_documents(GOOD_SET) == []


@pytest.mark.parametrize(
    "document, changes, expected",
    [
        (ADDRESS_PROOF, {"billed_to": "Other Traders"}, "business name on the address proof"),
        (SIGNATORY_ID, {"business_name": "Other Traders"}, "business name on the signatory ID"),
        (UDYAM_CERTIFICATE, {"enterprise_name": "Other Traders"}, "business name on the Udyam certificate"),
        (ADDRESS_PROOF, {"address": "Shop/Unit 80, Civil Lines, Nagpur, Maharashtra-411299"}, "address on the address proof"),
        (SIGNATORY_ID, {"name": "Someone Else"}, "not the proprietor"),
        (UDYAM_CERTIFICATE, {"state": "Kerala"}, "state on the Udyam certificate"),
        (UDYAM_CERTIFICATE, {"city": "Kochi"}, "city on the Udyam certificate"),
        (GST_CERTIFICATE, {"legal_name": "Joseph Singh (Prop. Other Traders)"}, "name different businesses"),
    ],
)
def test_documents_that_disagree_are_flagged(document, changes, expected):
    documents = {**GOOD_SET, document: {**GOOD_SET[document], **changes}}
    assert any(expected in problem for problem in compare_documents(documents))


# ---------- Full API, with OCR replaced by known text ----------

TEXT = {
    GST_CERTIFICATE: [
        "Specimen: GST Registration Certificate", "GSTIN", "27XUIXG0767D1ZP",
        "Legal name", "Joseph Singh (Prop. Ganesh Woodcraft)", "Trade name", "Ganesh Woodcraft",
        "Constitution", "Proprietorship", "Address of principal", "Shop/Unit 80, Civil Lines, Nagpur, Maharashtr",
        "place of business", "a -411231", "Dateofliability", "2020-02-10",
    ],
    UDYAM_CERTIFICATE: [
        "Specimen: Udyam Registration Certificate", "Udyam reg. number", "UDYAM-MH-00-9516696",
        "Enterprise name", "Ganesh Woodcraft", "Major activity", "Manufacturing", "City", "Nagpur",
        "State", "Maharashtra", "Date of registration", "2024-11-21",
    ],
    SIGNATORY_ID: [
        "Specimen: Authorised Signatory ID", "Name", "JosephSingh", "Designation", "Owner",
        "For business", "Ganesh Woodcraft", "ID no.", "SYN-ID-447889", "Valid till", "2028-07-04",
    ],
    ADDRESS_PROOF: [
        "Specimen: Electricity Bill", "Consumer no.", "3438517928", "Billed to", "Ganesh Woodcraft",
        "Supply address", "Shop/Unit 80, Civil Lines, Nagpur, Maharashtr", "a-411231",
        "Bill date", "2026-05-30", "Units consumed", "231", "Amount due (INR)", "33,615",
    ],
}


def small_png():
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture
def fake_ocr(monkeypatch):
    """Make the OCR return chosen lines, with a good confidence and sharpness."""
    def install(lines, confidence=0.98, sharpness=900.0):
        monkeypatch.setattr(kyc_ocr, "read_text", lambda _pixels: [(line, confidence) for line in lines])
        monkeypatch.setattr(kyc_ocr, "sharpness_score", lambda _pixels: sharpness)
    return install


@pytest.fixture
def owner(client):
    """A saved quote for a business with a GSTIN, and the headers its owner uses."""
    saved = client.post(
        "/api/quotes",
        json={"profile": {"employee_count": 3, "city_tier": 2, "has_gstin": True}, "items": [{"product_id": "P01"}]},
    ).json()
    return saved["business_id"], {"X-Access-Token": saved["access_token"]}


def give_consent(client, owner):
    business_id, headers = owner
    version = client.get("/api/kyc/notice").json()["version"]
    return client.post(f"/api/kyc/{business_id}/consent", json={"notice_version": version}, headers=headers)


def upload(client, owner, document_type):
    business_id, headers = owner
    return client.post(
        f"/api/kyc/{business_id}/documents",
        data={"document_type": document_type},
        files={"file": ("doc.png", small_png(), "image/png")},
        headers=headers,
    )


def upload_all(client, owner, fake_ocr):
    give_consent(client, owner)
    for document_type, lines in TEXT.items():
        fake_ocr(lines)
        response = upload(client, owner, document_type)
        assert response.status_code == 200
    return response.json()


def test_full_clean_application_is_verified(client, owner, fake_ocr):
    body = upload_all(client, owner, fake_ocr)
    assert body["status"] == VERIFIED
    assert body["waiting_for"] == []


def test_status_is_in_progress_until_every_document_arrives(client, owner, fake_ocr):
    give_consent(client, owner)
    fake_ocr(TEXT[GST_CERTIFICATE])
    body = upload(client, owner, GST_CERTIFICATE).json()
    assert body["status"] == "in_progress"
    assert len(body["waiting_for"]) == 3


def test_upload_is_refused_without_consent(client, owner, fake_ocr):
    fake_ocr(TEXT[GST_CERTIFICATE])
    assert upload(client, owner, GST_CERTIFICATE).status_code == 403


def test_consent_is_recorded_with_its_version_and_purpose(client, owner):
    give_consent(client, owner)
    with SessionLocal() as db:
        consent = db.query(Consent).filter_by(business_id=owner[0]).one()
        assert consent.purpose == "kyc_verification"
        assert consent.notice_version == client.get("/api/kyc/notice").json()["version"]
        assert consent.granted_at is not None


def test_consent_to_an_old_notice_is_refused(client, owner):
    business_id, headers = owner
    response = client.post(f"/api/kyc/{business_id}/consent", json={"notice_version": "old"}, headers=headers)
    assert response.status_code == 409


def test_withdrawing_consent_deletes_details_and_blocks_uploads(client, owner, fake_ocr):
    upload_all(client, owner, fake_ocr)
    business_id, headers = owner
    body = client.delete(f"/api/kyc/{business_id}/consent", headers=headers).json()
    assert body["status"] == "not_started"
    assert body["documents"] == []
    with SessionLocal() as db:
        assert db.query(KycRecord).filter_by(business_id=business_id).count() == 0
        assert db.query(Consent).filter_by(business_id=business_id).one().revoked_at is not None
    fake_ocr(TEXT[GST_CERTIFICATE])
    assert upload(client, owner, GST_CERTIFICATE).status_code == 403


@pytest.mark.parametrize("token", ["", "wrong-token"])
def test_kyc_data_needs_the_owners_token(anonymous, owner, token):
    business_id, _headers = owner
    response = anonymous.get(f"/api/kyc/{business_id}/status", headers={"X-Access-Token": token})
    assert response.status_code == 403


def test_one_owners_token_cannot_read_another_business(client, anonymous, owner):
    other = client.post(
        "/api/quotes",
        json={"profile": {"employee_count": 3, "city_tier": 2, "has_gstin": True}, "items": [{"product_id": "P01"}]},
    ).json()
    response = anonymous.get(f"/api/kyc/{owner[0]}/status", headers={"X-Access-Token": other["access_token"]})
    assert response.status_code == 403


def test_only_masked_and_needed_fields_are_stored(client, owner, fake_ocr):
    body = upload_all(client, owner, fake_ocr)
    documents = {d["document_type"]: d["fields"] for d in body["documents"]}
    assert documents[GST_CERTIFICATE]["gstin"] == "•••••••••••D1ZP"
    assert documents[UDYAM_CERTIFICATE]["udyam_number"] == mask_identifier("UDYAM-MH-00-9516696")
    assert documents[SIGNATORY_ID]["id_number"] == mask_identifier("SYN-ID-447889")
    assert "amount_due" not in documents[ADDRESS_PROOF]
    assert "consumer_number" not in documents[ADDRESS_PROOF]
    assert "designation" not in documents[SIGNATORY_ID]
    with SessionLocal() as db:
        stored = str([r.extracted_fields for r in db.query(KycRecord).filter_by(business_id=owner[0])])
    for secret in ["27XUIXG0767D1ZP", "UDYAM-MH-00-9516696", "SYN-ID-447889", "33,615", "3438517928"]:
        assert secret not in stored


def test_wrong_document_in_a_slot_is_refused_with_a_helpful_message(client, owner, fake_ocr):
    give_consent(client, owner)
    fake_ocr(TEXT[UDYAM_CERTIFICATE])
    response = upload(client, owner, GST_CERTIFICATE)
    assert response.status_code == 422
    assert "looks like a Udyam certificate" in response.json()["detail"]


def test_unrecognised_image_is_refused(client, owner, fake_ocr):
    give_consent(client, owner)
    fake_ocr(["Holiday photo"])
    assert upload(client, owner, GST_CERTIFICATE).status_code == 422


def test_empty_ocr_result_is_refused(client, owner, fake_ocr):
    give_consent(client, owner)
    fake_ocr([])
    assert upload(client, owner, GST_CERTIFICATE).status_code == 422


def test_blurred_image_goes_to_review_and_keeps_no_fields(client, owner, fake_ocr):
    give_consent(client, owner)
    fake_ocr(TEXT[GST_CERTIFICATE], sharpness=1.0)
    document = upload(client, owner, GST_CERTIFICATE).json()["documents"][0]
    assert document["status"] == NEEDS_REVIEW
    assert "blurred" in document["reasons"][0]
    assert document["fields"] == {}


def test_low_confidence_image_goes_to_review(client, owner, fake_ocr):
    give_consent(client, owner)
    fake_ocr(TEXT[GST_CERTIFICATE], confidence=0.5)
    assert upload(client, owner, GST_CERTIFICATE).json()["documents"][0]["status"] == NEEDS_REVIEW


def test_uploading_again_replaces_the_earlier_result(client, owner, fake_ocr):
    give_consent(client, owner)
    fake_ocr(TEXT[GST_CERTIFICATE], sharpness=1.0)
    upload(client, owner, GST_CERTIFICATE)
    fake_ocr(TEXT[GST_CERTIFICATE])
    documents = upload(client, owner, GST_CERTIFICATE).json()["documents"]
    assert len(documents) == 1
    assert documents[0]["status"] == VERIFIED


def test_owner_can_say_they_have_no_udyam(client, owner, fake_ocr):
    give_consent(client, owner)
    for document_type in [GST_CERTIFICATE, SIGNATORY_ID, ADDRESS_PROOF]:
        fake_ocr(TEXT[document_type])
        upload(client, owner, document_type)
    business_id, headers = owner
    assert client.get(f"/api/kyc/{business_id}/status", headers=headers).json()["waiting_for"] == ["Udyam certificate"]
    body = client.post(f"/api/kyc/{business_id}/no-udyam", headers=headers).json()
    assert body["status"] == VERIFIED


def test_business_with_no_gstin_is_not_asked_for_a_certificate(client, fake_ocr):
    saved = client.post(
        "/api/quotes",
        json={"profile": {"employee_count": 3, "city_tier": 2, "has_gstin": False}, "items": [{"product_id": "P01"}]},
    ).json()
    headers = {"X-Access-Token": saved["access_token"]}
    owner_no_gst = (saved["business_id"], headers)
    body = give_consent(client, owner_no_gst).json()
    assert "GST certificate" not in body["waiting_for"]


def test_a_problem_across_documents_needs_review(client, owner, fake_ocr):
    give_consent(client, owner)
    for document_type, lines in TEXT.items():
        if document_type == ADDRESS_PROOF:
            lines = ["Other Traders" if line == "Ganesh Woodcraft" else line for line in lines]
        fake_ocr(lines)
        body = upload(client, owner, document_type).json()
    assert body["status"] == NEEDS_REVIEW
    assert any("business name" in problem for problem in body["problems_across_documents"])


@pytest.mark.parametrize(
    "file_bytes",
    [b"not an image at all", b"", b"%PDF-1.7 pretending"],
)
def test_files_that_are_not_images_are_refused(client, owner, file_bytes):
    give_consent(client, owner)
    business_id, headers = owner
    response = client.post(
        f"/api/kyc/{business_id}/documents",
        data={"document_type": GST_CERTIFICATE},
        files={"file": ("doc.png", file_bytes, "image/png")},
        headers=headers,
    )
    assert response.status_code == 422


def test_other_image_formats_are_refused(client, owner):
    give_consent(client, owner)
    buffer = io.BytesIO()
    Image.new("RGB", (40, 40), "white").save(buffer, "GIF")
    business_id, headers = owner
    response = client.post(
        f"/api/kyc/{business_id}/documents",
        data={"document_type": GST_CERTIFICATE},
        files={"file": ("doc.gif", buffer.getvalue(), "image/gif")},
        headers=headers,
    )
    assert response.status_code == 422


def test_oversized_file_is_refused(client, owner):
    give_consent(client, owner)
    business_id, headers = owner
    response = client.post(
        f"/api/kyc/{business_id}/documents",
        data={"document_type": GST_CERTIFICATE},
        files={"file": ("doc.png", b"x" * (kyc_ocr.MAX_FILE_BYTES + 1), "image/png")},
        headers=headers,
    )
    assert response.status_code == 422
    assert "5 MB" in response.json()["detail"]


def test_unknown_document_type_is_refused(client, owner):
    give_consent(client, owner)
    assert upload(client, owner, "passport").status_code == 422


def test_no_upload_files_are_left_on_disk(client, owner, fake_ocr):
    from pathlib import Path

    backend = Path(__file__).resolve().parent.parent
    before = {p for p in backend.rglob("*") if ".venv" not in p.parts and "__pycache__" not in p.parts}
    upload_all(client, owner, fake_ocr)
    after = {p for p in backend.rglob("*") if ".venv" not in p.parts and "__pycache__" not in p.parts}
    assert after - before == set()
