"""Account API: sign up, sign in, sign out, and the owner's own profile.

Business details are not copied into the account. They stay in the businesses table, which each
quote already fills in, and are linked to the account. The profile shows them from there.
"""
import re
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .access import has_access
from .auth import (
    end_session,
    forget_failed_sign_ins,
    hash_password,
    order_cookie_name,
    password_matches,
    record_failed_sign_in,
    require_csrf_header,
    require_signed_in_owner,
    start_session,
    too_many_failed_sign_ins,
)
from .database import get_db
from .models import Business, Order, User, utc_now
from .orders import STATUS_LABELS
from .schemas import PhoneNumber

# Every account request must come from our own pages.
router = APIRouter(prefix="/api/account", tags=["account"], dependencies=[Depends(require_csrf_header)])

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
Language = Literal["English", "Hindi"]
WRONG_SIGN_IN = "Email or password is incorrect."


def clean_email(value: str) -> str:
    email = value.strip().lower()
    if not EMAIL_PATTERN.match(email) or len(email) > 254:
        raise ValueError("Enter a valid email address")
    return email


class SignUpIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=80)
    email: str
    phone: PhoneNumber | None = None
    password: str = Field(min_length=8, max_length=128)

    _email = field_validator("email")(clean_email)

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter your name")
        return value.strip()


class SignInIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=80)
    phone: PhoneNumber | None = None
    clear_phone: bool = False
    preferred_language: Language | None = None


class BusinessUpdate(BaseModel):
    business_name: str | None = Field(default=None, max_length=120)
    business_type: str | None = Field(default=None, max_length=80)


class OrderSummary(BaseModel):
    order_id: int
    status: str
    status_label: str
    monthly_total_inr: int
    created_at: datetime


class BusinessOut(BaseModel):
    business_id: int
    business_name: str | None
    business_type: str | None
    city: str | None
    employee_count: int | None
    num_sites: int | None
    has_gstin: bool
    orders: list[OrderSummary]


class ProfileOut(BaseModel):
    user_id: int
    full_name: str
    email: str
    phone: str | None
    preferred_language: str
    created_at: datetime
    businesses: list[BusinessOut]


# The router already checks the CSRF header, so this only needs the sign-in.
require_user = require_signed_in_owner


def build_profile(user: User, db: Session) -> ProfileOut:
    businesses = db.scalars(
        select(Business).where(Business.user_id == user.user_id).order_by(Business.business_id.desc())
    ).all()
    result = []
    for business in businesses:
        orders = db.scalars(select(Order).where(Order.business_id == business.business_id)).all()
        result.append(
            BusinessOut(
                business_id=business.business_id,
                business_name=business.business_name,
                business_type=business.business_type,
                city=business.city,
                employee_count=business.employee_count,
                num_sites=business.num_sites,
                has_gstin=business.has_gstin == "Y",
                orders=[
                    OrderSummary(
                        order_id=order.order_id,
                        status=order.status,
                        status_label=STATUS_LABELS[order.status],
                        monthly_total_inr=order.quote.monthly_total_inr,
                        created_at=order.created_at,
                    )
                    for order in orders
                ],
            )
        )
    return ProfileOut(
        user_id=user.user_id,
        full_name=user.full_name,
        email=user.email,
        phone=user.phone,
        preferred_language=user.preferred_language,
        created_at=user.created_at,
        businesses=result,
    )


@router.post("/signup", response_model=ProfileOut, status_code=201)
def sign_up(details: SignUpIn, response: Response, db: Session = Depends(get_db)):
    if db.scalars(select(User).where(User.email == details.email)).first():
        raise HTTPException(status_code=409, detail="An account with this email already exists. Sign in instead.")
    user = User(
        full_name=details.full_name,
        email=details.email,
        phone=details.phone,
        password_hash=hash_password(details.password),
    )
    db.add(user)
    db.commit()
    start_session(user, response, db)
    return build_profile(user, db)


@router.post("/signin", response_model=ProfileOut)
def sign_in(details: SignInIn, response: Response, db: Session = Depends(get_db)):
    email = details.email.strip().lower()
    if too_many_failed_sign_ins(email):
        raise HTTPException(status_code=429, detail="Too many wrong passwords. Wait 15 minutes, then try again.")
    user = db.scalars(select(User).where(User.email == email)).first()
    # The hash is always checked, so a wrong email and a wrong password look the same from outside.
    if not password_matches(user.password_hash if user else None, details.password):
        record_failed_sign_in(email)
        raise HTTPException(status_code=401, detail=WRONG_SIGN_IN)
    forget_failed_sign_ins(email)
    start_session(user, response, db)
    return build_profile(user, db)


@router.post("/signout", status_code=204)
def sign_out(request: Request, response: Response, db: Session = Depends(get_db)):
    end_session(request, response, db)


@router.get("/me", response_model=ProfileOut)
def get_profile(user: User = Depends(require_user), db: Session = Depends(get_db)):
    return build_profile(user, db)


@router.patch("/me", response_model=ProfileOut)
def update_profile(changes: ProfileUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if changes.full_name is not None:
        if not changes.full_name.strip():
            raise HTTPException(status_code=422, detail="Enter your name.")
        user.full_name = changes.full_name.strip()
    if changes.clear_phone:
        user.phone = None
    elif changes.phone is not None:
        user.phone = changes.phone
    if changes.preferred_language is not None:
        user.preferred_language = changes.preferred_language
    user.updated_at = utc_now()
    db.commit()
    return build_profile(user, db)


@router.patch("/businesses/{business_id}", response_model=ProfileOut)
def update_business(
    business_id: int, changes: BusinessUpdate, user: User = Depends(require_user), db: Session = Depends(get_db)
):
    """Only the name and type can change here. Size, city and GSTIN shaped the quote, so they stay as quoted."""
    business = db.get(Business, business_id)
    if business is None or business.user_id != user.user_id:
        raise HTTPException(status_code=403, detail="You do not have access to this")
    if changes.business_name is not None:
        business.business_name = changes.business_name.strip() or None
    if changes.business_type is not None:
        business.business_type = changes.business_type.strip() or None
    db.commit()
    return build_profile(user, db)


@router.post("/claim/{business_id}", response_model=ProfileOut)
def claim_business(business_id: int, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Adds an order started in this browser before signing in. The order cookie proves it is theirs."""
    business = db.get(Business, business_id)
    cookie_token = request.cookies.get(order_cookie_name(business_id), "")
    if business is None or not has_access(business, cookie_token):
        raise HTTPException(status_code=403, detail="You do not have access to this")
    if business.user_id not in (None, user.user_id):
        raise HTTPException(status_code=403, detail="This order belongs to another account.")
    business.user_id = user.user_id
    db.commit()
    return build_profile(user, db)
