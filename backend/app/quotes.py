"""Quote API: save the bundle the owner accepted, and let them look at it again or change it.

An accepted quote can be changed until the order is placed. The change replaces the quote of the
same order and the same business, so documents already uploaded are kept. Once installation is
scheduled, or the order is cancelled, the quote is fixed.
"""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session

from . import product_details
from .access import get_owned_order
from .catalogue import load_catalogue
from .auth import require_signed_in_owner, remember_order, signed_in_user
from .database import get_db
from .explain import explain, plan_explanation
from .kyc import status_after_change
from .models import Business, Order, Quote, QuoteItem
from .order_state import CANCELLED, ORDER_PLACED_STATUSES, QUOTE_CONFIRMED
from .pricing import calculate_quote
from .product_stats import load_peer_stats
from .recommend import assisted_reasons, infer_segment, owner_chosen_plan, recommend, to_recommended_bundle
from .rules import Catalogue, check_bundle
from .schemas import (
    AcceptedQuoteOut,
    BundleItem,
    BusinessProfile,
    QuoteOut,
    QuoteSaved,
    Recommendation,
    SaveQuoteRequest,
)

router = APIRouter(prefix="/api/quotes", tags=["quotes"], dependencies=[Depends(require_signed_in_owner)])

REPLACED = "replaced"


def new_quote(business: Business, quote_out: QuoteOut, request: SaveQuoteRequest, catalogue: Catalogue) -> Quote:
    quote = Quote(
        business=business,
        status="accepted",
        monthly_total_inr=quote_out.monthly_total_inr,
        setup_total_inr=quote_out.setup_total_inr,
        contract_months=quote_out.contract_months,
        accepted_with={"profile": request.profile.model_dump(mode="json"), "chosen_by": request.chosen_by},
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
    return quote


def checked_quote(request: SaveQuoteRequest, catalogue: Catalogue) -> QuoteOut:
    # Check and price again here, because the browser's copy can never be trusted.
    errors = check_bundle(request.items, request.profile, catalogue)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    return calculate_quote(request.items, catalogue)


@router.post("", response_model=QuoteSaved, status_code=201)
def save_quote(request: SaveQuoteRequest, http_request: Request, response: Response, db: Session = Depends(get_db)):
    catalogue = load_catalogue(db)
    quote_out = checked_quote(request, catalogue)

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
    # Every order belongs to the signed-in owner, so it shows on their profile on any device.
    business.user_id = signed_in_user(http_request, db).user_id
    quote = new_quote(business, quote_out, request, catalogue)
    # Accepting a quote starts the order, so the tracker works from this moment.
    order = Order(business=business, quote=quote, status=QUOTE_CONFIRMED)
    db.add(order)
    db.commit()
    remember_order(business, response)
    return QuoteSaved(
        quote_id=quote.quote_id,
        order_id=order.order_id,
        business_id=business.business_id,
        access_token=business.access_token,
        status=quote.status,
        quote=quote_out,
    )


# ---------- Looking at an accepted quote again, and changing it ----------

def can_change(order: Order) -> bool:
    return order.status != CANCELLED and order.status not in ORDER_PLACED_STATUSES


def refuse_if_fixed(order: Order):
    if order.status == CANCELLED:
        raise HTTPException(status_code=409, detail="This order was cancelled. Start a new bundle instead.")
    if order.status in ORDER_PLACED_STATUSES:
        raise HTTPException(
            status_code=409,
            detail="Your order has been placed, so its quote can no longer be changed here. Ask our team for help.",
        )


def saved_profile(order: Order) -> tuple[BusinessProfile, str]:
    """The profile the quote was accepted with, and who built it."""
    saved = order.quote.accepted_with
    if isinstance(saved, dict):
        try:
            chosen_by = saved.get("chosen_by") if saved.get("chosen_by") in ("advisor", "owner") else "advisor"
            return BusinessProfile(**saved["profile"]), chosen_by
        except (KeyError, TypeError, ValidationError):
            pass
    # A quote saved before this was recorded. We do not know what was asked for, so it is shown as
    # the owner's own plan, which only states facts about each product.
    business = order.business
    profile = BusinessProfile(
        employee_count=max(1, business.employee_count or 1),
        num_sites=max(1, business.num_sites or 1),
        city_tier=business.city_tier if business.city_tier in (1, 2) else 2,
        has_gstin=business.has_gstin == "Y",
        preferred_language=(business.preferred_language or "English")[:30],
    )
    return profile, "owner"


def items_key(lines) -> list[tuple[str, int]]:
    return sorted((line.product_id, line.quantity) for line in lines)


def rebuilt_recommendation(order: Order, db: Session) -> tuple[BusinessProfile, Recommendation]:
    """The accepted bundle as the quote page shows it, with the other options the owner had."""
    catalogue = load_catalogue(db)
    peer_stats = load_peer_stats(db)
    profile, chosen_by = saved_profile(order)
    items = [
        BundleItem(product_id=item.product_id, quantity=item.quantity)
        for item in order.quote.items
        if item.product_id in catalogue
    ]

    if chosen_by == "owner":
        recommendation = owner_chosen_plan(profile, items, catalogue, peer_stats)
        recommendation.explanation = plan_explanation(profile, recommendation)
        return profile, recommendation

    recommendation = recommend(profile, catalogue, peer_stats)
    accepted_key = items_key(items)
    if recommendation.bundle is None or items_key(recommendation.bundle.quote.lines) != accepted_key:
        # The owner changed our suggestion before accepting it. Show what they accepted, and keep
        # our suggestion as another option they can switch back to.
        segment = infer_segment(profile)
        assumed_internet = not profile.needs
        explained_profile = profile.model_copy(update={"needs": ["internet"]}) if assumed_internet else profile
        accepted = to_recommended_bundle(
            items, explained_profile, segment, catalogue, peer_stats,
            is_alternative=True, assumed_internet=assumed_internet,
        )
        others = [
            bundle
            for bundle in [recommendation.bundle, *recommendation.alternatives]
            if bundle is not None and items_key(bundle.quote.lines) != accepted_key
        ][:2]
        accepted_ids = {item.product_id for item in items}
        addons = []
        for addon in recommendation.addons:
            if addon.product_id in accepted_ids:
                continue
            # The add-on's effect on the bill is worked out again against what was accepted.
            addon.detail = product_details.build_addon_detail(
                BundleItem(product_id=addon.product_id, quantity=addon.quantity), explained_profile, segment, items,
                catalogue, peer_stats, profile.preferred_language, was_cut="budget" in addon.reason,
            )
            addons.append(addon)
        budget = profile.budget_monthly_inr
        over_budget = bool(budget is not None and accepted.quote.monthly_total_inr > budget)
        recommendation = recommendation.model_copy(
            update={
                "bundle": accepted,
                "alternatives": others,
                "addons": addons,
                "over_budget": over_budget,
                "assisted_reasons": assisted_reasons(profile, items, over_budget),
            }
        )
    recommendation.explanation = explain(profile, recommendation)
    return profile, recommendation


@router.get("/for-order/{order_id}", response_model=AcceptedQuoteOut)
def get_accepted_quote(order: Order = Depends(get_owned_order), db: Session = Depends(get_db)):
    """The quote behind an order, so the owner can go back to it from any later step."""
    profile, recommendation = rebuilt_recommendation(order, db)
    return AcceptedQuoteOut(
        profile=profile,
        recommendation=recommendation,
        city=order.business.city,
        can_change=can_change(order),
    )


@router.put("/for-order/{order_id}", response_model=QuoteSaved)
def replace_accepted_quote(request: SaveQuoteRequest, order: Order = Depends(get_owned_order), db: Session = Depends(get_db)):
    """Replaces the quote of an order that is not placed yet. Same order, same business, same documents."""
    refuse_if_fixed(order)
    catalogue = load_catalogue(db)
    quote_out = checked_quote(request, catalogue)

    profile = request.profile
    business = order.business
    gstin_before = business.has_gstin
    business.employee_count = profile.employee_count
    business.num_sites = profile.num_sites
    business.city_tier = profile.city_tier
    business.has_gstin = "Y" if profile.has_gstin else "N"
    business.preferred_language = profile.preferred_language
    if request.city is not None:
        business.city = request.city
    if request.business_name is not None:
        business.business_name = request.business_name

    order.quote.status = REPLACED  # Kept, so the history of what was accepted is not lost.
    quote = new_quote(business, quote_out, request, catalogue)
    order.quote = quote
    db.commit()
    if business.has_gstin != gstin_before:
        # The documents this business needs changed (the GST certificate), so the tracker must follow.
        status_after_change(business, db)
    return QuoteSaved(
        quote_id=quote.quote_id,
        order_id=order.order_id,
        business_id=business.business_id,
        access_token=business.access_token,
        status=quote.status,
        quote=quote_out,
    )
