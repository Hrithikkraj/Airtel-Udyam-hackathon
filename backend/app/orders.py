"""Order API: the tracker the owner checks instead of calling support, plus checkout."""
import os
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .access import get_owned_order
from .database import get_db
from .models import Order, OrderEvent, Product, utc_now
from .schemas import PhoneNumber
from .order_state import (
    ACTIVATED,
    CANCELLED,
    INSTALLATION_IN_PROGRESS,
    INSTALLATION_SCHEDULED,
    KYC_COMPLETE,
    KYC_PENDING,
    KYC_REVIEW,
    NEEDS_ASSISTANCE,
    QUOTE_CONFIRMED,
    move_order,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])

STATUS_LABELS = {
    QUOTE_CONFIRMED: "Quote accepted",
    KYC_PENDING: "Waiting for your documents",
    KYC_REVIEW: "Our team is checking your documents",
    KYC_COMPLETE: "Documents verified",
    NEEDS_ASSISTANCE: "Your documents need attention",
    INSTALLATION_SCHEDULED: "Order placed, installation scheduled",
    INSTALLATION_IN_PROGRESS: "Installation in progress",
    ACTIVATED: "Activated",
    CANCELLED: "Cancelled",
}

# status -> (who acts next, what happens next, what button the owner needs)
NEXT_STEPS = {
    QUOTE_CONFIRMED: ("you", "Verify your business by uploading your documents.", "verify"),
    KYC_PENDING: ("you", "Upload the rest of your documents.", "verify"),
    KYC_REVIEW: ("accel", "Our team is reviewing your documents. A corrected document can settle this sooner.", "verify"),
    KYC_COMPLETE: ("you", "Confirm your order to schedule installation.", "place_order"),
    NEEDS_ASSISTANCE: ("you", "Fix the problem with your documents, or ask our team for help.", "verify"),
    INSTALLATION_SCHEDULED: ("accel", "Our installation partner will come to your site.", None),
    INSTALLATION_IN_PROGRESS: ("accel", "Installation is under way. We will switch on your services next.", None),
    ACTIVATED: ("nobody", "Your services are live. There is nothing more to do.", None),
    CANCELLED: ("nobody", "This order was cancelled.", None),
}

# The steps on the tracker, and the statuses that mean each step has been reached.
TRACKER_STEPS = [
    ("Quote accepted", {QUOTE_CONFIRMED}),
    ("Documents verified", {KYC_COMPLETE}),
    ("Order placed", {INSTALLATION_SCHEDULED}),
    ("Installation started", {INSTALLATION_IN_PROGRESS}),
    ("Activated", {ACTIVATED}),
]
# How many steps are finished at each status.
STEPS_DONE = {
    QUOTE_CONFIRMED: 1,
    KYC_PENDING: 1,
    KYC_REVIEW: 1,
    NEEDS_ASSISTANCE: 1,
    KYC_COMPLETE: 2,
    INSTALLATION_SCHEDULED: 3,
    INSTALLATION_IN_PROGRESS: 4,
    ACTIVATED: 5,
    CANCELLED: 1,
}
CANCELLABLE = {QUOTE_CONFIRMED, KYC_PENDING, KYC_REVIEW, KYC_COMPLETE, NEEDS_ASSISTANCE, INSTALLATION_SCHEDULED}


def demo_mode() -> bool:
    """Lets a demo show installation finishing, since no real partner is connected."""
    return os.getenv("DEMO_MODE", "true").lower() == "true"


class HelpRequest(BaseModel):
    phone: PhoneNumber | None = None  # Used only to call about this request.


class OrderLine(BaseModel):
    product_id: str
    name: str
    quantity: int
    monthly_inr: int
    setup_inr: int


class TrackerStep(BaseModel):
    label: str
    state: str  # done, current or upcoming
    at: datetime | None


class TimelineEntry(BaseModel):
    label: str
    at: datetime


class OrderOut(BaseModel):
    order_id: int
    business_id: int
    has_gstin: bool
    status: str
    status_label: str
    who_acts_next: str
    next_step: str
    next_action: str | None
    can_cancel: bool
    steps: list[TrackerStep]
    timeline: list[TimelineEntry]
    lines: list[OrderLine]
    monthly_total_inr: int
    setup_total_inr: int
    contract_months: int
    install_days: int
    expected_activation: date | None
    help_requested: bool
    demo_mode: bool


def as_utc(moment: datetime) -> datetime:
    # SQLite forgets the time zone. Times are saved in UTC, so the browser must be told that.
    return moment.replace(tzinfo=timezone.utc)


def install_days_for(order: Order, db: Session) -> int:
    """The bundle is ready when its slowest product is ready."""
    ids = [item.product_id for item in order.quote.items]
    products = db.scalars(select(Product).where(Product.product_id.in_(ids))).all()
    return max(product.typical_install_days for product in products)


def build_steps(order: Order, events: list[OrderEvent]) -> list[TrackerStep]:
    done = STEPS_DONE[order.status]
    steps = []
    for index, (label, statuses) in enumerate(TRACKER_STEPS):
        reached_at = [event.created_at for event in events if event.new_status in statuses]
        if index == 0:
            reached_at = [order.created_at]
        if index < done:
            state = "done"
        elif index == done and order.status != CANCELLED:
            state = "current"
        else:
            state = "upcoming"
        steps.append(TrackerStep(label=label, state=state, at=as_utc(reached_at[-1]) if state == "done" and reached_at else None))
    return steps


def build_order_out(order: Order, db: Session) -> OrderOut:
    events = db.scalars(
        select(OrderEvent).where(OrderEvent.order_id == order.order_id).order_by(OrderEvent.event_id)
    ).all()
    products = {
        product.product_id: product
        for product in db.scalars(
            select(Product).where(Product.product_id.in_([item.product_id for item in order.quote.items]))
        )
    }
    who, next_step, action = NEXT_STEPS[order.status]
    return OrderOut(
        order_id=order.order_id,
        business_id=order.business_id,
        has_gstin=order.business.has_gstin == "Y",
        status=order.status,
        status_label=STATUS_LABELS[order.status],
        who_acts_next=who,
        next_step=next_step,
        next_action=action,
        can_cancel=order.status in CANCELLABLE,
        steps=build_steps(order, events),
        timeline=[TimelineEntry(label=STATUS_LABELS.get(event.new_status, event.new_status), at=as_utc(event.created_at)) for event in events],
        lines=[
            OrderLine(
                product_id=item.product_id,
                name=products[item.product_id].product_name,
                quantity=item.quantity,
                # These come from the prices saved with the quote, not today's catalogue.
                monthly_inr=item.unit_price_inr * item.quantity,
                setup_inr=item.unit_setup_inr * item.quantity,
            )
            for item in order.quote.items
        ],
        monthly_total_inr=order.quote.monthly_total_inr,
        setup_total_inr=order.quote.setup_total_inr,
        contract_months=order.quote.contract_months,
        install_days=install_days_for(order, db),
        expected_activation=order.expected_activation,
        help_requested=order.help_requested_at is not None,
        demo_mode=demo_mode(),
    )


@router.get("/{order_id}", response_model=OrderOut)
def get_order(order: Order = Depends(get_owned_order), db: Session = Depends(get_db)):
    return build_order_out(order, db)


@router.post("/{order_id}/place", response_model=OrderOut)
def place_order(order: Order = Depends(get_owned_order), db: Session = Depends(get_db)):
    """Checkout. Verified documents are required here, not only in the browser."""
    if order.status != KYC_COMPLETE:
        raise HTTPException(status_code=409, detail="This order is not ready to be placed. Verify your business first.")
    move_order(order, INSTALLATION_SCHEDULED, "customer", db)
    days = install_days_for(order, db)
    order.expected_activation = (utc_now() + timedelta(days=days)).date()
    db.commit()
    return build_order_out(order, db)


@router.post("/{order_id}/cancel", response_model=OrderOut)
def cancel_order(order: Order = Depends(get_owned_order), db: Session = Depends(get_db)):
    if order.status not in CANCELLABLE:
        raise HTTPException(status_code=409, detail="This order can no longer be cancelled here. Ask our team for help.")
    move_order(order, CANCELLED, "customer", db)
    db.commit()
    return build_order_out(order, db)


@router.post("/{order_id}/help", response_model=OrderOut)
def request_help(
    request: HelpRequest | None = None,
    order: Order = Depends(get_owned_order),
    db: Session = Depends(get_db),
):
    """Puts the order in front of our team. The order stays where it is on its journey."""
    if order.status in {ACTIVATED, CANCELLED}:
        raise HTTPException(status_code=409, detail="This order is closed.")
    if order.help_requested_at is None:
        order.help_requested_at = utc_now()
    if request and request.phone:
        order.help_phone = request.phone
    db.commit()
    return build_order_out(order, db)


@router.post("/{order_id}/demo-advance", response_model=OrderOut)
def demo_advance(order: Order = Depends(get_owned_order), db: Session = Depends(get_db)):
    """Stands in for the installation partner in a demo. Off when DEMO_MODE=false."""
    if not demo_mode():
        raise HTTPException(status_code=403, detail="Demo controls are switched off.")
    next_status = {INSTALLATION_SCHEDULED: INSTALLATION_IN_PROGRESS, INSTALLATION_IN_PROGRESS: ACTIVATED}.get(order.status)
    if next_status is None:
        raise HTTPException(status_code=409, detail="This order is not waiting on installation.")
    move_order(order, next_status, "system", db)
    db.commit()
    return build_order_out(order, db)
