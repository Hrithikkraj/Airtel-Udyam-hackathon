"""Shop again: ordering more for a business the owner already has, without starting over."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app import explain, kyc, llm
from app.database import SessionLocal
from app.kyc_parse import GST_CERTIFICATE
from app.main import app
from app.models import Business, Consent, KycRecord
from app.order_state import documents_can_change

SHOP = {"employee_count": 3, "city_tier": 1, "has_gstin": True, "segment": "micro"}


def first_order(client, profile=SHOP, items=None):
    body = {
        "profile": profile,
        "items": items or [{"product_id": "P01"}, {"product_id": "P07", "quantity": 2}],
        "business_name": "Sharma Traders",
        "city": "Mumbai",
    }
    response = client.post("/api/quotes", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def order_again(client, business_id, items, profile=SHOP):
    return client.post("/api/quotes", json={"profile": profile, "items": items, "city": "Mumbai", "business_id": business_id})


def verify(business_id):
    """Every document this business needs, already checked, as if the owner had uploaded them."""
    with SessionLocal() as db:
        business = db.get(Business, business_id)
        db.add(Consent(business_id=business_id, purpose=kyc.PURPOSE, notice_version=kyc.NOTICE_VERSION))
        for document_type in kyc.required_documents(business):
            db.add(KycRecord(business_id=business_id, document_type=document_type, status="verified", reasons=[], extracted_fields={}))
        db.commit()
        kyc.status_after_change(business, db)


def other_owner() -> TestClient:
    client = TestClient(app, base_url="https://testserver", headers={"X-Accel-CSRF": "1"})
    details = {"full_name": "Someone Else", "email": f"other-{uuid.uuid4().hex[:8]}@example.com", "password": "correct horse 42"}
    assert client.post("/api/account/signup", json=details).status_code == 201
    return client


# ---------- What the business already has ----------

def test_shop_again_knows_the_business_and_what_it_has(client):
    saved = first_order(client)
    body = client.get(f"/api/shop-again/{saved['business_id']}").json()
    assert body["business_name"] == "Sharma Traders" and body["city"] == "Mumbai"
    assert body["employee_count"] == 3 and body["num_sites"] == 1 and body["has_gstin"] is True
    assert {item["product_id"]: item["quantity"] for item in body["owned"]} == {"P01": 1, "P07": 2}
    assert body["last_order_id"] == saved["order_id"]
    assert body["kyc_verified"] is False
    # The advisor starts from these, so it only needs to ask what the owner wants now.
    answers = body["answers"]
    assert answers["employee_count"] == 3 and answers["city"] == "Mumbai" and answers["segment"] == "micro"
    assert answers["current_internet"] == "business_broadband" and answers["needs"] == []


def test_a_cancelled_order_is_not_counted_as_owned(client):
    saved = first_order(client)
    client.post(f"/api/orders/{saved['order_id']}/cancel")
    assert client.get(f"/api/shop-again/{saved['business_id']}").json()["owned"] == []


def test_another_owner_cannot_shop_for_my_business(client, anonymous):
    saved = first_order(client)
    with other_owner() as stranger:
        assert stranger.get(f"/api/shop-again/{saved['business_id']}").status_code == 403
        assert order_again(stranger, saved["business_id"], [{"product_id": "P01"}]).status_code == 403
    assert anonymous.get(f"/api/shop-again/{saved['business_id']}").status_code == 401


# ---------- A new order for the same business ----------

def test_a_new_order_joins_the_existing_business(client):
    saved = first_order(client)
    again = order_again(client, saved["business_id"], [{"product_id": "P23", "quantity": 4}])
    assert again.status_code == 201, again.text
    assert again.json()["business_id"] == saved["business_id"]
    assert again.json()["order_id"] != saved["order_id"]
    businesses = client.get("/api/account/me").json()["businesses"]
    assert len(businesses) == 1 and len(businesses[0]["orders"]) == 2


def test_cctv_can_join_broadband_the_business_already_has(client):
    saved = first_order(client)
    assert order_again(client, saved["business_id"], [{"product_id": "P23", "quantity": 4}]).status_code == 201
    # A brand-new business still needs a connection in the same bundle.
    assert client.post("/api/quotes", json={"profile": SHOP, "items": [{"product_id": "P23"}]}).status_code == 422


def test_a_browser_cannot_claim_products_it_does_not_have(client):
    claimed = {**SHOP, "owned_product_ids": ["P01"]}
    assert client.post("/api/quotes", json={"profile": claimed, "items": [{"product_id": "P23"}]}).status_code == 422
    assert client.post("/api/bundles/recommend", json=claimed).status_code == 200  # Only a suggestion, never a sale.


def test_a_verified_business_skips_verification(client):
    saved = first_order(client)
    verify(saved["business_id"])
    assert client.post(f"/api/orders/{saved['order_id']}/place").status_code == 200

    again = order_again(client, saved["business_id"], [{"product_id": "P23", "quantity": 2}]).json()
    assert again["order_status"] == "kyc_complete"
    # Straight to checkout, and the tracker says the documents were verified.
    order = client.get(f"/api/orders/{again['order_id']}").json()
    assert order["next_action"] == "place_order"
    assert client.post(f"/api/orders/{again['order_id']}/place").status_code == 200


def test_an_unverified_business_still_verifies(client):
    saved = first_order(client)
    again = order_again(client, saved["business_id"], [{"product_id": "P23"}]).json()
    assert again["order_status"] == "quote_confirmed"
    assert client.post(f"/api/orders/{again['order_id']}/place").status_code == 409


def test_adding_a_gstin_asks_for_the_gst_certificate(client):
    no_gstin = {**SHOP, "has_gstin": False}
    saved = first_order(client, profile=no_gstin)
    verify(saved["business_id"])
    assert client.post(f"/api/orders/{saved['order_id']}/place").status_code == 200

    again = order_again(client, saved["business_id"], [{"product_id": "P23"}], profile=SHOP).json()
    assert again["order_status"] == "kyc_pending"
    status = client.get(f"/api/kyc/{saved['business_id']}/status").json()
    assert status["status"] == "in_progress" and status["steps"][0] == GST_CERTIFICATE
    # The first order is placed, but the new one is waiting, so documents can still be added.
    with SessionLocal() as db:
        assert documents_can_change(saved["business_id"], db)
    # The placed order is not disturbed by the new document request.
    assert client.get(f"/api/orders/{saved['order_id']}").json()["status"] == "installation_scheduled"


def test_documents_stay_locked_when_no_order_is_waiting_for_them(client):
    saved = first_order(client)
    verify(saved["business_id"])
    client.post(f"/api/orders/{saved['order_id']}/place")
    with SessionLocal() as db:
        assert not documents_can_change(saved["business_id"], db)


def test_changed_details_are_saved_on_the_business(client):
    saved = first_order(client)
    bigger = {**SHOP, "employee_count": 9, "num_sites": 2}
    assert order_again(client, saved["business_id"], [{"product_id": "P23"}], profile=bigger).status_code == 201
    body = client.get(f"/api/shop-again/{saved['business_id']}").json()
    assert body["employee_count"] == 9 and body["num_sites"] == 2


# ---------- Reorder ----------

def test_reorder_repeats_the_last_order_at_todays_prices(client):
    saved = first_order(client)
    details = {"employee_count": 3, "num_sites": 1, "city": "Mumbai", "has_gstin": True}
    body = client.post(f"/api/shop-again/{saved['business_id']}/reorder", json=details).json()
    lines = {line["product_id"]: line["quantity"] for line in body["recommendation"]["bundle"]["quote"]["lines"]}
    assert lines == {"P01": 1, "P07": 2}
    assert set(body["recommendation"]["bundle"]["reasons"].values()) == {"Same as your last order"}
    assert body["recommendation"]["chosen_by"] == "owner"
    assert body["profile"]["owned_product_ids"] == ["P01", "P07"]
    # Nothing the business already has is suggested again.
    assert not {"P01", "P07"} & {addon["product_id"] for addon in body["recommendation"]["addons"]}


def test_reorder_follows_the_rules_for_changed_details(client):
    # WhatsApp (P15) needs a GSTIN, so removing the GSTIN rules out repeating this order as it was.
    saved = first_order(client, items=[{"product_id": "P01"}, {"product_id": "P15"}])
    details = {"employee_count": 3, "num_sites": 1, "city": "Mumbai", "has_gstin": False}
    response = client.post(f"/api/shop-again/{saved['business_id']}/reorder", json=details)
    assert response.status_code == 422
    assert "GSTIN" in response.json()["detail"][0]


def test_reorder_needs_an_earlier_order(client):
    saved = first_order(client)
    client.post(f"/api/orders/{saved['order_id']}/cancel")
    details = {"employee_count": 3, "num_sites": 1, "has_gstin": True}
    assert client.post(f"/api/shop-again/{saved['business_id']}/reorder", json=details).status_code == 409


# ---------- The advisor already knows the business ----------

@pytest.fixture
def fake_advisor(monkeypatch):
    calls = []

    def fake_ask(system, messages, shape):
        calls.append(system)
        if shape is explain.ExplanationText:
            raise llm.LLMUnavailable("not an explanation")
        return shape(reply="Got it.", needs=["cctv"], camera_count=4, reply_only=False, language="English")

    monkeypatch.setattr(llm, "ask", fake_ask)
    monkeypatch.setattr(llm, "is_available", lambda: True)
    return calls


def test_advisor_builds_on_what_the_business_has(client, fake_advisor):
    saved = first_order(client)
    answers = client.get(f"/api/shop-again/{saved['business_id']}").json()["answers"]
    body = client.post(
        "/api/advisor/message",
        json={
            "messages": [{"role": "user", "content": "I want 4 CCTV cameras"}],
            "answers": answers,
            "business_id": saved["business_id"],
        },
    ).json()
    # One message was enough: every other detail was already known.
    assert body["recommendation"] is not None
    lines = {line["product_id"] for line in body["recommendation"]["bundle"]["quote"]["lines"]}
    assert lines == {"P23"}  # No second broadband: the business already has one.
    assert body["profile"]["owned_product_ids"] == ["P01", "P07"]
    assert "already has from us: internet, business SIMs" in fake_advisor[0]
    # And the quote can be accepted on the same business.
    again = order_again(client, saved["business_id"], [{"product_id": "P23", "quantity": 4}], profile=body["profile"])
    assert again.status_code == 201


def test_advisor_refuses_a_business_that_is_not_mine(client, fake_advisor):
    saved = first_order(client)
    with other_owner() as stranger:
        response = stranger.post(
            "/api/advisor/message",
            json={"messages": [{"role": "user", "content": "CCTV please"}], "business_id": saved["business_id"]},
        )
    assert response.status_code == 403


@pytest.fixture
def advisor_hears(monkeypatch):
    """The LLM records the business's name and type, as given."""
    def install(name, kind):
        def fake_ask(system, messages, shape):
            if shape is explain.ExplanationText:
                raise llm.LLMUnavailable("not an explanation")
            return shape(reply="Got it.", business_name=name, business_type=kind, reply_only=False, language="English")

        monkeypatch.setattr(llm, "ask", fake_ask)
        monkeypatch.setattr(llm, "is_available", lambda: True)

    return install


def chat_once(client, text):
    return client.post("/api/advisor/message", json={"messages": [{"role": "user", "content": text}]}).json()


def test_advisor_records_the_business_name_and_type(client, advisor_hears):
    advisor_hears("Sharma Traders", "kirana shop")
    answers = chat_once(client, "I run Sharma Traders, a small kirana")["answers"]
    assert answers["business_name"] == "Sharma Traders" and answers["business_type"] == "kirana shop"


def test_advisor_cannot_invent_a_business_name(client, advisor_hears):
    advisor_hears("Gupta Medicals", "pharmacy")
    answers = chat_once(client, "I run a pharmacy")["answers"]
    assert answers["business_name"] is None
    assert answers["business_type"] == "pharmacy"  # The type is only a description, so it is kept.


def test_a_very_long_name_is_trimmed_not_refused(client, advisor_hears):
    long_name = "Sharma " * 40
    advisor_hears(long_name, "shop")
    response = client.post("/api/advisor/message", json={"messages": [{"role": "user", "content": long_name}]})
    assert response.status_code == 200
    assert len(response.json()["answers"]["business_name"]) <= 120


def test_the_name_and_type_are_saved_and_can_be_changed(client):
    body = {"profile": SHOP, "items": [{"product_id": "P01"}], "business_name": "Sharma Traders", "business_type": "kirana shop"}
    saved = client.post("/api/quotes", json=body).json()
    business = client.get("/api/account/me").json()["businesses"][0]
    assert business["business_name"] == "Sharma Traders" and business["business_type"] == "kirana shop"
    assert client.get(f"/api/quotes/for-order/{saved['order_id']}").json()["business_type"] == "kirana shop"
    # Changed on the quote when ordering again, and an empty field keeps what is saved.
    again = {"profile": SHOP, "items": [{"product_id": "P07"}], "business_id": saved["business_id"], "business_name": "Sharma & Sons", "business_type": ""}
    client.post("/api/quotes", json=again)
    business = client.get("/api/account/me").json()["businesses"][0]
    assert business["business_name"] == "Sharma & Sons" and business["business_type"] == "kirana shop"


def test_a_new_business_chat_is_unchanged(client, fake_advisor):
    client.post("/api/advisor/message", json={"messages": [{"role": "user", "content": "I want CCTV"}]})
    assert "already has from us" not in fake_advisor[0]
