"""KYC decisions: compare what a document says with the registries and the other documents.

Three outcomes, each with reasons the owner can read:
- verified: everything agrees.
- needs_review: something does not agree, or could not be read. A person takes a look.
- failed: a rule says we cannot proceed, such as a cancelled GSTIN.
"""
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from .kyc_parse import (
    ADDRESS_PROOF,
    GST_CERTIFICATE,
    SIGNATORY_ID,
    UDYAM_CERTIFICATE,
    clean_gstin,
    clean_udyam,
    is_valid_gstin,
    mask_identifier,
    missing_required_fields,
)
from .models import GstinRecord, UdyamRecord

VERIFIED = "verified"
NEEDS_REVIEW = "needs_review"
FAILED = "failed"

# The dataset README sets this as "today" for every date check.
TODAY = date(2026, 7, 15)
MAX_ADDRESS_PROOF_AGE = timedelta(days=90)
NAME_MATCH_THRESHOLD = 0.9
MIN_AVERAGE_CONFIDENCE = 0.85

DOCUMENT_NAMES = {
    GST_CERTIFICATE: "GST certificate",
    UDYAM_CERTIFICATE: "Udyam certificate",
    SIGNATORY_ID: "signatory ID",
    ADDRESS_PROOF: "address proof",
}


@dataclass
class Findings:
    """Collects problems as checks run. The worst problem sets the overall status."""
    problems_to_review: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)

    def review(self, reason: str):
        self.problems_to_review.append(reason)

    def fail(self, reason: str):
        self.failures.append(reason)

    @property
    def status(self) -> str:
        if self.failures:
            return FAILED
        return NEEDS_REVIEW if self.problems_to_review else VERIFIED

    @property
    def reasons(self) -> list[str]:
        return self.failures + self.problems_to_review


def squeeze_upper(text: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (text or "").upper())


def same_text(first: str | None, second: str | None) -> bool:
    """OCR drops spaces and misreads the odd letter, so allow a small difference."""
    a, b = squeeze_upper(first), squeeze_upper(second)
    return bool(a and b) and SequenceMatcher(None, a, b).ratio() >= NAME_MATCH_THRESHOLD


def parse_date(text: str | None) -> date | None:
    match = re.search(r"\d{4}-\d{2}-\d{2}", text or "")
    if not match:
        return None
    try:
        return date.fromisoformat(match.group())
    except ValueError:
        return None


def pin_code(address: str | None) -> str | None:
    match = re.search(r"(\d{6})\s*$", address or "")
    return match.group(1) if match else None


def same_address(first: str | None, second: str | None) -> bool:
    """The PIN must match exactly, because one wrong digit is a different place."""
    return same_text(first, second) and pin_code(first) == pin_code(second)


# ---------- One document at a time ----------

def check_gst_certificate(fields, db: Session, findings: Findings):
    raw = fields.get("gstin")
    if not raw:
        findings.review("The GST certificate shows no GSTIN that we can read")
        return
    gstin = clean_gstin(raw)
    masked = mask_identifier(gstin)
    if not is_valid_gstin(gstin):
        findings.fail(f"GSTIN {masked} is not valid: its format or check digit is wrong")
        return

    record = db.get(GstinRecord, gstin)
    if record is None:
        findings.fail(f"GSTIN {masked} is not in the GST registry")
        return
    if record.status != "Active":
        findings.fail(f"GSTIN {masked} is {record.status.lower()} in the GST registry")

    if not same_text(fields.get("legal_name"), record.legal_name):
        findings.review("The legal name on the certificate differs from the GST registry")
    if not same_text(fields.get("trade_name"), record.trade_name):
        findings.review("The trade name on the certificate differs from the GST registry")
    if not same_address(fields.get("address"), record.principal_place_of_business):
        findings.review("The address on the certificate differs from the GST registry")
    if not same_text(fields.get("constitution"), record.constitution):
        findings.review("The business type on the certificate differs from the GST registry")
    if parse_date(fields.get("registration_date")) != parse_date(record.registration_date):
        findings.review("The registration date on the certificate differs from the GST registry")


def check_udyam_certificate(fields, db: Session, findings: Findings):
    raw = fields.get("udyam_number")
    if not raw:
        findings.review("The Udyam certificate shows no registration number")
        return
    number = clean_udyam(raw)
    record = db.get(UdyamRecord, number)
    if record is None:
        findings.fail(f"Udyam number {mask_identifier(number)} is not in the Udyam registry")
        return
    if not same_text(fields.get("enterprise_name"), record.enterprise_name):
        findings.review("The enterprise name on the certificate differs from the Udyam registry")
    if not same_text(fields.get("city"), record.city) or not same_text(fields.get("state"), record.state):
        findings.review("The city or state on the certificate differs from the Udyam registry")
    # Udyam dates are not compared: on every sample with a number, the certificate and
    # registry dates differ, even when all else agrees, so this would only cause false alarms.


def check_signatory_id(fields, findings: Findings):
    valid_till = parse_date(fields.get("valid_till"))
    if valid_till is None:
        findings.review("We could not read the expiry date on the signatory ID")
    elif valid_till < TODAY:
        findings.fail(f"The signatory ID expired on {valid_till.isoformat()}")


def check_address_proof(fields, findings: Findings):
    bill_date = parse_date(fields.get("bill_date"))
    if bill_date is None:
        findings.review("We could not read the date on the address proof")
    elif bill_date > TODAY:
        findings.review(f"The address proof is dated in the future: {bill_date.isoformat()}")
    elif TODAY - bill_date > MAX_ADDRESS_PROOF_AGE:
        days_old = (TODAY - bill_date).days
        findings.fail(f"The address proof is {days_old} days old. It must be no older than 90 days")


def check_document(document_type: str, fields: dict, db: Session) -> Findings:
    findings = Findings()
    if document_type == GST_CERTIFICATE:
        check_gst_certificate(fields, db, findings)
    elif document_type == UDYAM_CERTIFICATE:
        check_udyam_certificate(fields, db, findings)
    elif document_type == SIGNATORY_ID:
        check_signatory_id(fields, findings)
    elif document_type == ADDRESS_PROOF:
        check_address_proof(fields, findings)
    return findings


def check_readability(document_type, fields, average_confidence, sharpness, sharpness_limit) -> str | None:
    """Return why the image cannot be trusted, or None. Checked before any other rule."""
    name = DOCUMENT_NAMES[document_type]
    if sharpness < sharpness_limit:
        return f"The {name} image is too blurred to read safely. Upload a sharper photo"
    if average_confidence < MIN_AVERAGE_CONFIDENCE or missing_required_fields(fields, document_type):
        return f"We could not read the {name} clearly. Upload a sharper photo"
    return None


# ---------- All documents together ----------

def owner_from_legal_name(legal_name: str | None) -> str | None:
    """For a proprietorship the legal name reads 'Neha Kaur (Prop. Vindhya Tours)'."""
    match = re.match(r"(.+?)\s*\(\s*Prop", legal_name or "", re.IGNORECASE)
    return match.group(1) if match else None


def compare_documents(documents: dict[str, dict]) -> list[str]:
    """Every document must describe the same business, at the same place, run by the same person."""
    gst = documents.get(GST_CERTIFICATE, {})
    udyam = documents.get(UDYAM_CERTIFICATE, {})
    signatory = documents.get(SIGNATORY_ID, {})
    bill = documents.get(ADDRESS_PROOF, {})
    problems = []

    names = [
        (GST_CERTIFICATE, gst.get("trade_name")),
        (UDYAM_CERTIFICATE, udyam.get("enterprise_name")),
        (SIGNATORY_ID, signatory.get("business_name")),
        (ADDRESS_PROOF, bill.get("billed_to")),
    ]
    present = [(document, name) for document, name in names if name]
    if present:
        first_document, first_name = present[0]
        for document, name in present[1:]:
            if not same_text(first_name, name):
                problems.append(
                    f"The business name on the {DOCUMENT_NAMES[document]} differs from the {DOCUMENT_NAMES[first_document]}"
                )

    legal_name = gst.get("legal_name")
    if gst.get("trade_name") and legal_name and "prop" in legal_name.lower():
        business_in_legal = re.search(r"\(\s*Prop\.?\s*(.+?)\s*\)", legal_name, re.IGNORECASE)
        if business_in_legal and not same_text(business_in_legal.group(1), gst["trade_name"]):
            problems.append("The legal name and trade name on the GST certificate name different businesses")

    if gst.get("address") and bill.get("address") and not same_address(gst["address"], bill["address"]):
        problems.append("The address on the address proof differs from the GST certificate")

    owner = owner_from_legal_name(legal_name)
    if owner and signatory.get("name") and not same_text(owner, signatory["name"]):
        problems.append("The person on the signatory ID is not the proprietor named on the GST certificate")

    if udyam.get("state") and gst.get("address") and squeeze_upper(udyam["state"]) not in squeeze_upper(gst["address"]):
        problems.append("The state on the Udyam certificate differs from the GST certificate")
    if udyam.get("city") and gst.get("address") and squeeze_upper(udyam["city"]) not in squeeze_upper(gst["address"]):
        problems.append("The city on the Udyam certificate differs from the GST certificate")
    return problems
