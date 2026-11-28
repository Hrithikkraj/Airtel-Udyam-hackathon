"""Shop again: an owner orders more for a business they already have, without starting over.

The business's details, what it already has from us and its verified documents are all used again:
- the advisor starts from the saved details and only asks what the owner needs now,
- "reorder" copies the last order's products at today's prices, and
- a new order for a verified business skips verification (see quotes.save_quote).

The owner is always asked first whether the saved details are still right. A change to them is saved
on the business only when a new quote is accepted.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from .auth import require_signed_in_owner
from .catalogue import load_catalogue
from .database import get_db
from .explain import plan_explanation
from .kyc import VERIFIED, build_status
from .models import Business, Order, User
from .order_state import CANCELLED, orders_for_business
from .product_stats import load_peer_stats
from .recommend import LEASED_LINES, PRODUCT_FOR_NEED, STANDARD_CONNECTIONS, owner_chosen_plan
from .rules import check_bundle
from .schemas import AdvisorAnswers, BundleItem, BusinessProfile, CurrentInternet, Recommendation

router = APIRouter(prefix="/api/shop-again", tags=["shop again"])

SAME_AS_LAST_ORDER = "Same as your last order"

# What each product is, in the owner's words. Sent to the advisor, which must not name products.
EVERYDAY_WORDS = {
    "mobile_lines": "business SIMs",
    "premium_mobile_lines": "business SIMs with more data",
    "failover": "backup internet",
    "multi_site_management": "a managed network across branches",
    "static_ip": "a fixed IP address",
    "phone_system": "an office phone system",
    "toll_free": "a toll-free number",
    "bulk_sms": "SMS alerts",
    "whatsapp": "a WhatsApp business channel",
    "email_office": "business email",
    "cloud_backup": "cloud backup",
    "website": "a website",
    "pos_billing": "billing and payments",
    "endpoint_security": "antivirus",
    "firewall": "a firewall",
    "guest_wifi": "guest Wi-Fi",
    "cctv": "CCTV cameras",
    "machine_monitoring": "machine sensors",
    "fleet_tracking": "vehicle tracking",
}
NEED_FOR_PRODUCT = {product_id: need for need, product_id in PRODUCT_FOR_NEED.items()}


class OwnedProduct(BaseModel):
    product_id: str
    name: str
    quantity: int


class ShopAgainOut(BaseModel):
    business_id: int
    business_name: str | None
    business_type: str | None
    city: str | None
    employee_count: int
    num_sites: int
    has_gstin: bool
    # Verified documents are used again, so a new order goes straight to checkout.
    kyc_verified: bool
    owned: list[OwnedProduct]  # Everything on this business's orders that are not cancelled.
    last_order_id: int | None
    last_order: list[OwnedProduct]  # What "reorder" copies.
    # The advisor starts from these, so it only needs to ask what the owner wants now.
    answers: AdvisorAnswers


class ReorderRequest(BaseModel):
    """The details the owner confirmed or changed on the "Is this still right?" card."""
    employee_count: int = Field(ge=1, le=100000)
    num_sites: int = Field(ge=1, le=1000)
    city: str | None = Field(default=None, max_length=60)
    has_gstin: bool
    preferred_language: str = Field(default="English", max_length=30)


class ReorderOut(BaseModel):
    profile: BusinessProfile
    recommendation: Recommendation
    city: str | None


def owned_business(business_id: int, user: User, db: Session) -> Business:
    """Only the signed-in owner's own business. Anyone else gets the same answer as a missing one."""
    business = db.get(Business, business_id)
    if business is None or business.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this")
    return business


def live_orders(business: Business, db: Session) -> list[Order]:
    return [order for order in orders_for_business(business.business_id, db) if order.status != CANCELLED]


def owned_quantities(business: Business, db: Session, except_order_id: int | None = None) -> dict[str, int]:
    """What the business has from us, added up over its orders that are not cancelled.
    except_order_id leaves out an order whose quote is being replaced."""
    owned: dict[str, int] = {}
    for order in live_orders(business, db):
        if order.order_id == except_order_id:
            continue
        for item in order.quote.items:
            owned[item.product_id] = owned.get(item.product_id, 0) + item.quantity
    return owned


def owned_product_ids(business: Business, db: Session, except_order_id: int | None = None) -> list[str]:
    return sorted(owned_quantities(business, db, except_order_id))


def owned_in_words(product_ids: list[str]) -> str:
    """For the advisor, such as "internet, business SIMs". No product names."""
    words = []
    for product_id in product_ids:
        if product_id in STANDARD_CONNECTIONS + LEASED_LINES:
            words.append("internet")
        elif product_id in NEED_FOR_PRODUCT:
            words.append(EVERYDAY_WORDS[NEED_FOR_PRODUCT[product_id]])
    return ", ".join(dict.fromkeys(words))


def saved_profile(business: Business, db: Session) -> BusinessProfile | None:
    """The profile behind the latest quote, which knows things the business table does not, such as the segment."""
    for order in reversed(live_orders(business, db)):
        saved = order.quote.accepted_with
        if isinstance(saved, dict):
            try:
                return BusinessProfile(**saved["profile"])
            except (KeyError, TypeError, ValidationError):
                continue
    return None


def saved_answers(business: Business, profile: BusinessProfile | None, owned_ids: list[str]) -> AdvisorAnswers:
    """The advisor's starting answers. Needs are left empty: what the owner wants now is the one question."""
    current_internet: CurrentInternet | None = profile.current_internet if profile else None
    if any(product_id in STANDARD_CONNECTIONS for product_id in owned_ids):
        current_internet = "business_broadband"
    elif any(product_id in LEASED_LINES for product_id in owned_ids):
        current_internet = "leased_line"
    return AdvisorAnswers(
        business_name=business.business_name,
        business_type=business.business_type,
        employee_count=max(1, business.employee_count or 1),
        num_sites=max(1, business.num_sites or 1),
        city=business.city,
        has_gstin=business.has_gstin == "Y",
        fibre_available=profile.fibre_available if profile else None,
        segment=profile.segment if profile else None,
        current_internet=current_internet,
    )


def kyc_verified(business: Business, db: Session) -> bool:
    return build_status(business, db).status == VERIFIED


@router.get("/{business_id}", response_model=ShopAgainOut)
def get_shop_again(business_id: int, user: User = Depends(require_signed_in_owner), db: Session = Depends(get_db)):
    business = owned_business(business_id, user, db)
    catalogue = load_catalogue(db)
    owned = owned_quantities(business, db)
    orders = live_orders(business, db)
    last = orders[-1] if orders else None

    def named(product_id: str, quantity: int) -> OwnedProduct:
        name = catalogue[product_id].name if product_id in catalogue else product_id
        return OwnedProduct(product_id=product_id, name=name, quantity=quantity)

    return ShopAgainOut(
        business_id=business.business_id,
        business_name=business.business_name,
        business_type=business.business_type,
        city=business.city,
        employee_count=max(1, business.employee_count or 1),
        num_sites=max(1, business.num_sites or 1),
        has_gstin=business.has_gstin == "Y",
        kyc_verified=kyc_verified(business, db),
        owned=[named(product_id, quantity) for product_id, quantity in owned.items()],
        last_order_id=last.order_id if last else None,
        last_order=[named(item.product_id, item.quantity) for item in last.quote.items] if last else [],
        answers=saved_answers(business, saved_profile(business, db), sorted(owned)),
    )


@router.post("/{business_id}/reorder", response_model=ReorderOut)
def reorder(
    business_id: int,
    request: ReorderRequest,
    user: User = Depends(require_signed_in_owner),
    db: Session = Depends(get_db),
):
    """The last order's products again, at today's prices, as a quote the owner can still change."""
    from .advisor import list_cities, tier_for_city  # advisor imports this module, so import here.

    business = owned_business(business_id, user, db)
    orders = live_orders(business, db)
    if not orders:
        raise HTTPException(status_code=409, detail="This business has no earlier order to repeat.")
    catalogue = load_catalogue(db)
    items = [
        BundleItem(product_id=item.product_id, quantity=item.quantity)
        for item in orders[-1].quote.items
        if item.product_id in catalogue
    ]
    saved = saved_profile(business, db)
    owned_ids = owned_product_ids(business, db)
    city = (request.city or business.city or "").strip() or None
    profile = BusinessProfile(
        employee_count=request.employee_count,
        num_sites=request.num_sites,
        city_tier=tier_for_city(city, list_cities(db)) if city else (business.city_tier if business.city_tier in (1, 2) else 2),
        has_gstin=request.has_gstin,
        fibre_available=saved.fibre_available if saved else True,
        segment=saved.segment if saved else None,
        current_internet=saved_answers(business, saved, owned_ids).current_internet,
        preferred_language=request.preferred_language,
        owned_product_ids=owned_ids,
    )
    # The same rules as any other quote: a changed GSTIN or city can rule a product out.
    errors = check_bundle(items, profile, catalogue)
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    recommendation = owner_chosen_plan(profile, items, catalogue, load_peer_stats(db))
    if recommendation.bundle:
        recommendation.bundle.reasons = {item.product_id: SAME_AS_LAST_ORDER for item in items}
    recommendation.explanation = plan_explanation(profile, recommendation)
    return ReorderOut(profile=profile, recommendation=recommendation, city=city)
