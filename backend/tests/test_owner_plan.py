"""A plan the owner builds from the rate list: same rules, same prices, same sign-in."""
import pytest

SHOP = {"employee_count": 3, "city_tier": 1, "has_gstin": True}


def plan(client, items, profile=SHOP):
    return client.post("/api/bundles/plan", json={"profile": profile, "items": items})


def test_a_valid_plan_becomes_a_quote(client):
    response = plan(client, [{"product_id": "P01"}, {"product_id": "P23", "quantity": 3}])
    assert response.status_code == 200
    body = response.json()
    assert body["chosen_by"] == "owner"
    lines = {line["product_id"]: line for line in body["bundle"]["quote"]["lines"]}
    assert set(lines) == {"P01", "P23"}
    assert lines["P23"]["quantity"] == 3
    assert body["bundle"]["quote"]["monthly_total_inr"] == 1099 + 3 * 249
    assert body["bundle"]["reasons"]["P23"] == "You chose this from the rate list"


def test_the_plan_price_matches_the_normal_quote(client):
    items = [{"product_id": "P02"}, {"product_id": "P16", "quantity": 4}]
    from_plan = plan(client, items).json()["bundle"]["quote"]
    from_quote = client.post("/api/bundles/quote", json={"profile": SHOP, "items": items}).json()
    assert from_plan == from_quote


def test_the_explanation_says_the_owner_chose_it(client):
    body = plan(client, [{"product_id": "P01"}]).json()
    assert body["explanation"] == "Your plan has 1 service from the rate list. It costs ₹1,099 a month."


def test_a_hindi_owner_gets_a_hindi_explanation(client):
    body = plan(client, [{"product_id": "P01"}], {**SHOP, "preferred_language": "Hindi"}).json()
    assert "प्रति माह" in body["explanation"]


def test_suggested_add_ons_never_repeat_what_was_chosen(client):
    body = plan(client, [{"product_id": "P01"}, {"product_id": "P07"}]).json()
    chosen = {line["product_id"] for line in body["bundle"]["quote"]["lines"]}
    addon_ids = {addon["product_id"] for addon in body["addons"]}
    assert not chosen & addon_ids
    assert "P08" not in addon_ids  # Already has mobile lines.


@pytest.mark.parametrize(
    "items, profile, expected",
    [
        ([{"product_id": "P23"}], SHOP, "only works with"),  # CCTV with no connection.
        ([{"product_id": "P01"}, {"product_id": "P15"}], {**SHOP, "has_gstin": False}, "needs an active GSTIN"),
        ([{"product_id": "P03"}], {**SHOP, "city_tier": 2, "employee_count": 10}, "not sold in tier 2"),
        ([{"product_id": "P01"}, {"product_id": "P10"}], {**SHOP, "employee_count": 20}, "at least 3 sites"),
        ([{"product_id": "P99"}], SHOP, "not in the catalogue"),
        ([{"product_id": "P01"}, {"product_id": "P01"}], SHOP, "listed more than once"),
        ([], SHOP, "no products"),
    ],
)
def test_a_plan_that_breaks_a_rule_is_refused_with_the_reason(client, items, profile, expected):
    response = plan(client, items, profile)
    assert response.status_code == 422
    assert any(expected in reason for reason in response.json()["detail"])


def test_a_zero_quantity_is_refused(client):
    assert plan(client, [{"product_id": "P01", "quantity": 0}]).status_code == 422


def test_building_a_plan_needs_sign_in(anonymous):
    response = plan(anonymous, [{"product_id": "P01"}])
    assert response.status_code == 401


def test_an_accepted_plan_becomes_an_order_like_any_quote(client):
    items = [{"product_id": "P01"}, {"product_id": "P19"}]
    assert plan(client, items).status_code == 200
    saved = client.post("/api/quotes", json={"profile": SHOP, "items": items}).json()
    order = client.get(f"/api/orders/{saved['order_id']}").json()
    assert order["status"] == "quote_confirmed"
    assert order["monthly_total_inr"] == 1099 + 749


def test_a_leased_line_plan_still_offers_a_person(client):
    body = plan(client, [{"product_id": "P05"}], {**SHOP, "employee_count": 20}).json()
    assert any("site survey" in reason for reason in body["assisted_reasons"])
