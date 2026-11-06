"""Tests for the staff view, KYC review decisions, callbacks, the funnel and the lead score."""
import pytest
from test_stage4 import TEXT, small_png

from app import kyc_ocr
from app.database import SessionLocal
from app.import_data import DATA_DIR
from app.lead_score import CATEGORY_INPUTS, NUMBER_INPUTS, measure_quality
from app.models import CallbackRequest, Lead, Order
from app.staff import CALL_ADVICE, DEMO_STAFF_KEY

STAFF = {"X-Staff-Key": DEMO_STAFF_KEY}
SHOP = {"employee_count": 3, "city_tier": 1, "has_gstin": True}
ITEMS = [{"product_id": "P01"}]
GOOD_PHONE = "9876543210"


@pytest.fixture
def new_order(client):
    saved = client.post("/api/quotes", json={"profile": SHOP, "items": ITEMS}).json()
    return saved, {"X-Access-Token": saved["access_token"]}


def order_status(client, new_order):
    saved, headers = new_order
    return client.get(f"/api/orders/{saved['order_id']}", headers=headers).json()["status"]


def kyc_status(client, new_order):
    saved, headers = new_order
    return client.get(f"/api/kyc/{saved['business_id']}/status", headers=headers).json()


def upload_all(client, new_order, monkeypatch, blurred=None):
    saved, headers = new_order
    version = client.get("/api/kyc/notice").json()["version"]
    client.post(f"/api/kyc/{saved['business_id']}/consent", json={"notice_version": version}, headers=headers)
    for document_type, lines in TEXT.items():
        sharpness = 1.0 if document_type == blurred else 900.0
        monkeypatch.setattr(kyc_ocr, "read_text", lambda _p, lines=lines: [(line, 0.98) for line in lines])
        monkeypatch.setattr(kyc_ocr, "sharpness_score", lambda _p, value=sharpness: value)
        client.post(
            f"/api/kyc/{saved['business_id']}/documents",
            data={"document_type": document_type},
            files={"file": ("doc.png", small_png(), "image/png")},
            headers=headers,
        )


def decide(client, new_order, decision, note=""):
    return client.post(
        f"/api/staff/orders/{new_order[0]['order_id']}/kyc-decision",
        json={"decision": decision, "note": note},
        headers=STAFF,
    )


# ---------- Staff access ----------

PATHS = [
    ("get", "/api/staff/queue"),
    ("get", "/api/staff/funnel"),
    ("get", "/api/staff/leads-to-call"),
    ("post", "/api/staff/orders/1/resolve-help"),
    ("post", "/api/staff/orders/1/advance"),
    ("post", "/api/staff/callbacks/1/close"),
]


@pytest.mark.parametrize("method, path", PATHS)
def test_staff_pages_refuse_a_missing_or_wrong_key(client, method, path):
    assert getattr(client, method)(path).status_code == 403
    assert getattr(client, method)(path, headers={"X-Staff-Key": "wrong"}).status_code == 403


def test_an_owners_token_does_not_open_staff_pages(client, new_order):
    assert client.get("/api/staff/queue", headers=new_order[1]).status_code == 403


def test_a_staff_key_does_not_open_an_owners_order(anonymous, new_order):
    saved, _ = new_order
    assert anonymous.get(f"/api/orders/{saved['order_id']}", headers=STAFF).status_code == 403


def test_built_in_key_stops_working_outside_demo_mode(client, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "false")
    monkeypatch.delenv("STAFF_KEY", raising=False)
    assert client.get("/api/staff/queue", headers=STAFF).status_code == 403


def test_configured_key_replaces_the_built_in_key(client, monkeypatch):
    monkeypatch.setenv("STAFF_KEY", "real-secret")
    assert client.get("/api/staff/queue", headers=STAFF).status_code == 403
    assert client.get("/api/staff/queue", headers={"X-Staff-Key": "real-secret"}).status_code == 200


# ---------- KYC review ----------

def test_review_appears_in_the_queue_with_masked_details(client, new_order, monkeypatch):
    upload_all(client, new_order, monkeypatch, blurred="address_proof")
    queue = client.get("/api/staff/queue", headers=STAFF).json()
    review = next(r for r in queue["kyc_reviews"] if r["order_id"] == new_order[0]["order_id"])
    assert any("blurred" in reason for document in review["documents"] for reason in document["reasons"])
    assert "27XUIXG0767D1ZP" not in str(review)
    assert "D1ZP" in str(review)


def test_approving_a_review_lets_the_owner_place_the_order(client, new_order, monkeypatch):
    upload_all(client, new_order, monkeypatch, blurred="address_proof")
    assert order_status(client, new_order) == "kyc_review"
    body = decide(client, new_order, "approve").json()
    assert body == {"kyc_status": "verified", "order_status": "kyc_complete"}
    assert order_status(client, new_order) == "kyc_complete"


def test_the_timeline_records_a_partner_made_the_decision(client, new_order, monkeypatch):
    from app.models import OrderEvent

    upload_all(client, new_order, monkeypatch, blurred="address_proof")
    decide(client, new_order, "approve")
    with SessionLocal() as db:
        last = db.query(OrderEvent).filter_by(order_id=new_order[0]["order_id"]).order_by(OrderEvent.event_id.desc()).first()
        assert (last.new_status, last.actor) == ("kyc_complete", "partner")


def test_rejecting_needs_a_note_and_the_owner_sees_it(client, new_order, monkeypatch):
    upload_all(client, new_order, monkeypatch, blurred="address_proof")
    assert decide(client, new_order, "reject").status_code == 422
    assert decide(client, new_order, "reject", "   ").status_code == 422
    assert order_status(client, new_order) == "kyc_review"

    assert decide(client, new_order, "reject", "Please send this month's bill").status_code == 200
    assert order_status(client, new_order) == "needs_assistance"
    assert kyc_status(client, new_order)["review_note"] == "Please send this month's bill"


def test_uploading_again_clears_an_earlier_decision(client, new_order, monkeypatch):
    upload_all(client, new_order, monkeypatch, blurred="address_proof")
    decide(client, new_order, "approve")
    saved, headers = new_order
    monkeypatch.setattr(kyc_ocr, "read_text", lambda _p: [(line, 0.98) for line in TEXT["gst_certificate"]])
    monkeypatch.setattr(kyc_ocr, "sharpness_score", lambda _p: 1.0)
    client.post(
        f"/api/kyc/{saved['business_id']}/documents",
        data={"document_type": "gst_certificate"},
        files={"file": ("doc.png", small_png(), "image/png")},
        headers=headers,
    )
    assert order_status(client, new_order) == "kyc_review"


def test_withdrawing_consent_clears_an_earlier_decision(client, new_order, monkeypatch):
    upload_all(client, new_order, monkeypatch, blurred="address_proof")
    decide(client, new_order, "reject", "Fix it")
    saved, headers = new_order
    assert client.delete(f"/api/kyc/{saved['business_id']}/consent", headers=headers).json()["review_note"] is None


def test_a_failed_document_cannot_be_approved(client, new_order, monkeypatch):
    saved, headers = new_order
    version = client.get("/api/kyc/notice").json()["version"]
    client.post(f"/api/kyc/{saved['business_id']}/consent", json={"notice_version": version}, headers=headers)
    lines = ["2025-01-01" if line == "2026-05-30" else line for line in TEXT["address_proof"]]
    monkeypatch.setattr(kyc_ocr, "read_text", lambda _p: [(line, 0.98) for line in lines])
    monkeypatch.setattr(kyc_ocr, "sharpness_score", lambda _p: 900.0)
    client.post(
        f"/api/kyc/{saved['business_id']}/documents",
        data={"document_type": "address_proof"},
        files={"file": ("doc.png", small_png(), "image/png")},
        headers=headers,
    )
    assert order_status(client, new_order) == "needs_assistance"
    assert decide(client, new_order, "approve").status_code == 409
    assert order_status(client, new_order) == "needs_assistance"


def test_a_decision_on_an_order_with_no_review_is_refused(client, new_order):
    assert decide(client, new_order, "approve").status_code == 409


def test_unknown_order_gives_not_found(client):
    assert client.post("/api/staff/orders/999999/advance", headers=STAFF).status_code == 404


# ---------- Help requests ----------

def test_help_request_reaches_staff_and_closing_deletes_the_number(client, new_order):
    saved, headers = new_order
    order_id = saved["order_id"]
    client.post(f"/api/orders/{order_id}/help", json={"phone": GOOD_PHONE}, headers=headers)
    queue = client.get("/api/staff/queue", headers=STAFF).json()
    assert any(h["order_id"] == order_id and h["help_phone"] == GOOD_PHONE for h in queue["help_requests"])

    client.post(f"/api/staff/orders/{order_id}/resolve-help", headers=STAFF)
    queue = client.get("/api/staff/queue", headers=STAFF).json()
    assert not any(h["order_id"] == order_id for h in queue["help_requests"])
    with SessionLocal() as db:
        assert db.get(Order, order_id).help_phone is None


@pytest.mark.parametrize("phone", ["123", "12345678901", "abcdefghij", "1234567890"])
def test_help_request_refuses_a_bad_phone_number(client, new_order, phone):
    saved, headers = new_order
    assert client.post(f"/api/orders/{saved['order_id']}/help", json={"phone": phone}, headers=headers).status_code == 422


# ---------- Installations ----------

def test_partner_can_move_a_placed_order_to_activated(client, new_order, monkeypatch):
    upload_all(client, new_order, monkeypatch)
    saved, headers = new_order
    client.post(f"/api/orders/{saved['order_id']}/place", headers=headers)
    assert client.post(f"/api/staff/orders/{saved['order_id']}/advance", headers=STAFF).json()["status"] == "installation_in_progress"
    assert client.post(f"/api/staff/orders/{saved['order_id']}/advance", headers=STAFF).json()["status"] == "activated"
    assert order_status(client, new_order) == "activated"
    assert client.post(f"/api/staff/orders/{saved['order_id']}/advance", headers=STAFF).status_code == 409


def test_partner_cannot_skip_verification(client, new_order):
    assert client.post(f"/api/staff/orders/{new_order[0]['order_id']}/advance", headers=STAFF).status_code == 409
    assert order_status(client, new_order) == "quote_confirmed"


# ---------- Callbacks: leads the advisor could not close ----------

BIG_CHAIN = {"employee_count": 100, "num_sites": 12, "city_tier": 1, "has_gstin": True, "needs": ["internet", "whatsapp"]}


def callback(client, **changes):
    body = {"phone": GOOD_PHONE, "profile": BIG_CHAIN, "city": "Pune", "agreed_to_be_called": True, **changes}
    return client.post("/api/callbacks", json=body)


def test_callback_reaches_staff_with_reasons_from_our_own_rules(client):
    assert callback(client).status_code == 201
    entry = client.get("/api/staff/queue", headers=STAFF).json()["callbacks"][-1]
    assert entry["phone"] == GOOD_PHONE
    assert any("sites" in reason for reason in entry["reasons"])
    assert entry["monthly_estimate_inr"] > 0


def test_callback_needs_agreement_and_a_valid_number(client):
    assert callback(client, agreed_to_be_called=False).status_code == 422
    assert callback(client, phone="123").status_code == 422


def test_callback_cannot_inject_its_own_reasons(client):
    callback(client, reasons=["<script>alert(1)</script>"])
    entry = client.get("/api/staff/queue", headers=STAFF).json()["callbacks"][-1]
    assert "script" not in str(entry["reasons"])


def test_closing_a_callback_deletes_the_number(client):
    callback_id = callback(client).json()["callback_id"]
    client.post(f"/api/staff/callbacks/{callback_id}/close", headers=STAFF)
    open_ids = [c["callback_id"] for c in client.get("/api/staff/queue", headers=STAFF).json()["callbacks"]]
    assert callback_id not in open_ids
    with SessionLocal() as db:
        assert db.get(CallbackRequest, callback_id).phone is None


# ---------- Funnel ----------

@pytest.fixture
def funnel(client):
    return client.get("/api/staff/funnel", headers=STAFF).json()


def test_funnel_matches_the_case_figures(funnel):
    counts = {stage["stage"]: stage["count"] for stage in funnel["stages"]}
    assert counts == {
        "Lead": 5000, "Contacted": 3406, "Needs assessed": 1974,
        "Quote accepted": 861, "KYC complete": 588, "Activated": 368,
    }
    percents = [stage["pct_of_previous"] for stage in funnel["stages"]]
    assert [round(p) for p in percents[1:]] == [68, 58, 44, 68, 63]


def test_funnel_kpis_match_the_case_figures(funnel):
    kpis = funnel["kpis"]
    assert kpis["lead_to_activation_pct"] == 7.36
    assert kpis["average_days_to_activate"] == 17.6
    assert kpis["follow_up_calls"] == 3.0
    assert 15000 <= kpis["cost_per_activation_inr"] <= 15100


def test_cost_per_activation_includes_leads_that_never_activated(funnel):
    micro = next(s for s in funnel["by_segment"] if s["name"] == "Micro retail & services")
    assert micro["activated"] == 110
    assert micro["cost_per_activation_inr"] == 20007
    field = next(s for s in funnel["by_source"] if s["name"] == "Field sales")
    assert field["cost_per_activation_inr"] == 24335


def test_drop_reasons_explain_every_lost_lead(funnel):
    lost_by_stage = {row["stage"]: row["total"] for row in funnel["drop_reasons"]}
    assert lost_by_stage == {
        "Lead": 1594, "Contacted": 1432, "Needs assessed": 1113, "Quote accepted": 273, "KYC complete": 220,
    }
    for row in funnel["drop_reasons"]:
        assert sum(reason["count"] for reason in row["reasons"]) == row["total"]


def test_funnel_counts_bundles_that_broke_catalogue_rules(funnel):
    assert funnel["bundles_breaking_rules"] == 48
    assert funnel["activated_bundles"] == 368


# ---------- Lead score ----------

def test_score_only_uses_facts_known_when_a_lead_arrives():
    used = set(CATEGORY_INPUTS + NUMBER_INPUTS)
    for later_fact in ["stage_reached", "drop_reason", "acquisition_cost_inr", "customer_follow_up_calls", "preferred_language", "city", "contact_name"]:
        assert later_fact not in used


def test_score_beats_chance_on_leads_it_has_not_seen():
    quality = measure_quality(str(DATA_DIR / "smb_leads.csv"))
    assert quality["auc"] >= 0.65
    assert quality["top_fifth_activation_pct"] > quality["all_leads_activation_pct"]


def test_every_lead_gets_a_score():
    with SessionLocal() as db:
        scores = [lead.propensity_pct for lead in db.query(Lead).limit(200)]
    assert all(score is not None and 0 <= score <= 100 for score in scores)


def test_call_list_is_ordered_and_explains_itself(client):
    leads = client.get("/api/staff/leads-to-call?limit=20", headers=STAFF).json()
    assert len(leads) == 20
    scores = [lead["score_pct"] for lead in leads]
    assert scores == sorted(scores, reverse=True)
    for lead in leads:
        assert lead["drop_reason"] in CALL_ADVICE
        assert lead["advice"]
        assert lead["score_reasons"]


def test_call_list_skips_leads_a_call_cannot_win_back(client):
    leads = client.get("/api/staff/leads-to-call?limit=50", headers=STAFF).json()
    for lead in leads:
        assert lead["drop_reason"] not in {"Wrong or invalid number", "Unreachable after 3 attempts", "Not interested on first call"}


def test_call_list_size_is_limited(client):
    assert len(client.get("/api/staff/leads-to-call?limit=100000", headers=STAFF).json()) == 50
