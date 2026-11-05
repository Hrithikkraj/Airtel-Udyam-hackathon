"""Quote API: save the bundle the owner accepted."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .catalogue import load_catalogue
from .database import get_db
from .models import Business, Order, Quote, QuoteItem
from .order_state import QUOTE_CONFIRMED
from .pricing import calculate_quote
from .rules import check_bundle
from .schemas import QuoteSaved, SaveQuoteRequest

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


@router.post("", response_model=QuoteSaved, status_code=201)
def save_quote(request: SaveQuoteRequest, db: Session = Depends(get_db)):
    # Check and price again here, because the browser's copy can never be trusted.
    catalogue = load_catalogue(db)
    errors = check_bundle(request.items, request.profile, catalogue)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    quote_out = calculate_quote(request.items, catalogue)

    profile = request.profile
    business = Business(
        business_name=request.business_name,
        employee_count=profile.employee_count,
        num_sites=profile.num_sites,
        city=request.city,
        city_tier=profile.city_tier,
        has_gstin="Y" if profile.has_gstin else "N",
        preferred_language=profile.preferred_language,
        access_token=secrets.token_urlsafe(32),
    )
    quote = Quote(
        business=business,
        status="accepted",
        monthly_total_inr=quote_out.monthly_total_inr,
        setup_total_inr=quote_out.setup_total_inr,
        contract_months=quote_out.contract_months,
    )
    for line in quote_out.lines:
        # Prices are copied, so a later catalogue change cannot alter an accepted quote.
        quote.items.append(
            QuoteItem(
                product_id=line.product_id,
                quantity=line.quantity,
                unit_price_inr=line.unit_price_inr,
                unit_setup_inr=catalogue[line.product_id].setup_fee_inr,
            )
        )
    # Accepting a quote starts the order, so the tracker works from this moment.
    order = Order(business=business, quote=quote, status=QUOTE_CONFIRMED)
    db.add(order)
    db.commit()
    return QuoteSaved(
        quote_id=quote.quote_id,
        order_id=order.order_id,
        business_id=business.business_id,
        access_token=business.access_token,
        status=quote.status,
        quote=quote_out,
    )
