"""Tests for the order journey, checkout and tracker."""
from datetime import date, datetime, timedelta, timezone

import pytest
from test_stage4 import TEXT, small_png

from app import kyc_ocr
from app.database import SessionLocal
from app.models import Order, OrderEvent, Product
from app.order_state import ALLOWED_MOVES, NotAllowedMove, move_order

ALL_STATUSES = set(ALLOWED_MOVES)
SHOP = {"employee_count": 3, "city_tier": 1, "has_gstin": True}
# Fibre 100 (5 days) and CCTV (4 days, needs fibre).
ITEMS = [{"product_id": "P01"}, {"product_id": "P23", "quantity": 2}]


@pytest.fixture
def new_order(client):
    saved = client.post("/api/quotes", json={"profile": SHOP, "items": ITEMS}).json()
    return saved, {"X-Access-Token": saved["access_token"]}


def get_order(client, new_order):
    saved, headers = new_order
    return client.get(f"/api/orders/{saved['order_id']}", headers=headers).json()


def post_order(client, new_order, action):
    saved, headers = new_order
    return client.post(f"/api/orders/{saved['order_id']}/{action}", headers=headers)


def give_consent(client, new_order):
    saved, headers = new_order
    version = client.get("/api/kyc/notice").json()["version"]
    return client.post(f"/api/kyc/{saved['business_id']}/consent", json={"notice_version": version}, headers=headers)


def upload(client, new_order, monkeypatch, document_type, lines=None, sharpness=900.0):
    saved, headers = new_order
    monkeypatch.setattr(kyc_ocr, "read_text", lambda _pixels: [(line, 0.98) for line in (lines or TEXT[document_type])])
    monkeypatch.setattr(kyc_ocr, "sharpness_score", lambda _pixels: sharpness)
    return client.post(
        f"/api/kyc/{saved['business_id']}/documents",
        data={"document_type": document_type},
        files={"file": ("doc.png", small_png(), "image/png")},
        headers=headers,
    )


def verify_everything(client, new_order, monkeypatch):
    give_consent(client, new_order)
    for document_type in TEXT:
        assert upload(client, new_order, monkeypatch, document_type).status_code == 200


# ---------- The rules of the journey ----------

def test_every_move_leads_to_a_known_status():
    for moves in ALLOWED_MOVES.values():
        assert moves <= ALL_STATUSES


def test_activated_and_cancelled_are_final():
    assert ALLOWED_MOVES["activated"] == set()
    assert ALLOWED_MOVES["cancelled"] == set()


@pytest.mark.parametrize(
    "start, target",
    [
        ("quote_confirmed", "activated"),
        ("quote_confirmed", "installation_scheduled"),
        ("kyc_pending", "installation_scheduled"),
        ("kyc_review", "installation_scheduled"),
        ("needs_assistance", "installation_scheduled"),
        ("kyc_complete", "activated"),
        ("installation_scheduled", "activated"),
        ("activated", "cancelled"),
        ("cancelled", "kyc_pending"),
        ("installation_in_progress", "cancelled"),
    ],
)
def test_shortcuts_are_impossible(start, target):
    order = Order(order_id=1, status=start)
    with pytest.raises(NotAllowedMove):
        move_order(order, target, "system", None)
    assert order.status == start


def test_moving_to_the_same_status_adds_no_event(client, new_order):
    saved, _headers = new_order
    with SessionLocal() as db:
        order = db.get(Order, saved["order_id"])
        move_order(order, order.status, "system", db)
        db.commit()
        assert db.query(OrderEvent).filter_by(order_id=saved["order_id"]).count() == 0


# ---------- A new order ----------

def test_accepting_a_quote_creates_an_order(client, new_order):
    order = get_order(client, new_order)
    assert order["status"] == "quote_confirmed"
    assert order["next_action"] == "verify"
    assert order["who_acts_next"] == "you"
    assert order["monthly_total_inr"] == 1099 + 2 * 249
    assert order["setup_total_inr"] == 2 * 1800
    assert order["contract_months"] == 12
    assert order["install_days"] == 5
    assert order["expected_activation"] is None


def test_order_shows_saved_prices_after_a_catalogue_change(client, new_order):
    with SessionLocal() as db:
        product = db.get(Product, "P01")
        old_price = product.price_max_inr_per_month
        product.price_max_inr_per_month = 9999
        db.commit()
    try:
        order = get_order(client, new_order)
        assert next(line for line in order["lines"] if line["product_id"] == "P01")["monthly_inr"] == 1099
    finally:
        with SessionLocal() as db:
            db.get(Product, "P01").price_max_inr_per_month = old_price
            db.commit()


@pytest.mark.parametrize("action", ["place", "cancel", "help", "demo-advance"])
@pytest.mark.parametrize("token", ["", "wrong"])
def test_changing_an_order_needs_the_owners_token(client, new_order, action, token):
    saved, _headers = new_order
    response = client.post(f"/api/orders/{saved['order_id']}/{action}", headers={"X-Access-Token": token})
    assert response.status_code == 403
    assert get_order(client, new_order)["status"] == "quote_confirmed"


def test_reading_an_order_needs_the_owners_token(client, new_order):
    saved, _headers = new_order
    assert client.get(f"/api/orders/{saved['order_id']}").status_code == 403


def test_one_owner_cannot_read_anothers_order(client, new_order):
    saved, _headers = new_order
    other = client.post("/api/quotes", json={"profile": SHOP, "items": ITEMS}).json()
    response = client.get(f"/api/orders/{saved['order_id']}", headers={"X-Access-Token": other["access_token"]})
    assert response.status_code == 403


def test_unknown_order_gives_the_same_answer_as_no_access(client):
    assert client.get("/api/orders/999999", headers={"X-Access-Token": "x"}).status_code == 403


# ---------- KYC moves the order ----------

def test_consent_starts_kyc_on_the_order(client, new_order):
    give_consent(client, new_order)
    assert get_order(client, new_order)["status"] == "kyc_pending"


def test_verified_kyc_lets_the_owner_place_the_order(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    order = get_order(client, new_order)
    assert order["status"] == "kyc_complete"
    assert order["next_action"] == "place_order"


def test_failed_document_asks_for_attention(client, new_order, monkeypatch):
    give_consent(client, new_order)
    lines = ["2025-01-01" if line == "2026-05-30" else line for line in TEXT["address_proof"]]
    upload(client, new_order, monkeypatch, "address_proof", lines=lines)
    assert get_order(client, new_order)["status"] == "needs_assistance"


def test_blurred_document_goes_to_review_then_a_good_one_clears_it(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    upload(client, new_order, monkeypatch, "gst_certificate", sharpness=1.0)
    assert get_order(client, new_order)["status"] == "kyc_review"
    upload(client, new_order, monkeypatch, "gst_certificate")
    assert get_order(client, new_order)["status"] == "kyc_complete"


def test_order_cannot_be_placed_without_verified_documents(client, new_order, monkeypatch):
    assert post_order(client, new_order, "place").status_code == 409
    give_consent(client, new_order)
    assert post_order(client, new_order, "place").status_code == 409
    upload(client, new_order, monkeypatch, "gst_certificate", sharpness=1.0)
    assert post_order(client, new_order, "place").status_code == 409
    assert get_order(client, new_order)["expected_activation"] is None


# ---------- Checkout through to activation ----------

def test_full_journey_reaches_activated(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)

    placed = post_order(client, new_order, "place").json()
    assert placed["status"] == "installation_scheduled"
    assert placed["who_acts_next"] == "accel"
    assert date.fromisoformat(placed["expected_activation"]) == datetime.now(timezone.utc).date() + timedelta(days=5)

    assert post_order(client, new_order, "demo-advance").json()["status"] == "installation_in_progress"
    done = post_order(client, new_order, "demo-advance").json()
    assert done["status"] == "activated"
    assert done["who_acts_next"] == "nobody"
    assert all(step["state"] == "done" for step in done["steps"])
    assert all(step["at"] for step in done["steps"])
    assert [entry["label"] for entry in done["timeline"]][-1] == "Activated"


def test_tracker_marks_the_current_step(client, new_order, monkeypatch):
    order = get_order(client, new_order)
    assert [step["state"] for step in order["steps"]] == ["done", "current", "upcoming", "upcoming", "upcoming"]
    verify_everything(client, new_order, monkeypatch)
    order = get_order(client, new_order)
    assert [step["state"] for step in order["steps"]] == ["done", "done", "current", "upcoming", "upcoming"]


def test_timeline_records_each_change_once_with_a_utc_time(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    timeline = get_order(client, new_order)["timeline"]
    assert [entry["label"] for entry in timeline] == ["Waiting for your documents", "Documents verified"]
    assert timeline[0]["at"].endswith("Z") or timeline[0]["at"].endswith("+00:00")


def test_order_cannot_be_placed_twice(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    first = post_order(client, new_order, "place")
    assert first.status_code == 200
    assert post_order(client, new_order, "place").status_code == 409
    assert get_order(client, new_order)["expected_activation"] == first.json()["expected_activation"]


def test_documents_are_locked_once_the_order_is_placed(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    post_order(client, new_order, "place")
    assert upload(client, new_order, monkeypatch, "gst_certificate", sharpness=1.0).status_code == 409
    assert get_order(client, new_order)["status"] == "installation_scheduled"


def test_withdrawing_consent_after_placing_stops_the_order(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    post_order(client, new_order, "place")
    saved, headers = new_order
    client.delete(f"/api/kyc/{saved['business_id']}/consent", headers=headers)
    assert get_order(client, new_order)["status"] == "needs_assistance"
    assert post_order(client, new_order, "demo-advance").status_code == 409


def test_order_can_restart_after_withdrawal_by_verifying_again(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    post_order(client, new_order, "place")
    saved, headers = new_order
    client.delete(f"/api/kyc/{saved['business_id']}/consent", headers=headers)
    verify_everything(client, new_order, monkeypatch)
    assert get_order(client, new_order)["status"] == "kyc_complete"
    assert post_order(client, new_order, "place").status_code == 200


def test_withdrawing_after_activation_deletes_details_but_keeps_the_service_live(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    post_order(client, new_order, "place")
    post_order(client, new_order, "demo-advance")
    post_order(client, new_order, "demo-advance")
    saved, headers = new_order
    kyc = client.delete(f"/api/kyc/{saved['business_id']}/consent", headers=headers).json()
    assert kyc["documents"] == []
    assert get_order(client, new_order)["status"] == "activated"


# ---------- Cancelling, help and demo controls ----------

def test_owner_can_cancel_before_installation_starts(client, new_order):
    cancelled = post_order(client, new_order, "cancel").json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["can_cancel"] is False
    assert post_order(client, new_order, "place").status_code == 409


def test_cancelled_order_is_not_reopened_by_kyc(client, new_order):
    post_order(client, new_order, "cancel")
    give_consent(client, new_order)
    assert get_order(client, new_order)["status"] == "cancelled"


def test_order_cannot_be_cancelled_once_installation_has_started(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    post_order(client, new_order, "place")
    assert get_order(client, new_order)["can_cancel"] is True
    post_order(client, new_order, "demo-advance")
    assert get_order(client, new_order)["can_cancel"] is False
    assert post_order(client, new_order, "cancel").status_code == 409


def test_asking_for_help_keeps_the_order_where_it_is(client, new_order):
    body = post_order(client, new_order, "help").json()
    assert body["help_requested"] is True
    assert body["status"] == "quote_confirmed"


def test_closed_orders_cannot_ask_for_help(client, new_order):
    post_order(client, new_order, "cancel")
    assert post_order(client, new_order, "help").status_code == 409


def test_demo_controls_cannot_skip_verification(client, new_order):
    assert post_order(client, new_order, "demo-advance").status_code == 409
    assert get_order(client, new_order)["status"] == "quote_confirmed"


def test_demo_controls_can_be_switched_off(client, new_order, monkeypatch):
    verify_everything(client, new_order, monkeypatch)
    post_order(client, new_order, "place")
    monkeypatch.setenv("DEMO_MODE", "false")
    assert get_order(client, new_order)["demo_mode"] is False
    assert post_order(client, new_order, "demo-advance").status_code == 403
    assert get_order(client, new_order)["status"] == "installation_scheduled"

