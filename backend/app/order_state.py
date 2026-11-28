"""The order's journey. Only the moves listed here are possible, whoever asks."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Order, OrderEvent

QUOTE_CONFIRMED = "quote_confirmed"
KYC_PENDING = "kyc_pending"
KYC_REVIEW = "kyc_review"
KYC_COMPLETE = "kyc_complete"
NEEDS_ASSISTANCE = "needs_assistance"
INSTALLATION_SCHEDULED = "installation_scheduled"
INSTALLATION_IN_PROGRESS = "installation_in_progress"
ACTIVATED = "activated"
CANCELLED = "cancelled"

ALLOWED_MOVES = {
    # A repeat order for a business that is already verified goes straight to KYC_COMPLETE.
    QUOTE_CONFIRMED: {KYC_PENDING, KYC_REVIEW, KYC_COMPLETE, NEEDS_ASSISTANCE, CANCELLED},
    KYC_PENDING: {KYC_REVIEW, KYC_COMPLETE, NEEDS_ASSISTANCE, CANCELLED},
    KYC_REVIEW: {KYC_PENDING, KYC_COMPLETE, NEEDS_ASSISTANCE, CANCELLED},
    KYC_COMPLETE: {KYC_PENDING, KYC_REVIEW, NEEDS_ASSISTANCE, INSTALLATION_SCHEDULED, CANCELLED},
    NEEDS_ASSISTANCE: {KYC_PENDING, KYC_REVIEW, KYC_COMPLETE, CANCELLED},
    INSTALLATION_SCHEDULED: {INSTALLATION_IN_PROGRESS, NEEDS_ASSISTANCE, CANCELLED},
    INSTALLATION_IN_PROGRESS: {ACTIVATED, NEEDS_ASSISTANCE},
    ACTIVATED: set(),
    CANCELLED: set(),
}

# After these, documents are locked, because the order has been placed.
ORDER_PLACED_STATUSES = {INSTALLATION_SCHEDULED, INSTALLATION_IN_PROGRESS, ACTIVATED}

# KYC result -> where the order goes.
ORDER_STATUS_FOR_KYC = {
    "not_started": KYC_PENDING,
    "in_progress": KYC_PENDING,
    "needs_review": KYC_REVIEW,
    "verified": KYC_COMPLETE,
    "failed": NEEDS_ASSISTANCE,
}


class NotAllowedMove(Exception):
    """This order cannot make that move from where it is now."""


def move_order(order: Order, new_status: str, actor: str, db: Session):
    """The only way an order's status changes. Each move adds a line to its timeline."""
    if new_status == order.status:
        return
    if new_status not in ALLOWED_MOVES[order.status]:
        raise NotAllowedMove(f"An order cannot move from {order.status} to {new_status}")
    db.add(OrderEvent(order_id=order.order_id, old_status=order.status, new_status=new_status, actor=actor))
    order.status = new_status


def orders_for_business(business_id: int, db: Session) -> list[Order]:
    """Every order of a business, oldest first. A business can order again, so it may have several."""
    return list(db.scalars(select(Order).where(Order.business_id == business_id).order_by(Order.order_id)))


def documents_can_change(business_id: int, db: Session) -> bool:
    """Documents lock once an order is placed, unless a newer order of the same business is still
    waiting for them (an owner who orders again may need to add a document, such as a GST certificate)."""
    orders = orders_for_business(business_id, db)
    if any(order.status not in ORDER_PLACED_STATUSES and order.status != CANCELLED for order in orders):
        return True
    return not any(order.status in ORDER_PLACED_STATUSES for order in orders)


def update_order_after_kyc(business_id: int, kyc_status: str, has_consent: bool, db: Session, actor: str = "system"):
    """Called after every KYC change, so every order's tracker always matches the documents.
    KYC belongs to the business, so one verification covers each order it places."""
    for order in orders_for_business(business_id, db):
        if order.status == CANCELLED or order.status == ACTIVATED:
            continue
        if order.status == QUOTE_CONFIRMED and not has_consent:
            continue
        if order.status in {INSTALLATION_SCHEDULED, INSTALLATION_IN_PROGRESS}:
            # Only withdrawing consent can reach this point, as uploads are locked once placed.
            if not has_consent:
                move_order(order, NEEDS_ASSISTANCE, "customer", db)
            continue
        move_order(order, ORDER_STATUS_FOR_KYC[kyc_status], actor, db)
