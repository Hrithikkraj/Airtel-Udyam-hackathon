"""Who may see what. Every request for an owner's data is checked here, on the server.

An owner proves a business is theirs in one of three ways:
1. the X-Access-Token header (unchanged, for API clients and tests),
2. the HttpOnly order cookie this browser received when the quote was accepted, or
3. being signed in to the account that owns the business.
The last two use cookies, so changes made with them must also carry the CSRF header.
"""
import secrets

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from .auth import order_cookie_name, require_csrf_header, signed_in_user
from .database import get_db
from .models import Business, Order

NO_ACCESS = "You do not have access to this"


def has_access(business: Business | None, token: str) -> bool:
    return business is not None and bool(token) and secrets.compare_digest(business.access_token, token)


def check_access(business: Business | None, request: Request, header_token: str, db: Session):
    if business is None:
        raise HTTPException(status_code=403, detail=NO_ACCESS)
    if has_access(business, header_token):
        return
    cookie_token = request.cookies.get(order_cookie_name(business.business_id), "")
    user = signed_in_user(request, db)
    owns_it = user is not None and business.user_id == user.user_id
    if has_access(business, cookie_token) or owns_it:
        require_csrf_header(request)
        return
    raise HTTPException(status_code=403, detail=NO_ACCESS)


def get_owned_business(
    business_id: int,
    request: Request,
    x_access_token: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Business:
    business = db.get(Business, business_id)
    check_access(business, request, x_access_token, db)
    return business


def get_owned_order(
    order_id: int,
    request: Request,
    x_access_token: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Order:
    order = db.get(Order, order_id)
    check_access(order.business if order else None, request, x_access_token, db)
    return order
