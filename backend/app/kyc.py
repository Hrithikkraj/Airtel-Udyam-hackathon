"""KYC API: consent, document upload and status.

Privacy choices made here:
- Nothing happens before consent, and withdrawing consent deletes the extracted details.
- Uploaded images stay in memory and are never saved or logged.
- Only the fields needed for the decision are kept, and ID numbers are kept masked.
- The LLM is never involved. Documents go only to the OCR that runs on our own server.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import kyc_ocr
from .access import get_owned_business
from .database import get_db
from .kyc_parse import (
    ADDRESS_PROOF,
    GST_CERTIFICATE,
    SIGNATORY_ID,
    UDYAM_CERTIFICATE,
    clean_gstin,
    clean_udyam,
    detect_document_type,
    extract_fields,
    mask_identifier,
)
from .kyc_rules import (
    DOCUMENT_NAMES,
    FAILED,
    NEEDS_REVIEW,
    VERIFIED,
    Findings,
    check_document,
    check_readability,
    compare_documents,
)
from .models import Business, Consent, KycRecord
from .order_state import ORDER_PLACED_STATUSES, order_for_business, update_order_after_kyc

router = APIRouter(prefix="/api/kyc", tags=["kyc"])

NOTICE_VERSION = "2026-07-v1"
PURPOSE = "kyc_verification"
NOTICE_POINTS = [
    "We ask for your GST certificate, Udyam certificate, signatory ID and a recent bill as address proof.",
    "We use them only to verify your business for this order. We do not use them for marketing or to train AI.",
    "We read each image and do not keep it. We keep only the names, address, dates and masked ID numbers we checked.",
    "We check your GSTIN and Udyam number against the registries, and a person may review anything that does not match.",
    "You can withdraw at any time. We then delete these details, and we cannot activate your order until you verify again.",
]

NOT_APPLICABLE = "not_applicable"
IN_PROGRESS = "in_progress"
NOT_STARTED = "not_started"

# The only fields we keep from each document. Bill amounts and designations are left out.
FIELDS_TO_KEEP = {
    GST_CERTIFICATE: ["legal_name", "trade_name", "address"],
    UDYAM_CERTIFICATE: ["enterprise_name", "city", "state"],
    SIGNATORY_ID: ["name", "business_name", "valid_till"],
    ADDRESS_PROOF: ["billed_to", "address", "bill_date"],
}
# These are shown and stored masked.
ID_FIELDS = {GST_CERTIFICATE: ("gstin", clean_gstin), UDYAM_CERTIFICATE: ("udyam_number", clean_udyam), SIGNATORY_ID: ("id_number", str)}


class ConsentRequest(BaseModel):
    notice_version: str


class KycDocumentOut(BaseModel):
    document_type: str
    name: str
    status: str
    reasons: list[str]
    fields: dict[str, str]


class KycStatusOut(BaseModel):
    status: str
    has_consent: bool
    documents: list[KycDocumentOut]
    waiting_for: list[str]
    problems_across_documents: list[str]
    review_note: str | None = None  # From a person who reviewed the documents.


class NoticeOut(BaseModel):
    version: str
    purpose: str
    points: list[str]


def active_consent(business: Business, db: Session) -> Consent | None:
    query = select(Consent).where(
        Consent.business_id == business.business_id,
        Consent.purpose == PURPOSE,
        Consent.revoked_at.is_(None),
    )
    return db.scalars(query).first()


def required_documents(business: Business) -> list[str]:
    """Only what this business needs. A business with no GSTIN is not asked for a certificate."""
    required = [UDYAM_CERTIFICATE, SIGNATORY_ID, ADDRESS_PROOF]
    return [GST_CERTIFICATE, *required] if business.has_gstin == "Y" else required


def build_status(business: Business, db: Session) -> KycStatusOut:
    records = db.scalars(select(KycRecord).where(KycRecord.business_id == business.business_id)).all()
    by_type = {record.document_type: record for record in records}
    waiting_for = [DOCUMENT_NAMES[d] for d in required_documents(business) if d not in by_type]

    # Unreadable documents have no fields, so they are left out of the comparison.
    across = compare_documents({r.document_type: r.extracted_fields for r in records if r.extracted_fields})
    statuses = {record.status for record in records}
    has_consent = active_consent(business, db) is not None

    if not has_consent:
        overall = NOT_STARTED
    elif FAILED in statuses or business.kyc_review_decision == "rejected":
        overall = FAILED
    elif waiting_for:
        overall = IN_PROGRESS
    elif (NEEDS_REVIEW in statuses or across) and business.kyc_review_decision != "approved":
        overall = NEEDS_REVIEW
    else:
        overall = VERIFIED

    return KycStatusOut(
        status=overall,
        has_consent=has_consent,
        waiting_for=waiting_for,
        problems_across_documents=across,
        review_note=business.kyc_review_note,
        documents=[
            KycDocumentOut(
                document_type=record.document_type,
                name=DOCUMENT_NAMES[record.document_type],
                status=record.status,
                reasons=record.reasons or [],
                fields=record.extracted_fields or {},
            )
            for record in records
        ],
    )


def status_after_change(business: Business, db: Session, actor: str = "system") -> KycStatusOut:
    """Work out the new KYC status and keep the order's tracker in step with it."""
    status = build_status(business, db)
    update_order_after_kyc(business.business_id, status.status, status.has_consent, db, actor)
    db.commit()
    return status


def refuse_if_order_placed(business: Business, db: Session):
    if order_for_business(business.business_id, db).status in ORDER_PLACED_STATUSES:
        raise HTTPException(status_code=409, detail="Your order has been placed, so documents can no longer be changed here.")


def fields_to_store(document_type: str, fields: dict) -> dict:
    kept = {name: fields[name] for name in FIELDS_TO_KEEP[document_type] if fields.get(name)}
    if document_type in ID_FIELDS:
        id_field, clean = ID_FIELDS[document_type]
        if fields.get(id_field):
            kept[id_field] = mask_identifier(clean(fields[id_field]))
    return kept


def clear_review_decision(business: Business):
    """A person's decision covered the documents they saw, so new documents need a new one."""
    business.kyc_review_decision = None
    business.kyc_review_note = None


def save_record(business, document_type, status, reasons, fields, db: Session):
    clear_review_decision(business)
    # Uploading again replaces the earlier result for that document.
    db.execute(
        delete(KycRecord).where(
            KycRecord.business_id == business.business_id, KycRecord.document_type == document_type
        )
    )
    db.add(
        KycRecord(
            business_id=business.business_id,
            document_type=document_type,
            status=status,
            reasons=reasons,
            extracted_fields=fields,
        )
    )
    db.commit()


@router.get("/notice", response_model=NoticeOut)
def get_notice():
    return NoticeOut(version=NOTICE_VERSION, purpose=PURPOSE, points=NOTICE_POINTS)


@router.get("/{business_id}/status", response_model=KycStatusOut)
def get_status(business: Business = Depends(get_owned_business), db: Session = Depends(get_db)):
    return build_status(business, db)


@router.post("/{business_id}/consent", response_model=KycStatusOut)
def give_consent(
    request: ConsentRequest,
    business: Business = Depends(get_owned_business),
    db: Session = Depends(get_db),
):
    if request.notice_version != NOTICE_VERSION:
        raise HTTPException(status_code=409, detail="The notice has changed. Reload this page and read it again.")
    if active_consent(business, db) is None:
        db.add(Consent(business_id=business.business_id, purpose=PURPOSE, notice_version=NOTICE_VERSION))
        db.commit()
    return status_after_change(business, db)


@router.delete("/{business_id}/consent", response_model=KycStatusOut)
def withdraw_consent(business: Business = Depends(get_owned_business), db: Session = Depends(get_db)):
    consent = active_consent(business, db)
    if consent:
        consent.revoked_at = datetime.now(timezone.utc)
    db.execute(delete(KycRecord).where(KycRecord.business_id == business.business_id))
    clear_review_decision(business)
    db.commit()
    return status_after_change(business, db)


@router.post("/{business_id}/no-udyam", response_model=KycStatusOut)
def declare_no_udyam(business: Business = Depends(get_owned_business), db: Session = Depends(get_db)):
    """Many small businesses have no Udyam registration. The owner's answer is recorded."""
    if active_consent(business, db) is None:
        raise HTTPException(status_code=403, detail="Give consent before continuing.")
    refuse_if_order_placed(business, db)
    save_record(business, UDYAM_CERTIFICATE, NOT_APPLICABLE, ["You told us this business has no Udyam registration"], {}, db)
    return status_after_change(business, db)


@router.post("/{business_id}/documents", response_model=KycStatusOut)
def upload_document(
    document_type: str = Form(),
    file: UploadFile = File(),
    business: Business = Depends(get_owned_business),
    db: Session = Depends(get_db),
):
    if active_consent(business, db) is None:
        raise HTTPException(status_code=403, detail="Give consent before uploading documents.")
    refuse_if_order_placed(business, db)
    if document_type not in DOCUMENT_NAMES:
        raise HTTPException(status_code=422, detail="This document type is not recognised.")

    # Read one byte over the limit, so an oversized file is caught without reading all of it.
    file_bytes = file.file.read(kyc_ocr.MAX_FILE_BYTES + 1)
    try:
        pixels = kyc_ocr.open_image(file_bytes)
    except kyc_ocr.BadImage as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    text_lines = kyc_ocr.read_text(pixels)
    lines = [text for text, _confidence in text_lines]

    detected = detect_document_type(lines)
    if detected is None:
        raise HTTPException(status_code=422, detail=f"We could not recognise this as a {DOCUMENT_NAMES[document_type]}. Upload a clearer image.")
    if detected != document_type:
        raise HTTPException(status_code=422, detail=f"This looks like a {DOCUMENT_NAMES[detected]}. Upload your {DOCUMENT_NAMES[document_type]} here.")

    fields = extract_fields(lines, document_type)
    average_confidence = sum(confidence for _text, confidence in text_lines) / len(text_lines)
    unreadable = check_readability(
        document_type, fields, average_confidence, kyc_ocr.sharpness_score(pixels), kyc_ocr.MIN_SHARPNESS
    )
    if unreadable:
        findings = Findings(problems_to_review=[unreadable])
        stored = {}  # Fields read from a blurred image cannot be trusted, so none are kept.
    else:
        findings = check_document(document_type, fields, db)
        stored = fields_to_store(document_type, fields)

    save_record(business, document_type, findings.status, findings.reasons, stored, db)
    return status_after_change(business, db)
