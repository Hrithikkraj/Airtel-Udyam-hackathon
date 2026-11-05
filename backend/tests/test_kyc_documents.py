"""Real OCR on every sample document, through the real API. Run with: pytest -m slow -o addopts=""

These are the outcomes we expect from reading each document ourselves. There is no answer key
in the student pack, so this table records our judgement, not the judges' answers.
"""
import pytest

from app.import_data import DATA_DIR

DOCUMENTS = DATA_DIR / "kyc_documents"
SLOTS = ["gst_certificate", "udyam_certificate", "signatory_id", "address_proof"]

# applicant: (overall status, text that must appear in the reasons, or None)
EXPECTED = {
    "K01": ("failed", "cancelled"),  # Its Udyam certificate also has no number.
    "K02": ("verified", None),  # A tilted scan, which must still read correctly.
    "K03": ("verified", None),
    "K04": ("needs_review", "blurred"),
    "K05": ("in_progress", None),  # No Udyam certificate in the pack, so we keep asking.
    "K06": ("failed", "check digit"),  # One digit altered.
    "K07": ("needs_review", "legal name"),
    "K08": ("verified", None),
    "K09": ("verified", None),
    "K10": ("verified", None),
    "K11": ("failed", "days old"),
    "K12": ("verified", None),
}


@pytest.mark.slow
@pytest.mark.parametrize("applicant", sorted(EXPECTED))
def test_sample_applicant_gets_the_expected_outcome(client, applicant):
    expected_status, expected_text = EXPECTED[applicant]
    saved = client.post(
        "/api/quotes",
        json={"profile": {"employee_count": 3, "city_tier": 1, "has_gstin": True}, "items": [{"product_id": "P01"}]},
    ).json()
    business_id = saved["business_id"]
    headers = {"X-Access-Token": saved["access_token"]}
    version = client.get("/api/kyc/notice").json()["version"]
    client.post(f"/api/kyc/{business_id}/consent", json={"notice_version": version}, headers=headers)

    body = None
    for slot in SLOTS:
        path = DOCUMENTS / f"{applicant}_{slot}.png"
        if not path.exists():
            continue
        response = client.post(
            f"/api/kyc/{business_id}/documents",
            data={"document_type": slot},
            files={"file": (path.name, path.read_bytes(), "image/png")},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        body = response.json()

    assert body["status"] == expected_status, body
    if expected_text:
        reasons = [reason for document in body["documents"] for reason in document["reasons"]]
        assert any(expected_text in reason for reason in reasons + body["problems_across_documents"]), body
