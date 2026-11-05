"""Tests for the advisor, explanations and saved quotes. The LLM is always faked here."""
import pytest
from pydantic import ValidationError

from app import advisor, explain, llm
from app.catalogue import load_catalogue
from app.database import SessionLocal
from app.models import Product, Quote
from app.recommend import recommend
from app.schemas import AdvisorTurn, BusinessProfile

COMPLETE_TURN = {
    "reply": "Thanks, here is what I suggest.",
    "employee_count": 3,
    "city": "Patna",
    "has_gstin": False,
    "segment": "micro",
    "current_internet": "mobile_hotspot",
    "needs": ["internet", "cctv"],
    "camera_count": 4,
}


def chat(client, text="I run a kirana"):
    return client.post("/api/advisor/message", json={"messages": [{"role": "user", "content": text}]})


@pytest.fixture
def fake_llm(monkeypatch):
    """Make the LLM return a chosen answer, and record what it was sent."""
    calls = []

    def install(answer):
        def fake_ask(system, messages, shape):
            calls.append({"system": system, "messages": messages})
            if isinstance(answer, Exception):
                raise answer
            # An advisor answer cannot also be an explanation, so that step falls back.
            if shape is explain.ExplanationText and "explanation" not in answer:
                raise llm.LLMUnavailable("not an explanation")
            return shape(**answer)

        monkeypatch.setattr(llm, "ask", fake_ask)
        monkeypatch.setattr(llm, "is_available", lambda: True)
        return calls

    return install


def test_status_is_off_without_a_key(client):
    assert client.get("/api/advisor/status").json() == {"available": False}


def test_real_ask_without_a_key_raises_the_fallback_error():
    with pytest.raises(llm.LLMUnavailable):
        llm.ask("system", [{"role": "user", "content": "hi"}], AdvisorTurn)


def test_chat_without_a_key_tells_the_page_to_use_the_form(client):
    assert chat(client).status_code == 503


def test_cities_come_from_the_data(client):
    cities = {c["city"]: c["city_tier"] for c in client.get("/api/advisor/cities").json()}
    assert len(cities) == 22
    assert cities["Mumbai"] == 1
    assert cities["Patna"] == 2


def test_incomplete_answer_only_asks_the_next_question(client, fake_llm):
    fake_llm({"reply": "How many people work there?", "city": "Patna"})
    body = chat(client).json()
    assert body["reply"] == "How many people work there?"
    assert body["recommendation"] is None


def test_no_bundle_until_our_code_has_every_answer(client, fake_llm):
    fake_llm({"reply": "Done, here is your bundle!", "city": "Patna", "needs": ["internet"]})
    assert chat(client).json()["recommendation"] is None


def test_earlier_answers_are_kept_even_if_the_llm_forgets_them(client, fake_llm):
    fake_llm({"reply": "Next?", "city": "Patna", "needs": ["internet"], "segment": "micro"})
    first = chat(client).json()
    assert first["answers"]["city"] == "Patna"

    # The LLM now returns nothing from before. The answers must survive.
    fake_llm({"reply": "Next?", "employee_count": 2, "needs": ["cctv"]})
    second = client.post(
        "/api/advisor/message",
        json={"messages": [{"role": "user", "content": "2 people"}], "answers": first["answers"]},
    ).json()["answers"]
    assert second["city"] == "Patna"
    assert second["employee_count"] == 2
    assert second["needs"] == ["internet", "cctv"]


def test_the_llm_is_told_what_is_known_and_what_is_missing(client, fake_llm):
    calls = fake_llm({"reply": "Next?"})
    client.post(
        "/api/advisor/message",
        json={"messages": [{"role": "user", "content": "hi"}], "answers": {"city": "Patna", "segment": "micro"}},
    )
    system = calls[0]["system"]
    assert "Patna" in system.split("still need")[0]
    assert "which city" not in system
    assert "how many people" in system


def test_a_missing_segment_does_not_hold_up_an_owner_whose_size_we_know(client, fake_llm):
    # The live LLM once asked an owner which "segment" they were in, so this must not block.
    fake_llm({**COMPLETE_TURN, "segment": None, "employee_count": 8})
    body = chat(client).json()
    assert body["recommendation"]["segment"] == "prof"


def test_the_prompt_never_invites_the_llm_to_ask_about_segments():
    assert "Never ask about segments" in advisor.SYSTEM_PROMPT


def test_a_chain_is_asked_how_many_branches_but_a_shop_is_not():
    chain = advisor.AdvisorAnswers(segment="multi", employee_count=60)
    shop = advisor.AdvisorAnswers(segment="micro", employee_count=2)
    assert any("branches" in question for question in advisor.missing_questions(chain, 1))
    assert not any("branches" in question for question in advisor.missing_questions(shop, 1))


def test_stated_camera_count_reaches_the_quote(client, fake_llm):
    fake_llm({**COMPLETE_TURN, "camera_count": 4})
    lines = chat(client).json()["recommendation"]["bundle"]["quote"]["lines"]
    assert next(line for line in lines if line["product_id"] == "P23")["quantity"] == 4


def test_owner_who_skips_the_optional_question_still_gets_a_bundle(client, fake_llm):
    fake_llm({**COMPLETE_TURN, "current_internet": None})
    one_turn = chat(client).json()
    assert one_turn["recommendation"] is None
    many_turns = [{"role": "user", "content": "skip"}] * advisor.GIVE_UP_ON_OPTIONAL_AFTER_TURNS
    late = client.post("/api/advisor/message", json={"messages": many_turns, "answers": one_turn["answers"]}).json()
    assert late["recommendation"] is not None


def test_complete_answer_gets_a_bundle_from_our_own_code(client, fake_llm):
    fake_llm(COMPLETE_TURN)
    body = chat(client).json()
    lines = {l["product_id"]: l for l in body["recommendation"]["bundle"]["quote"]["lines"]}
    assert set(lines) == {"P01", "P23"}
    assert lines["P23"]["quantity"] == 4
    assert lines["P01"]["monthly_inr"] == 1099
    assert body["profile"]["city_tier"] == 2


def test_llm_answer_cannot_contain_an_invented_need():
    with pytest.raises(ValidationError):
        AdvisorTurn(**{**COMPLETE_TURN, "needs": ["free_laptop"]})


def test_reply_that_mentions_a_price_is_replaced(client, fake_llm):
    fake_llm({"reply": "Our fibre is only ₹1 a month! How many staff?"})
    assert chat(client).json()["reply"] == advisor.SAFE_QUESTION


def test_llm_failure_falls_back_to_the_form(client, fake_llm):
    fake_llm(llm.LLMUnavailable("timeout"))
    assert chat(client).status_code == 503


@pytest.mark.parametrize(
    "text",
    [
        "my gstin is 37IHKXV5167L1ZS ok",
        "udyam UDYAM-KL-00-3078801",
        "pan ABCDE1234F",
        "call 98765 43210",
        "aadhaar 1234 5678 9012",
    ],
)
def test_identifiers_are_hidden_before_reaching_the_llm(client, fake_llm, text):
    calls = fake_llm({"reply": "Thanks."})
    chat(client, text)
    sent = calls[0]["messages"][0]["content"]
    assert "[hidden]" in sent
    assert not any(digit in sent for digit in "0123456789")


def test_ordinary_numbers_are_not_hidden():
    assert advisor.hide_identifiers("3 staff, 2 sites, budget 2000") == "3 staff, 2 sites, budget 2000"


def test_unknown_city_counts_as_tier_2():
    assert advisor.tier_for_city("Atlantis", []) == 2


def test_chat_length_is_limited(client):
    too_many = [{"role": "user", "content": "hi"}] * 41
    assert client.post("/api/advisor/message", json={"messages": too_many}).status_code == 422
    too_long = [{"role": "user", "content": "x" * 1001}]
    assert client.post("/api/advisor/message", json={"messages": too_long}).status_code == 422


# ---------- Explanations ----------

@pytest.fixture
def clinic():
    with SessionLocal() as db:
        catalogue = load_catalogue(db)
    profile = BusinessProfile(
        employee_count=8, city_tier=1, has_gstin=True, segment="prof",
        current_internet="home_broadband", needs=["internet", "email_office"],
    )
    return profile, recommend(profile, catalogue)


def test_plain_explanation_uses_real_totals(clinic):
    profile, recommendation = clinic
    text = explain.plain_explanation(profile, recommendation)
    total = recommendation.bundle.quote.monthly_total_inr
    assert f"₹{total:,}" in text
    assert "Biz Fibre 300" in text
    assert "home broadband" in text


def test_llm_explanation_is_used_when_numbers_are_real(clinic, fake_llm):
    profile, recommendation = clinic
    total = recommendation.bundle.quote.monthly_total_inr
    fake_llm({"explanation": f"आपके लिए सही बंडल, ₹{total:,} महीना।"})
    assert "बंडल" in explain.explain(profile, recommendation)


def test_llm_explanation_with_an_invented_number_is_thrown_away(clinic, fake_llm):
    profile, recommendation = clinic
    fake_llm({"explanation": "Only ₹49 a month, with 50% off!"})
    assert explain.explain(profile, recommendation) == explain.plain_explanation(profile, recommendation)


def test_llm_explanation_with_hindi_digits_is_still_checked(clinic, fake_llm):
    profile, recommendation = clinic
    fake_llm({"explanation": "केवल ₹४९ महीना"})
    assert explain.explain(profile, recommendation) == explain.plain_explanation(profile, recommendation)


def test_hindi_owner_gets_a_hindi_explanation_with_no_llm(clinic):
    profile, recommendation = clinic
    text = explain.explain(profile.model_copy(update={"preferred_language": "Hindi"}), recommendation)
    assert "प्रति माह" in text
    assert "Biz Fibre 300" in text
    assert f"₹{recommendation.bundle.quote.monthly_total_inr:,}" in text


def test_llm_failure_gives_the_plain_explanation(clinic, fake_llm):
    profile, recommendation = clinic
    fake_llm(llm.LLMUnavailable("timeout"))
    assert explain.explain(profile, recommendation) == explain.plain_explanation(profile, recommendation)


# ---------- Saving a quote ----------

SHOP = {"employee_count": 3, "city_tier": 1, "has_gstin": True}


def test_saving_a_quote_recalculates_the_price_on_the_server(client):
    response = client.post(
        "/api/quotes",
        json={"profile": SHOP, "items": [{"product_id": "P01"}, {"product_id": "P23", "quantity": 2}], "city": "Pune"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["quote"]["monthly_total_inr"] == 1099 + 2 * 249
    with SessionLocal() as db:
        saved = db.get(Quote, body["quote_id"])
        assert saved.monthly_total_inr == 1099 + 2 * 249
        assert saved.status == "accepted"
        assert saved.business.city == "Pune"
        assert {item.product_id: item.quantity for item in saved.items} == {"P01": 1, "P23": 2}


def test_an_invalid_bundle_cannot_be_saved(client):
    response = client.post("/api/quotes", json={"profile": SHOP, "items": [{"product_id": "P23"}]})
    assert response.status_code == 422


def test_accepted_quote_keeps_its_price_after_a_catalogue_change(client):
    quote_id = client.post("/api/quotes", json={"profile": SHOP, "items": [{"product_id": "P01"}]}).json()["quote_id"]
    with SessionLocal() as db:
        product = db.get(Product, "P01")
        old_price = product.price_max_inr_per_month
        product.price_max_inr_per_month = 9999
        db.commit()
    try:
        with SessionLocal() as db:
            saved = db.get(Quote, quote_id)
            assert saved.items[0].unit_price_inr == 1099
            assert saved.monthly_total_inr == 1099
    finally:
        with SessionLocal() as db:
            db.get(Product, "P01").price_max_inr_per_month = old_price
            db.commit()


def test_recommend_api_includes_an_explanation(client):
    response = client.post("/api/bundles/recommend", json={**SHOP, "needs": ["internet"]})
    assert "Biz Fibre 100" in response.json()["explanation"]
