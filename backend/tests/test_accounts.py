"""Accounts: sign up, sign in, sign out, profile, and who can reach whose data."""
import logging
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.auth import CSRF_HEADER, ORDER_COOKIE_PREFIX, SESSION_COOKIE, token_hash
from app.database import SessionLocal
from app.main import app
from app.models import AuthSession, Business, User, utc_now

CSRF = {CSRF_HEADER: "1"}
SHOP = {"employee_count": 3, "city_tier": 1, "has_gstin": True}
PASSWORD = "correct horse 42"


def new_browser() -> TestClient:
    """A separate browser with its own cookie jar. HTTPS, because our cookies are Secure."""
    return TestClient(app, base_url="https://testserver", headers=CSRF)


@pytest.fixture
def browser():
    with new_browser() as client:
        yield client


def unique_email() -> str:
    return f"owner-{uuid.uuid4().hex[:8]}@example.com"


def sign_up(client, email=None, password=PASSWORD, **extra):
    body = {"full_name": "Asha Verma", "email": email or unique_email(), "password": password, **extra}
    return client.post("/api/account/signup", json=body)


def accept_quote(client):
    return client.post("/api/quotes", json={"profile": SHOP, "items": [{"product_id": "P01"}]}).json()


# The test client files cookies for "testserver" under "testserver.local". A cookie planted under any
# other domain is silently never sent, which would make a refusal test pass for the wrong reason.
TEST_COOKIE_DOMAIN = "testserver.local"


def plant_cookie(client, name, value, path="/"):
    client.cookies.set(name, value, domain=TEST_COOKIE_DOMAIN, path=path)
    assert client.cookies.get(name, domain=TEST_COOKIE_DOMAIN, path=path) == value


def set_cookie_header(response, name) -> str:
    return next(value for value in response.headers.get_list("set-cookie") if value.startswith(f"{name}="))


# ---------- Sign up ----------

def test_sign_up_creates_an_account_and_signs_in(browser):
    email = unique_email()
    response = sign_up(browser, email=email, phone="9876543210")
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == email and body["full_name"] == "Asha Verma" and body["phone"] == "9876543210"
    assert browser.get("/api/account/me").json()["email"] == email


def test_password_is_stored_only_as_an_argon2_hash(browser):
    email = unique_email()
    sign_up(browser, email=email)
    with SessionLocal() as db:
        stored = db.query(User).filter_by(email=email).one().password_hash
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored


def test_session_cookie_is_httponly_secure_and_samesite(browser):
    cookie = set_cookie_header(sign_up(browser), SESSION_COOKIE).lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie


def test_only_a_hash_of_the_session_token_is_stored(browser):
    sign_up(browser)
    token = browser.cookies.get(SESSION_COOKIE)
    with SessionLocal() as db:
        assert db.query(AuthSession).filter_by(token_hash=token_hash(token)).count() == 1
        assert db.query(AuthSession).filter_by(token_hash=token).count() == 0


def test_the_password_never_appears_in_responses_or_logs(browser, caplog):
    caplog.set_level(logging.DEBUG)
    response = sign_up(browser, password="unique-secret-xyz-1")
    browser.post("/api/account/signin", json={"email": "nobody@example.com", "password": "unique-secret-xyz-1"})
    assert "unique-secret-xyz-1" not in response.text
    assert "unique-secret-xyz-1" not in caplog.text


def test_email_is_matched_without_case_or_spaces(browser):
    email = unique_email()
    sign_up(browser, email=f"  {email.upper()} ")
    with new_browser() as other:
        assert other.post("/api/account/signin", json={"email": email, "password": PASSWORD}).status_code == 200


def test_the_same_email_cannot_sign_up_twice(browser):
    email = unique_email()
    sign_up(browser, email=email)
    with new_browser() as other:
        response = sign_up(other, email=email.upper())
        assert response.status_code == 409


@pytest.mark.parametrize(
    "changes",
    [
        {"password": "short1"},
        {"password": "x" * 129},
        {"email": "not-an-email"},
        {"full_name": "   "},
        {"phone": "12345"},
    ],
)
def test_bad_sign_up_details_are_refused(browser, changes):
    body = {"full_name": "Asha", "email": unique_email(), "password": PASSWORD, **changes}
    assert browser.post("/api/account/signup", json=body).status_code == 422


# ---------- Sign in and sign out ----------

def test_sign_in_with_the_right_password(browser):
    email = unique_email()
    sign_up(browser, email=email)
    with new_browser() as other:
        assert other.post("/api/account/signin", json={"email": email, "password": PASSWORD}).status_code == 200
        assert other.get("/api/account/me").status_code == 200


def test_wrong_password_and_unknown_email_give_the_same_answer(browser):
    email = unique_email()
    sign_up(browser, email=email)
    with new_browser() as other:
        wrong_password = other.post("/api/account/signin", json={"email": email, "password": "wrong-pass-1"})
        unknown_email = other.post("/api/account/signin", json={"email": unique_email(), "password": PASSWORD})
        assert wrong_password.status_code == unknown_email.status_code == 401
        assert wrong_password.json() == unknown_email.json()
        assert other.get("/api/account/me").status_code == 401


def test_repeated_wrong_passwords_pause_sign_in(browser):
    email = unique_email()
    sign_up(browser, email=email)
    with new_browser() as other:
        for _ in range(auth.MAX_FAILED_SIGN_INS):
            other.post("/api/account/signin", json={"email": email, "password": "wrong-pass-1"})
        paused = other.post("/api/account/signin", json={"email": email, "password": PASSWORD})
        assert paused.status_code == 429
    auth.forget_failed_sign_ins(email)


def test_sign_out_ends_the_session_on_the_server(browser):
    sign_up(browser)
    old_token = browser.cookies.get(SESSION_COOKIE)
    with new_browser() as copy:  # Before sign-out, a copy of the cookie works. This proves the check below is real.
        plant_cookie(copy, SESSION_COOKIE, old_token)
        assert copy.get("/api/account/me").status_code == 200
    assert browser.post("/api/account/signout").status_code == 204
    assert browser.get("/api/account/me").status_code == 401
    # Even a copy of the old cookie no longer works.
    with new_browser() as thief:
        plant_cookie(thief, SESSION_COOKIE, old_token)
        assert thief.get("/api/account/me").status_code == 401


def test_sign_out_also_removes_order_cookies(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    response = browser.post("/api/account/signout")
    removed = [c for c in response.headers.get_list("set-cookie") if c.startswith(f"{ORDER_COOKIE_PREFIX}{saved['business_id']}=")]
    assert removed and "max-age=0" in removed[0].lower()


def test_an_expired_session_is_refused(browser):
    sign_up(browser)
    token = browser.cookies.get(SESSION_COOKIE)
    with SessionLocal() as db:
        session = db.query(AuthSession).filter_by(token_hash=token_hash(token)).one()
        session.expires_at = utc_now() - timedelta(minutes=1)
        db.commit()
    assert browser.get("/api/account/me").status_code == 401


def test_a_made_up_session_cookie_is_refused(browser):
    plant_cookie(browser, SESSION_COOKIE, "made-up")
    assert browser.get("/api/account/me").status_code == 401


# ---------- Profile ----------

def test_profile_can_be_updated(browser):
    sign_up(browser)
    body = browser.patch(
        "/api/account/me", json={"full_name": "Asha V.", "phone": "9123456780", "preferred_language": "Hindi"}
    ).json()
    assert (body["full_name"], body["phone"], body["preferred_language"]) == ("Asha V.", "9123456780", "Hindi")
    assert browser.patch("/api/account/me", json={"clear_phone": True}).json()["phone"] is None


@pytest.mark.parametrize("changes", [{"full_name": ""}, {"phone": "123"}, {"preferred_language": "Klingon"}])
def test_bad_profile_changes_are_refused(browser, changes):
    sign_up(browser)
    assert browser.patch("/api/account/me", json=changes).status_code == 422


def test_profile_cannot_change_email_or_password_hash(browser):
    email = unique_email()
    sign_up(browser, email=email)
    body = browser.patch("/api/account/me", json={"email": "evil@example.com", "password_hash": "x"}).json()
    assert body["email"] == email
    with new_browser() as other:
        assert other.post("/api/account/signin", json={"email": email, "password": PASSWORD}).status_code == 200


def test_profile_needs_sign_in(browser):
    assert browser.get("/api/account/me").status_code == 401
    assert browser.patch("/api/account/me", json={"full_name": "X"}).status_code == 401


def test_an_order_accepted_while_signed_in_appears_on_the_profile(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    businesses = browser.get("/api/account/me").json()["businesses"]
    assert businesses[0]["business_id"] == saved["business_id"]
    assert businesses[0]["orders"][0]["order_id"] == saved["order_id"]
    assert businesses[0]["orders"][0]["monthly_total_inr"] == 1099


def test_business_name_and_type_can_be_updated_but_not_quoted_facts(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    body = browser.patch(
        f"/api/account/businesses/{saved['business_id']}",
        json={"business_name": "Ganesh Woodcraft", "business_type": "Furniture", "employee_count": 999},
    ).json()
    business = body["businesses"][0]
    assert (business["business_name"], business["business_type"]) == ("Ganesh Woodcraft", "Furniture")
    assert business["employee_count"] == 3


# ---------- Who can reach whose data ----------

def test_one_account_cannot_change_another_accounts_business(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    with new_browser() as other:
        sign_up(other)
        response = other.patch(f"/api/account/businesses/{saved['business_id']}", json={"business_name": "Mine now"})
        assert response.status_code == 403
        assert other.get("/api/account/me").json()["businesses"] == []


def test_a_signed_in_owner_reaches_their_order_and_kyc_without_the_token_header(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    browser.cookies.delete(f"{ORDER_COOKIE_PREFIX}{saved['business_id']}")  # Only the account proves ownership now.
    assert browser.get(f"/api/orders/{saved['order_id']}").status_code == 200
    assert browser.get(f"/api/kyc/{saved['business_id']}/status").status_code == 200


def test_another_account_cannot_reach_the_order_or_kyc(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    with new_browser() as other:
        sign_up(other)
        assert other.get(f"/api/orders/{saved['order_id']}").status_code == 403
        assert other.get(f"/api/kyc/{saved['business_id']}/status").status_code == 403
        assert other.post(f"/api/orders/{saved['order_id']}/cancel").status_code == 403


def test_another_browser_cannot_use_a_guessed_or_missing_order_cookie(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    with new_browser() as other:
        assert other.get(f"/api/orders/{saved['order_id']}").status_code == 403
        plant_cookie(other, f"{ORDER_COOKIE_PREFIX}{saved['business_id']}", "guess", path="/api")
        assert other.get(f"/api/orders/{saved['order_id']}").status_code == 403


def test_an_order_cookie_for_one_business_does_not_open_another(browser):
    sign_up(browser)
    first = accept_quote(browser)
    second = accept_quote(browser)
    first_token = browser.cookies.get(f"{ORDER_COOKIE_PREFIX}{first['business_id']}", path="/api")
    with new_browser() as control:  # The real cookie opens its own order, so the refusal below is real.
        plant_cookie(control, f"{ORDER_COOKIE_PREFIX}{first['business_id']}", first_token, path="/api")
        assert control.get(f"/api/orders/{first['order_id']}").status_code == 200
    with new_browser() as other:
        plant_cookie(other, f"{ORDER_COOKIE_PREFIX}{second['business_id']}", first_token, path="/api")
        assert other.get(f"/api/orders/{second['order_id']}").status_code == 403


def test_order_cookie_is_httponly_secure_and_limited_to_the_api(browser):
    sign_up(browser)
    response = browser.post("/api/quotes", json={"profile": SHOP, "items": [{"product_id": "P01"}]})
    cookie = set_cookie_header(response, f"{ORDER_COOKIE_PREFIX}{response.json()['business_id']}").lower()
    assert "httponly" in cookie and "secure" in cookie and "samesite=lax" in cookie and "path=/api" in cookie


def test_the_order_cookie_works_without_the_token_header_or_a_session(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    order_token = browser.cookies.get(f"{ORDER_COOKIE_PREFIX}{saved['business_id']}", path="/api")
    with new_browser() as cookie_only:  # Not signed in, no token header: only the order cookie.
        plant_cookie(cookie_only, f"{ORDER_COOKIE_PREFIX}{saved['business_id']}", order_token, path="/api")
        assert cookie_only.get(f"/api/orders/{saved['order_id']}").status_code == 200


# ---------- Cross-site request forgery ----------

def test_cookie_based_changes_need_the_csrf_header():
    with TestClient(app, base_url="https://testserver") as bare:
        sign_up_body = {"full_name": "A", "email": unique_email(), "password": PASSWORD}
        assert bare.post("/api/account/signup", json=sign_up_body, headers=CSRF).status_code == 201
        quote = {"profile": SHOP, "items": [{"product_id": "P01"}]}
        assert bare.post("/api/quotes", json=quote).status_code == 403  # Signed in, but no CSRF header.
        saved = bare.post("/api/quotes", json=quote, headers=CSRF).json()
        assert bare.get(f"/api/orders/{saved['order_id']}").status_code == 200  # Reading is fine.
        assert bare.post(f"/api/orders/{saved['order_id']}/cancel").status_code == 403
        assert bare.post(f"/api/orders/{saved['order_id']}/cancel", headers=CSRF).status_code == 200


def test_account_requests_need_the_csrf_header():
    with TestClient(app, base_url="https://testserver") as bare:
        body = {"full_name": "A", "email": unique_email(), "password": PASSWORD}
        assert bare.post("/api/account/signup", json=body).status_code == 403
        assert bare.post("/api/account/signup", json=body, headers=CSRF).status_code == 201


def test_the_token_header_still_works_on_its_own_without_csrf(browser):
    # API clients that send the token header are unchanged: a website cannot add that header.
    sign_up(browser)
    saved = accept_quote(browser)
    with TestClient(app, base_url="https://testserver") as api_client:
        headers = {"X-Access-Token": saved["access_token"]}
        assert api_client.post(f"/api/orders/{saved['order_id']}/cancel", headers=headers).status_code == 200


# ---------- Linking an order made before sign-in was required ----------

def older_anonymous_order() -> dict:
    """An order from before sign-in was required. It has no account, only its secret token."""
    import secrets

    from app.models import Order, Quote, QuoteItem

    with SessionLocal() as db:
        business = Business(employee_count=3, num_sites=1, city_tier=1, has_gstin="Y", access_token=secrets.token_urlsafe(32))
        quote = Quote(business=business, status="accepted", monthly_total_inr=1099, setup_total_inr=0, contract_months=12)
        quote.items.append(QuoteItem(product_id="P01", quantity=1, unit_price_inr=1099, unit_setup_inr=0))
        order = Order(business=business, quote=quote, status="quote_confirmed")
        db.add(order)
        db.commit()
        return {"business_id": business.business_id, "order_id": order.order_id, "access_token": business.access_token}


def test_an_older_order_can_be_claimed_with_its_cookie(browser):
    saved = older_anonymous_order()
    plant_cookie(browser, f"{ORDER_COOKIE_PREFIX}{saved['business_id']}", saved["access_token"], path="/api")
    sign_up(browser)
    body = browser.post(f"/api/account/claim/{saved['business_id']}").json()
    assert body["businesses"][0]["business_id"] == saved["business_id"]


def test_an_order_cannot_be_claimed_without_its_cookie(browser):
    saved = older_anonymous_order()
    with new_browser() as other:
        sign_up(other)
        assert other.post(f"/api/account/claim/{saved['business_id']}").status_code == 403


def test_an_order_owned_by_one_account_cannot_be_claimed_by_another(browser):
    sign_up(browser)
    saved = accept_quote(browser)
    order_token = browser.cookies.get(f"{ORDER_COOKIE_PREFIX}{saved['business_id']}", path="/api")
    with new_browser() as other:
        sign_up(other)
        plant_cookie(other, f"{ORDER_COOKIE_PREFIX}{saved['business_id']}", order_token, path="/api")
        assert other.post(f"/api/account/claim/{saved['business_id']}").status_code == 403
    with SessionLocal() as db:
        assert db.get(Business, saved["business_id"]).user_id is not None


def test_an_older_browser_can_move_its_saved_token_into_a_cookie(browser):
    saved = older_anonymous_order()
    with new_browser() as older:
        response = older.post(f"/api/orders/{saved['order_id']}/remember", headers={"X-Access-Token": saved["access_token"]})
        assert response.status_code == 200
        assert older.get(f"/api/orders/{saved['order_id']}").status_code == 200
        assert older.post("/api/orders/999999/remember", headers={"X-Access-Token": "x"}).status_code == 403


def test_an_existing_database_gains_the_new_column_without_losing_data(tmp_path):
    import sqlite3

    from sqlalchemy import create_engine

    from app import database

    path = tmp_path / "old.db"
    with sqlite3.connect(path) as old:
        old.execute("CREATE TABLE businesses (business_id INTEGER PRIMARY KEY, business_name TEXT, access_token TEXT)")
        old.execute("INSERT INTO businesses VALUES (1, 'Kept', 'secret')")
    original = database.engine
    database.engine = create_engine(f"sqlite:///{path}")
    try:
        database.add_later_columns()
        database.add_later_columns()  # Running it again must be harmless.
    finally:
        database.engine.dispose()
        database.engine = original
    with sqlite3.connect(path) as upgraded:
        columns = [row[1] for row in upgraded.execute("PRAGMA table_info(businesses)")]
        assert "user_id" in columns
        assert upgraded.execute("SELECT business_name FROM businesses").fetchone() == ("Kept",)


# ---------- The main journey needs a signed-in owner ----------

QUOTE = {"profile": SHOP, "items": [{"product_id": "P01"}]}
JOURNEY_STEPS = [
    ("post", "/api/quotes", QUOTE),
    ("post", "/api/bundles/recommend", {**SHOP, "needs": ["internet"]}),
    ("post", "/api/bundles/quote", QUOTE),
    ("post", "/api/advisor/message", {"messages": [{"role": "user", "content": "hi"}]}),
    ("post", "/api/callbacks", {"phone": "9876543210", "profile": SHOP, "agreed_to_be_called": True}),
]


@pytest.mark.parametrize("method, path, body", JOURNEY_STEPS)
def test_the_main_journey_refuses_anyone_not_signed_in(browser, method, path, body):
    response = getattr(browser, method)(path, json=body)
    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in to continue."


@pytest.mark.parametrize("method, path, body", [step for step in JOURNEY_STEPS if step[1] != "/api/advisor/message"])
def test_the_main_journey_works_once_signed_in(browser, method, path, body):
    sign_up(browser)
    assert getattr(browser, method)(path, json=body).status_code in (200, 201)


def test_the_advisor_chat_is_open_to_signed_in_owners(browser):
    sign_up(browser)
    # No LLM key in tests, so the chat answers "not available", which means the sign-in check passed.
    assert browser.post("/api/advisor/message", json={"messages": [{"role": "user", "content": "hi"}]}).status_code == 503


def test_a_signed_out_browser_is_refused_again(browser):
    sign_up(browser)
    browser.post("/api/account/signout")
    assert browser.post("/api/quotes", json=QUOTE).status_code == 401


@pytest.mark.parametrize("path", ["/api/catalogue/products", "/api/advisor/cities", "/api/advisor/status", "/api/kyc/notice", "/api/health"])
def test_pages_needed_before_sign_in_stay_public(browser, path):
    assert browser.get(path).status_code == 200


def test_every_new_order_belongs_to_the_signed_in_owner(browser):
    profile = sign_up(browser).json()
    saved = accept_quote(browser)
    with SessionLocal() as db:
        assert db.get(Business, saved["business_id"]).user_id == profile["user_id"]
