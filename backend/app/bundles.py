"""Bundle API: recommend a bundle, and price one after the owner changes it."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .catalogue import load_catalogue
from .auth import require_signed_in_owner
from .database import get_db
from .explain import explain, plan_explanation
from .pricing import calculate_quote
from .recommend import owner_chosen_plan, recommend
from .rules import check_bundle
from .schemas import BusinessProfile, QuoteOut, QuoteRequest, Recommendation

router = APIRouter(prefix="/api/bundles", tags=["bundles"], dependencies=[Depends(require_signed_in_owner)])


@router.post("/recommend", response_model=Recommendation)
def recommend_bundle(profile: BusinessProfile, db: Session = Depends(get_db)):
    recommendation = recommend(profile, load_catalogue(db))
    recommendation.explanation = explain(profile, recommendation)
    return recommendation


@router.post("/quote", response_model=QuoteOut)
def price_bundle(request: QuoteRequest, db: Session = Depends(get_db)):
    catalogue = load_catalogue(db)
    errors = check_bundle(request.items, request.profile, catalogue)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    return calculate_quote(request.items, catalogue)


@router.post("/plan", response_model=Recommendation)
def owner_plan(request: QuoteRequest, db: Session = Depends(get_db)):
    """A plan the owner built from the rate list. Refused with reasons if it breaks a rule,
    such as CCTV with no connection or a GSTIN-only product for a business without one."""
    catalogue = load_catalogue(db)
    errors = check_bundle(request.items, request.profile, catalogue)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    recommendation = owner_chosen_plan(request.profile, request.items, catalogue)
    recommendation.explanation = plan_explanation(request.profile, recommendation)
    return recommendation
