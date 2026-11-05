"""Tests for rules, pricing and recommendations, using the real catalogue and leads."""
import itertools

import pandas as pd
import pytest

from app.catalogue import load_catalogue
from app.database import SessionLocal
from app.import_data import DATA_DIR
from app.pricing import calculate_quote, unit_price
from app.recommend import PRODUCT_FOR_NEED, recommend
from app.rules import check_bundle
from app.schemas import BundleItem, BusinessProfile


@pytest.fixture(scope="module")
def catalogue():
    with SessionLocal() as db:
        return load_catalogue(db)


def make_profile(**changes):
    values = {"employee_count": 5, "num_sites": 1, "city_tier": 1, "has_gstin": True}
    return BusinessProfile(**{**values, **changes})


def items(*product_ids):
    return [BundleItem(product_id=product_id) for product_id in product_ids]


def bundle_ids(recommendation):
    return {line.product_id for line in recommendation.bundle.quote.lines}


def excluded_ids(recommendation):
    return {entry.product_id for entry in recommendation.not_included}


# ---------- Rules ----------

@pytest.mark.parametrize(
    "product_id, changes, expected_text",
    [
        ("P03", {"city_tier": 2}, "tier 2"),
        ("P03", {"has_gstin": False}, "GSTIN"),
        ("P03", {"employee_count": 4}, "at least 5 employees"),
        ("P05", {"employee_count": 9}, "at least 10 employees"),
        ("P06", {"employee_count": 24}, "at least 25 employees"),
        ("P15", {"has_gstin": False}, "GSTIN"),
        ("P01", {"fibre_available": False}, "fibre"),
    ],
)
def test_ineligible_product_is_rejected(catalogue, product_id, changes, expected_text):
    errors = check_bundle(items(product_id), make_profile(**changes), catalogue)
    assert any(expected_text in error for error in errors)


def test_sdwan_needs_three_sites(catalogue):
    profile = make_profile(employee_count=20, num_sites=2)
    errors = check_bundle(items("P01", "P10"), profile, catalogue)
    assert any("at least 3 sites" in error for error in errors)


@pytest.mark.parametrize("product_id", ["P09", "P10", "P11", "P21"])
def test_airfiber_does_not_satisfy_wired_only_products(catalogue, product_id):
    profile = make_profile(employee_count=50, num_sites=5)
    errors = check_bundle(items("P04", product_id), profile, catalogue)
    assert any("only works with" in error for error in errors)


@pytest.mark.parametrize("product_id", ["P12", "P22", "P23"])
def test_airfiber_does_satisfy_these_products(catalogue, product_id):
    assert check_bundle(items("P04", product_id), make_profile(), catalogue) == []


def test_cctv_without_a_connection_is_rejected(catalogue):
    errors = check_bundle(items("P23"), make_profile(), catalogue)
    assert any("only works with" in error for error in errors)


def test_guest_wifi_does_not_work_with_leased_line(catalogue):
    profile = make_profile(employee_count=30)
    errors = check_bundle(items("P05", "P22"), profile, catalogue)
    assert any("only works with" in error for error in errors)


def test_unknown_duplicate_and_empty_bundles_are_rejected(catalogue):
    assert check_bundle(items("P99"), make_profile(), catalogue) == ["P99 is not in the catalogue"]
    assert check_bundle(items("P07", "P07"), make_profile(), catalogue) == ["P07 is listed more than once"]
    assert check_bundle([], make_profile(), catalogue) == ["The bundle has no products"]


# ---------- Pricing ----------

def test_unit_price_is_middle_of_range_and_rounds_up(catalogue):
    assert unit_price(catalogue["P01"]) == 1099
    assert unit_price(catalogue["P16"]) == 138  # 125 to 150 is 137.50


def test_quote_totals(catalogue):
    bundle = [BundleItem(product_id="P01"), BundleItem(product_id="P23", quantity=3)]
    quote = calculate_quote(bundle, catalogue)
    assert quote.monthly_total_inr == 1099 + 3 * 249
    assert quote.setup_total_inr == 3 * 1800
    assert quote.contract_months == 12
    assert quote.install_days == 5


def test_contract_is_the_longest_minimum(catalogue):
    assert calculate_quote(items("P07", "P04"), catalogue).contract_months == 6
    assert calculate_quote(items("P07"), catalogue).contract_months == 1


def test_setup_and_contract_match_every_activated_bundle(catalogue):
    leads = pd.read_csv(DATA_DIR / "smb_leads.csv")
    activated = leads[leads["outcome"] == "Activated"]
    assert len(activated) == 368
    for lead in activated.itertuples():
        bundle = []
        for part in lead.bundle_products.split(";"):
            product_id, quantity = part.split("x")
            bundle.append(BundleItem(product_id=product_id, quantity=int(quantity)))
        quote = calculate_quote(bundle, catalogue)
        assert quote.setup_total_inr == lead.one_time_setup_inr
        assert quote.contract_months == lead.contract_months


# ---------- Recommendations ----------

def test_small_shop_gets_basic_fibre(catalogue):
    result = recommend(make_profile(employee_count=3, segment="micro", needs=["internet"]), catalogue)
    assert bundle_ids(result) == {"P01"}


def test_kirana_without_gstin_cannot_get_whatsapp(catalogue):
    profile = make_profile(employee_count=2, segment="micro", has_gstin=False, needs=["internet", "whatsapp"])
    result = recommend(profile, catalogue)
    assert "P15" not in bundle_ids(result)
    assert "P15" in excluded_ids(result)
    assert not any(addon.product_id == "P15" for addon in result.addons)


def test_no_fibre_site_gets_airfiber_and_failover_is_explained(catalogue):
    profile = make_profile(fibre_available=False, needs=["internet", "failover"])
    result = recommend(profile, catalogue)
    assert bundle_ids(result) == {"P04"}
    assert "P09" in excluded_ids(result)


def test_tier_2_high_speed_falls_back_from_1g(catalogue):
    profile = make_profile(employee_count=20, city_tier=2, needs=["high_speed_internet"])
    assert bundle_ids(recommend(profile, catalogue)) == {"P02"}


def test_tier_1_high_speed_gets_1g(catalogue):
    profile = make_profile(employee_count=20, needs=["high_speed_internet"])
    assert bundle_ids(recommend(profile, catalogue)) == {"P03"}


def test_too_small_for_leased_line_is_explained(catalogue):
    profile = make_profile(employee_count=4, needs=["dedicated_internet"])
    result = recommend(profile, catalogue)
    assert not bundle_ids(result).intersection({"P05", "P06"})
    assert "P05" in excluded_ids(result)


def test_leased_line_is_never_pushed_on_a_small_office(catalogue):
    profile = make_profile(employee_count=15, segment="prof", needs=["internet", "failover"])
    assert not bundle_ids(recommend(profile, catalogue)).intersection({"P05", "P06"})


def test_manufacturer_gets_leased_line_and_a_person_to_help(catalogue):
    profile = make_profile(employee_count=40, segment="mfg", needs=["internet"])
    result = recommend(profile, catalogue)
    assert "P05" in bundle_ids(result)
    assert any("site survey" in reason for reason in result.assisted_reasons)


def test_mobile_only_buyer_is_not_sold_a_connection(catalogue):
    result = recommend(make_profile(needs=["mobile_lines"]), catalogue)
    assert bundle_ids(result) == {"P07"}


def test_connection_is_added_when_cctv_needs_one(catalogue):
    result = recommend(make_profile(employee_count=3, segment="micro", needs=["cctv"]), catalogue)
    assert bundle_ids(result) == {"P01", "P23"}
    assert result.bundle.reasons["P01"] == "Needed for Cloud CCTV"


def test_budget_drops_the_last_mentioned_extra_and_offers_it_back(catalogue):
    profile = make_profile(
        employee_count=3, segment="micro", needs=["internet", "pos_billing", "cctv"], budget_monthly_inr=2000
    )
    result = recommend(profile, catalogue)
    assert result.bundle.quote.monthly_total_inr <= 2000
    assert bundle_ids(result) == {"P01", "P19"}
    assert any(addon.product_id == "P23" and "budget" in addon.reason for addon in result.addons)
    assert result.over_budget is False


def test_budget_can_switch_to_a_cheaper_connection(catalogue):
    profile = make_profile(employee_count=3, segment="micro", needs=["internet"], budget_monthly_inr=1000)
    assert bundle_ids(recommend(profile, catalogue)) == {"P04"}


def test_impossible_budget_shows_cheapest_and_offers_a_person(catalogue):
    profile = make_profile(employee_count=3, segment="micro", needs=["internet"], budget_monthly_inr=300)
    result = recommend(profile, catalogue)
    assert bundle_ids(result) == {"P04"}
    assert result.over_budget is True
    assert any("over your budget" in reason for reason in result.assisted_reasons)


def test_when_nothing_can_be_sold_a_person_is_offered(catalogue):
    profile = make_profile(employee_count=1, has_gstin=False, needs=["machine_monitoring"])
    result = recommend(profile, catalogue)
    assert result.bundle is None
    assert "P24" in excluded_ids(result)
    assert result.assisted_reasons


def test_budget_never_leaves_a_connection_nobody_needs(catalogue):
    # The cameras do not fit this budget, and fibre alone is not what the owner asked for.
    profile = make_profile(employee_count=3, segment="micro", needs=["cctv"], budget_monthly_inr=1200)
    result = recommend(profile, catalogue)
    assert "P23" in bundle_ids(result)
    assert result.over_budget is True


def test_no_fibre_site_asking_for_high_speed_is_told_why(catalogue):
    profile = make_profile(employee_count=20, fibre_available=False, needs=["high_speed_internet"])
    result = recommend(profile, catalogue)
    assert bundle_ids(result) == {"P04"}
    assert {"P02", "P03"} <= excluded_ids(result)


def test_zero_exact_quantity_is_rejected(client):
    response = client.post(
        "/api/bundles/recommend",
        json={"employee_count": 3, "city_tier": 1, "has_gstin": True, "needs": ["cctv"], "quantities": {"P23": 0}},
    )
    assert response.status_code == 422


def test_large_chain_is_offered_a_person(catalogue):
    profile = make_profile(employee_count=100, num_sites=12, needs=["internet"])
    assert any("sites" in reason for reason in recommend(profile, catalogue).assisted_reasons)


def test_quantities_follow_sites_and_exact_answers(catalogue):
    profile = make_profile(employee_count=30, num_sites=4, needs=["internet", "cctv"], quantities={"P23": 9})
    lines = {line.product_id: line.quantity for line in recommend(profile, catalogue).bundle.quote.lines}
    assert lines["P23"] == 9
    assert lines[next(p for p in lines if p != "P23")] == 4


def test_addons_are_all_addable_and_do_not_duplicate_mobile(catalogue):
    profile = make_profile(employee_count=3, segment="micro", needs=["internet", "mobile_lines"])
    result = recommend(profile, catalogue)
    addon_ids = {addon.product_id for addon in result.addons}
    assert "P08" not in addon_ids and "P07" not in addon_ids
    for addon in result.addons:
        assert check_bundle(items(*bundle_ids(result), addon.product_id), profile, catalogue) == []


def test_every_combination_of_a_wide_profile_grid_gives_a_valid_bundle(catalogue):
    all_needs = ["internet", "dedicated_internet", *PRODUCT_FOR_NEED]
    grid = itertools.product(
        [1, 3, 5, 9, 10, 25, 150],  # Employees, either side of each catalogue limit.
        [1, 2, 3, 12],  # Sites.
        [1, 2],  # City tier.
        [True, False],  # GSTIN.
        [True, False],  # Fibre.
        [None, 500, 5000],  # Budget.
    )
    for employees, sites, tier, gstin, fibre, budget in grid:
        profile = BusinessProfile(
            employee_count=employees, num_sites=sites, city_tier=tier, has_gstin=gstin,
            fibre_available=fibre, needs=all_needs, budget_monthly_inr=budget,
        )
        result = recommend(profile, catalogue)
        if result.bundle:
            bundle = [BundleItem(product_id=l.product_id, quantity=l.quantity) for l in result.bundle.quote.lines]
            assert check_bundle(bundle, profile, catalogue) == [], profile
        for alternative in result.alternatives:
            bundle = [BundleItem(product_id=l.product_id, quantity=l.quantity) for l in alternative.quote.lines]
            assert check_bundle(bundle, profile, catalogue) == [], profile


def test_every_real_lead_gets_a_valid_bundle(catalogue):
    need_for_product = {product_id: need for need, product_id in PRODUCT_FOR_NEED.items()}
    leads = pd.read_csv(DATA_DIR / "smb_leads.csv")
    for lead in leads.itertuples():
        interests = lead.products_of_interest.split(";") if isinstance(lead.products_of_interest, str) else []
        needs = [need_for_product.get(product_id, "internet") for product_id in interests]
        profile = BusinessProfile(
            employee_count=lead.employee_count, num_sites=lead.num_sites, city_tier=lead.city_tier,
            has_gstin=lead.has_gstin == "Y", needs=list(dict.fromkeys(needs)),
        )
        result = recommend(profile, catalogue)
        if result.bundle:
            bundle = [BundleItem(product_id=l.product_id, quantity=l.quantity) for l in result.bundle.quote.lines]
            assert check_bundle(bundle, profile, catalogue) == [], lead.lead_id
        else:
            assert result.assisted_reasons, lead.lead_id


# ---------- API ----------

def test_recommend_api(client):
    response = client.post(
        "/api/bundles/recommend",
        json={"employee_count": 3, "city_tier": 2, "has_gstin": False, "needs": ["internet", "pos_billing"]},
    )
    assert response.status_code == 200
    assert response.json()["bundle"]["quote"]["monthly_total_inr"] == 1099 + 749


def test_recommend_api_rejects_an_invented_need(client):
    response = client.post(
        "/api/bundles/recommend",
        json={"employee_count": 3, "city_tier": 2, "has_gstin": False, "needs": ["free_laptop"]},
    )
    assert response.status_code == 422


def test_quote_api_prices_a_valid_bundle(client):
    response = client.post(
        "/api/bundles/quote",
        json={
            "profile": {"employee_count": 3, "city_tier": 1, "has_gstin": True},
            "items": [{"product_id": "P01"}, {"product_id": "P23", "quantity": 2}],
        },
    )
    assert response.status_code == 200
    assert response.json()["monthly_total_inr"] == 1099 + 2 * 249


def test_quote_api_blocks_removing_the_connection_cctv_needs(client):
    response = client.post(
        "/api/bundles/quote",
        json={
            "profile": {"employee_count": 3, "city_tier": 1, "has_gstin": True},
            "items": [{"product_id": "P23"}],
        },
    )
    assert response.status_code == 422
    assert "only works with" in response.json()["detail"][0]


def test_quote_api_rejects_zero_quantity(client):
    response = client.post(
        "/api/bundles/quote",
        json={
            "profile": {"employee_count": 3, "city_tier": 1, "has_gstin": True},
            "items": [{"product_id": "P01", "quantity": 0}],
        },
    )
    assert response.status_code == 422
