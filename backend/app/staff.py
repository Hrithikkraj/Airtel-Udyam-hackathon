"""Staff and partner API: review KYC, follow up requests, move installations, see the funnel.

Staff need their own key. An owner's token never works here, and a staff key cannot read
anything an owner would not also see on a document result: ID numbers stay masked.
"""
import os
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .analytics import funnel_summary
from .database import get_db
from .kyc import build_status, status_after_change
from .models import Business, CallbackRequest, Lead, Order
from .order_state import ACTIVATED, INSTALLATION_IN_PROGRESS, INSTALLATION_SCHEDULED, KYC_REVIEW, NEEDS_ASSISTANCE, move_order
from .orders import STATUS_LABELS

DEMO_STAFF_KEY = "accel-demo-staff"
MAX_LEADS_TO_CALL = 50

# Drop reasons a call can plausibly fix -> what to say or do on that call.
CALL_ADVICE = {
    "Owner had no time for a visit": "Offer the phone journey, so no visit is needed.",
    "Visit not scheduled by sales": "Apologise for the missed visit and offer the phone journey.",
    "Quote too complex to understand": "Send the one-price quote and explain each line.",
    "Quote took too long to arrive": "Send an instant quote on this call.",
    "Price too high": "Offer a smaller starting bundle within their budget.",
    "Decided to wait": "Ask what changed, and share the instant quote.",
    "Found paperwork too long": "Offer upload-based KYC, which takes minutes.",
    "Missing GST or Udyam document": "Explain which products need no GSTIN, or help them register.",
    "Authorised signatory not available": "Agree a time when the signatory can upload their ID.",
    "Document details did not match": "Help them correct the mismatch and upload again.",
    "Installation delayed beyond 21 days": "Apologise and offer a faster product where it fits.",
    "First payment failed": "Help them retry the first payment.",
}

router = APIRouter(prefix="/api/staff", tags=["staff"])


def staff_key() -> str | None:
    """Set STAFF_KEY in real use. Only demo mode has a built-in key."""
    configured = os.getenv("STAFF_KEY")
    if configured:
        return configured
    return DEMO_STAFF_KEY if os.getenv("DEMO_MODE", "true").lower() == "true" else None


def require_staff(x_staff_key: str = Header(default="")):
    key = staff_key()
    if key is None or not secrets.compare_digest(key, x_staff_key):
        raise HTTPException(status_code=403, detail="That staff key is not valid.")


router.dependencies.append(Depends(require_staff))


class KycDecision(BaseModel):
    decision: Literal["approve", "reject"]
    note: str = ""


def order_or_404(order_id: int, db: Session) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="There is no such order.")
    return order


def order_summary(order: Order) -> dict:
    business = order.business
    return {
        "order_id": order.order_id,
        "status": order.status,
        "status_label": STATUS_LABELS[order.status],
        "city": business.city,
        "employee_count": business.employee_count,
        "num_sites": business.num_sites,
        "monthly_total_inr": order.quote.monthly_total_inr,
        "help_phone": order.help_phone,
        "help_requested_at": order.help_requested_at,
    }


def orders_with_status(statuses: set[str], db: Session) -> list[Order]:
    return list(db.scalars(select(Order).where(Order.status.in_(statuses)).order_by(Order.order_id)))


@router.get("/queue")
def get_queue(db: Session = Depends(get_db)) -> dict:
    """Everything waiting on a person, in one place."""
    reviews = []
    for order in orders_with_status({KYC_REVIEW}, db):
        kyc = build_status(order.business, db)
        reviews.append({**order_summary(order), "documents": kyc.documents, "problems": kyc.problems_across_documents})

    stuck = []
    for order in orders_with_status({NEEDS_ASSISTANCE}, db):
        stuck.append({**order_summary(order), "documents": build_status(order.business, db).documents})

    help_orders = db.scalars(
        select(Order).where(Order.help_requested_at.is_not(None)).order_by(Order.help_requested_at)
    )
    callbacks = db.scalars(
        select(CallbackRequest).where(CallbackRequest.status == "open").order_by(CallbackRequest.callback_id)
    )
    return {
        "kyc_reviews": reviews,
        "documents_not_accepted": stuck,
        "help_requests": [order_summary(order) for order in help_orders],
        "callbacks": [
            {
                "callback_id": callback.callback_id,
                "phone": callback.phone,
                "city": callback.city,
                "segment": callback.segment,
                "employee_count": callback.employee_count,
                "num_sites": callback.num_sites,
                "has_gstin": callback.has_gstin == "Y",
                "needs": callback.needs,
                "reasons": callback.reasons,
                "monthly_estimate_inr": callback.monthly_estimate_inr,
            }
            for callback in callbacks
        ],
        "installations": [
            order_summary(order)
            for order in orders_with_status({INSTALLATION_SCHEDULED, INSTALLATION_IN_PROGRESS}, db)
        ],
    }


@router.post("/orders/{order_id}/kyc-decision")
def decide_kyc(order_id: int, decision: KycDecision, db: Session = Depends(get_db)) -> dict:
    """A person settles a review. Only reviews can be settled, so a cancelled GSTIN cannot be waved through."""
    order = order_or_404(order_id, db)
    if order.status != KYC_REVIEW:
        raise HTTPException(status_code=409, detail="This order is not waiting for a KYC review.")
    note = decision.note.strip()[:300]
    if decision.decision == "reject" and not note:
        raise HTTPException(status_code=422, detail="Add a note telling the owner what to fix.")

    business: Business = order.business
    business.kyc_review_decision = "approved" if decision.decision == "approve" else "rejected"
    business.kyc_review_note = note or None
    db.commit()
    return {"kyc_status": status_after_change(business, db, actor="partner").status, "order_status": order.status}


@router.post("/orders/{order_id}/resolve-help")
def resolve_help(order_id: int, db: Session = Depends(get_db)) -> dict:
    """The phone number was only for this request, so it is deleted when the request closes."""
    order = order_or_404(order_id, db)
    order.help_requested_at = None
    order.help_phone = None
    db.commit()
    return {"order_id": order.order_id, "help_requested": False}


@router.post("/orders/{order_id}/advance")
def advance_installation(order_id: int, db: Session = Depends(get_db)) -> dict:
    order = order_or_404(order_id, db)
    next_status = {INSTALLATION_SCHEDULED: INSTALLATION_IN_PROGRESS, INSTALLATION_IN_PROGRESS: ACTIVATED}.get(order.status)
    if next_status is None:
        raise HTTPException(status_code=409, detail="This order is not waiting on installation.")
    move_order(order, next_status, "partner", db)
    db.commit()
    return {"order_id": order.order_id, "status": order.status}


@router.post("/callbacks/{callback_id}/close")
def close_callback(callback_id: int, db: Session = Depends(get_db)) -> dict:
    """The phone number was only for this call, so it is deleted when the request closes."""
    callback = db.get(CallbackRequest, callback_id)
    if callback is None:
        raise HTTPException(status_code=404, detail="There is no such request.")
    callback.status = "closed"
    callback.phone = None
    db.commit()
    return {"callback_id": callback_id, "status": callback.status}


@router.get("/leads-to-call")
def leads_to_call(limit: int = 20, db: Session = Depends(get_db)) -> list[dict]:
    """Dropped leads a call could win back, most promising first. Unreachable ones are left out."""
    query = (
        select(Lead)
        .where(Lead.outcome == "Dropped", Lead.drop_reason.in_(CALL_ADVICE))
        .order_by(Lead.propensity_pct.desc(), Lead.lead_id)
        .limit(min(max(limit, 1), MAX_LEADS_TO_CALL))
    )
    return [
        {
            "lead_id": lead.lead_id,
            "business_name": lead.business_name,
            "segment": lead.segment,
            "city": lead.city,
            "source": lead.lead_source,
            "stage_reached": lead.stage_reached,
            "drop_reason": lead.drop_reason,
            "score_pct": lead.propensity_pct,
            "score_reasons": lead.score_reasons,
            "advice": CALL_ADVICE[lead.drop_reason],
        }
        for lead in db.scalars(query)
    ]


@router.get("/funnel")
def get_funnel(db: Session = Depends(get_db)) -> dict:
    return funnel_summary(db)
