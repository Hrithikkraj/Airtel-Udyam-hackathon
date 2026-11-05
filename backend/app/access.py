"""Who may see what. Every request for an owner's data is checked here, on the server."""
import secrets

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .database import get_db
from .models import Business, Order

NO_ACCESS = "You do not have access to this"


def has_access(business: Business | None, token: str) -> bool:
    return business is not None and secrets.compare_digest(business.access_token, token)


def get_owned_business(
    business_id: int,
    x_access_token: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Business:
    business = db.get(Business, business_id)
    if not has_access(business, x_access_token):
        raise HTTPException(status_code=403, detail=NO_ACCESS)
    return business


def get_owned_order(
    order_id: int,
    x_access_token: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Order:
    order = db.get(Order, order_id)
    if order is None or not has_access(order.business, x_access_token):
        raise HTTPException(status_code=403, detail=NO_ACCESS)
    return order
