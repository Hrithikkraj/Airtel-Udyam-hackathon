"""Let an owner the advisor could not fully help ask a person to call them."""
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .catalogue import load_catalogue
from .auth import require_signed_in_owner
from .database import get_db
from .models import CallbackRequest
from .recommend import infer_segment, recommend
from .schemas import BusinessProfile, PhoneNumber

router = APIRouter(prefix="/api/callbacks", tags=["callbacks"], dependencies=[Depends(require_signed_in_owner)])

CALLBACK_NOTICE_VERSION = "2026-07-callback-v1"


class CallbackIn(BaseModel):
    phone: PhoneNumber
    profile: BusinessProfile
    city: str | None = None
    agreed_to_be_called: Literal[True]  # A request without this is refused.


@router.post("", status_code=201)
def request_callback(request: CallbackIn, db: Session = Depends(get_db)) -> dict:
    # The reasons are worked out here again, so staff never see text typed into the request.
    profile = request.profile
    recommendation = recommend(profile, load_catalogue(db))
    reasons = list(recommendation.assisted_reasons)
    reasons += [reason for entry in recommendation.not_included for reason in entry.reasons]
    bundle = recommendation.bundle
    callback = CallbackRequest(
        phone=request.phone,
        city=(request.city or "")[:60] or None,
        segment=infer_segment(profile),
        employee_count=profile.employee_count,
        num_sites=profile.num_sites,
        has_gstin="Y" if profile.has_gstin else "N",
        needs=profile.needs,
        reasons=reasons,
        monthly_estimate_inr=bundle.quote.monthly_total_inr if bundle else None,
        notice_version=CALLBACK_NOTICE_VERSION,
    )
    db.add(callback)
    db.commit()
    return {"callback_id": callback.callback_id, "status": callback.status}
