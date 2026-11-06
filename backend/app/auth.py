"""Sign-in sessions, password hashing and the cookies that keep owners signed in.

Security choices, all made here:
- Passwords are hashed with Argon2id (argon2-cffi). The plain password is never stored or logged.
- A session token lives only in an HttpOnly cookie, so page scripts cannot read it.
  The database keeps only a SHA-256 hash of it, so a copied database cannot be used to sign in.
- Each order's access secret also travels in its own HttpOnly cookie instead of browser storage.
- Requests that change data using cookies must carry a custom header. Other websites cannot add
  that header, which blocks cross-site request forgery.
"""
import hashlib
import os
import secrets
import threading
import time
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .database import get_db
from .models import AuthSession, Business, User, utc_now

SESSION_COOKIE = "accel_session"
ORDER_COOKIE_PREFIX = "accel_order_"
CSRF_HEADER = "X-Accel-CSRF"
SESSION_LIFETIME = timedelta(days=30)
ORDER_COOKIE_LIFETIME = timedelta(days=90)

# After this many wrong passwords for one email, sign-in pauses for that email.
MAX_FAILED_SIGN_INS = 5
FAILED_SIGN_IN_WINDOW_SECONDS = 15 * 60

password_hasher = PasswordHasher()
# Checked when an email has no account, so a wrong email takes as long as a wrong password.
UNUSED_HASH = password_hasher.hash("not-a-real-password")

_failed_sign_ins: dict[str, list[float]] = {}
_failed_sign_ins_lock = threading.Lock()


# ---------- Passwords ----------

def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def password_matches(stored_hash: str | None, password: str) -> bool:
    try:
        return password_hasher.verify(stored_hash or UNUSED_HASH, password) and stored_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def too_many_failed_sign_ins(email: str) -> bool:
    cutoff = time.monotonic() - FAILED_SIGN_IN_WINDOW_SECONDS
    with _failed_sign_ins_lock:
        recent = [moment for moment in _failed_sign_ins.get(email, []) if moment > cutoff]
        _failed_sign_ins[email] = recent
        return len(recent) >= MAX_FAILED_SIGN_INS


def record_failed_sign_in(email: str):
    with _failed_sign_ins_lock:
        _failed_sign_ins.setdefault(email, []).append(time.monotonic())


def forget_failed_sign_ins(email: str):
    with _failed_sign_ins_lock:
        _failed_sign_ins.pop(email, None)


# ---------- Cookies ----------

def cookies_are_secure() -> bool:
    """Secure cookies are only sent over HTTPS. Browsers also accept them on http://localhost."""
    return os.getenv("COOKIE_SECURE", "true").lower() == "true"


def set_private_cookie(response: Response, name: str, value: str, lifetime: timedelta, path: str):
    response.set_cookie(
        name,
        value,
        max_age=int(lifetime.total_seconds()),
        path=path,
        httponly=True,
        secure=cookies_are_secure(),
        samesite="lax",
    )


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- Sessions ----------

def start_session(user: User, response: Response, db: Session):
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(user_id=user.user_id, token_hash=token_hash(token), expires_at=utc_now() + SESSION_LIFETIME))
    db.commit()
    set_private_cookie(response, SESSION_COOKIE, token, SESSION_LIFETIME, "/")


def signed_in_user(request: Request, db: Session) -> User | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = db.scalars(select(AuthSession).where(AuthSession.token_hash == token_hash(token))).first()
    if session is None:
        return None
    # SQLite forgets time zones, so both sides are compared without one.
    if session.expires_at.replace(tzinfo=None) <= utc_now().replace(tzinfo=None):
        db.delete(session)
        db.commit()
        return None
    return db.get(User, session.user_id)


def end_session(request: Request, response: Response, db: Session):
    """Signs this browser out: its session ends and its order cookies are removed."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/", secure=cookies_are_secure(), httponly=True, samesite="lax")
    for name in request.cookies:
        if name.startswith(ORDER_COOKIE_PREFIX):
            response.delete_cookie(name, path="/api", secure=cookies_are_secure(), httponly=True, samesite="lax")


# ---------- Order access ----------

def order_cookie_name(business_id: int) -> str:
    return f"{ORDER_COOKIE_PREFIX}{business_id}"


def remember_order(business: Business, response: Response):
    """Lets this browser open the order again later, without keeping the secret in page storage."""
    set_private_cookie(response, order_cookie_name(business.business_id), business.access_token, ORDER_COOKIE_LIFETIME, "/api")


def require_csrf_header(request: Request):
    """Only our own pages can add this header, so a request from another website is refused."""
    if request.method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(status_code=403, detail="This request is missing a security header. Reload the page and try again.")


# ---------- The main journey needs a signed-in owner ----------

SIGN_IN_FIRST = "Sign in to continue."


def require_signed_in_owner(request: Request, db: Session = Depends(get_db)) -> User:
    """Used on every step of the main journey. The browser's sign-in cookie must be valid, and
    any change must also carry the CSRF header, because the cookie alone proves who is asking."""
    user = signed_in_user(request, db)
    if user is None:
        raise HTTPException(status_code=401, detail=SIGN_IN_FIRST)
    require_csrf_header(request)
    return user
