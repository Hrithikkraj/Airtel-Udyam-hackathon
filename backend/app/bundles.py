"""Bundle API: recommend a bundle, and price one after the owner changes it."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .catalogue import load_catalogue
from .database import get_db
from .explain import explain
from .pricing import calculate_quote
from .recommend import recommend
from .rules import check_bundle
from .schemas import BusinessProfile, QuoteOut, QuoteRequest, Recommendation

router = APIRouter(prefix="/api/bundles", tags=["bundles"])


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
