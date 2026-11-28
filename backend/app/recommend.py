"""Recommendation: choose the bundle that best fits a business.

How it works:
1. For each possible internet connection, build a bundle of what the owner asked for.
2. If a budget is set, also build a trimmed version that fits it.
3. Score every bundle and pick the best. A bundle within budget always beats one over it.

The segment defaults below come from what each segment bought in smb_leads.csv.
"""
import math

# Imported as a module, because product_details.py also reads this module's rules. Names are looked
# up when a function runs, so the two files can load in either order.
from . import product_details
from .pricing import calculate_quote
from .rules import Catalogue, ineligibility_reasons, missing_dependency
from .schemas import (
    AddOn,
    BundleItem,
    BusinessProfile,
    NotIncluded,
    Recommendation,
    RecommendedBundle,
    ScoreParts,
)

CONNECTION_NEEDS = {"internet", "high_speed_internet", "dedicated_internet"}

# Each need maps to one product. Connections are chosen separately because several can fit.
PRODUCT_FOR_NEED = {
    "mobile_lines": "P07",
    "premium_mobile_lines": "P08",
    "failover": "P09",
    "multi_site_management": "P10",
    "static_ip": "P11",
    "phone_system": "P12",
    "toll_free": "P13",
    "bulk_sms": "P14",
    "whatsapp": "P15",
    "email_office": "P16",
    "cloud_backup": "P17",
    "website": "P18",
    "pos_billing": "P19",
    "endpoint_security": "P20",
    "firewall": "P21",
    "guest_wifi": "P22",
    "cctv": "P23",
    "machine_monitoring": "P24",
    "fleet_tracking": "P25",
}

STANDARD_CONNECTIONS = ["P01", "P02", "P03", "P04"]
LEASED_LINES = ["P05", "P06"]

# The connection that suits each segment best, then the next best.
BEST_CONNECTIONS = {
    "micro": ["P01", "P04"],
    "prof": ["P02", "P03"],
    "multi": ["P02", "P01"],
    "mfg": ["P05", "P03"],
}

# Most popular extras per segment, most popular first.
SUGGESTED_ADDONS = {
    "micro": ["P07", "P19", "P22", "P23", "P15", "P18"],
    "prof": ["P16", "P07", "P20", "P17", "P12", "P11"],
    "multi": ["P08", "P09", "P19", "P23", "P10", "P13"],
    "mfg": ["P08", "P16", "P20", "P21", "P23", "P11"],
}
MAX_SUGGESTIONS = 4
LARGEST_SELF_SERVE_SITES = 10


def infer_segment(profile: BusinessProfile) -> str:
    if profile.segment:
        return profile.segment
    if profile.num_sites >= 3:
        return "multi"
    return "micro" if profile.employee_count <= 6 else "prof"


PER_SITE_PRODUCTS = {"P01", "P02", "P03", "P04", "P05", "P06", "P09", "P10", "P19", "P21", "P22"}
TWO_PER_SITE_PRODUCTS = {"P07", "P08", "P12", "P23"}
MOST_STAFF_PRODUCTS = {"P16", "P20"}
MOST_STAFF_SHARE = 0.6  # About what buyers chose.

# Which rule gave a starting quantity. product_details.py uses it to explain the quantity, so the
# number and its explanation always come from the same place.
QuantityRule = str  # "exact", "per_site", "two_per_site", "most_staff" or "one"


def quantity_rule(product_id: str, profile: BusinessProfile) -> tuple[int, QuantityRule]:
    """The starting quantity, and the rule it came from. Exact answers in the profile take priority."""
    if product_id in profile.quantities:
        return profile.quantities[product_id], "exact"
    sites = profile.num_sites
    if product_id in PER_SITE_PRODUCTS:
        return sites, "per_site"
    if product_id in TWO_PER_SITE_PRODUCTS:
        return 2 * sites, "two_per_site"
    if product_id in MOST_STAFF_PRODUCTS:
        return math.ceil(profile.employee_count * MOST_STAFF_SHARE), "most_staff"
    return 1, "one"


def default_quantity(product_id: str, profile: BusinessProfile) -> int:
    """A starting quantity the owner can change. Exact answers in the profile take priority."""
    return quantity_rule(product_id, profile)[0]


def owned_ids(profile: BusinessProfile) -> set[str]:
    """Products the business already has from us, on an earlier order."""
    return set(profile.owned_product_ids)


def connection_options(profile: BusinessProfile, segment: str) -> list[str | None]:
    """Connections worth trying. None means no connection, if the owner did not ask for one."""
    options: list[str | None] = list(STANDARD_CONNECTIONS)
    # A leased line costs about ten times more, so never offer one unprompted to small offices.
    if "dedicated_internet" in profile.needs or segment == "mfg":
        options += LEASED_LINES
    if not CONNECTION_NEEDS.intersection(profile.needs):
        options.append(None)
    return options


def best_connections_for(profile: BusinessProfile, segment: str) -> list[str]:
    if "dedicated_internet" in profile.needs:
        return ["P06", "P05"] if "high_speed_internet" in profile.needs else ["P05", "P06"]
    if "high_speed_internet" in profile.needs:
        return ["P03", "P02"]
    if not profile.fibre_available and segment != "mfg":
        return ["P04"]
    return BEST_CONNECTIONS[segment]


def is_need_covered(need: str, product_ids: set[str]) -> bool:
    if need == "internet":
        return bool(product_ids.intersection(STANDARD_CONNECTIONS + LEASED_LINES))
    if need == "high_speed_internet":
        return bool(product_ids.intersection(["P02", "P03"] + LEASED_LINES))
    if need == "dedicated_internet":
        return bool(product_ids.intersection(LEASED_LINES))
    return PRODUCT_FOR_NEED[need] in product_ids


def score_bundle(profile, segment, product_ids: set[str]) -> ScoreParts:
    needs = profile.needs
    covered = sum(is_need_covered(need, product_ids) for need in needs)
    needs_covered = round(60 * covered / len(needs))

    best = best_connections_for(profile, segment)
    # A connection the business already has fits its size just as well as a new one.
    with_owned = product_ids | owned_ids(profile)
    if best[0] in with_owned:
        size_fit = 30
    elif best[1:] and best[1] in with_owned:
        size_fit = 15
    else:
        size_fit = 0

    simplicity = max(0, 10 - len(product_ids))
    return ScoreParts(
        needs_covered=needs_covered,
        size_fit=size_fit,
        simplicity=simplicity,
        total=needs_covered + size_fit + simplicity,
    )


def wanted_product_ids(profile: BusinessProfile) -> list[str]:
    """Products the owner asked for, in the order asked, without repeats."""
    ids = [PRODUCT_FOR_NEED[need] for need in profile.needs if need in PRODUCT_FOR_NEED]
    return list(dict.fromkeys(ids))


def build_items(connection_id, profile, wanted_ids, catalogue) -> list[BundleItem]:
    """One connection plus every wanted product that is allowed to go with it."""
    # What the business already has counts as present, so CCTV can join the broadband it has.
    ids = ({connection_id} if connection_id else set()) | owned_ids(profile)
    chosen = [connection_id] if connection_id else []
    for product_id in wanted_ids:
        product = catalogue[product_id]
        if ineligibility_reasons(product, profile):
            continue
        if missing_dependency(product, ids, catalogue):
            continue
        ids.add(product_id)
        chosen.append(product_id)
    return [BundleItem(product_id=p, quantity=default_quantity(p, profile)) for p in chosen]


def trim_to_budget(items, connection_id, budget, catalogue) -> list[BundleItem]:
    """Remove the last-mentioned extras until the bundle fits. Never removes the connection."""
    trimmed = list(items)
    while calculate_quote(trimmed, catalogue).monthly_total_inr > budget:
        extras = [item for item in trimmed if item.product_id != connection_id]
        if not extras:
            break
        trimmed.remove(extras[-1])
    return trimmed


def line_reason(product_id, profile, items, catalogue) -> str:
    if product_id in wanted_product_ids(profile):
        return "You asked for this"
    if product_id in STANDARD_CONNECTIONS + LEASED_LINES:
        if CONNECTION_NEEDS.intersection(profile.needs):
            return "Your internet connection"
        dependents = [
            catalogue[item.product_id].name
            for item in items
            if product_id in catalogue[item.product_id].requires_one_of
        ]
        return f"Needed for {', '.join(dependents)}"
    return "Suggested for your business"


def to_recommended_bundle(
    items, profile, segment, catalogue, peer_stats=None, *, is_alternative=False, assumed_internet=False
) -> RecommendedBundle:
    return RecommendedBundle(
        quote=calculate_quote(items, catalogue),
        reasons={item.product_id: line_reason(item.product_id, profile, items, catalogue) for item in items},
        score=score_bundle(profile, segment, {item.product_id for item in items}),
        # Only explains the choice made above. It never changes the items.
        details={
            item.product_id: product_details.build_details(
                item.product_id, profile, segment, items, catalogue, peer_stats, profile.preferred_language,
                is_alternative=is_alternative, assumed_internet=assumed_internet,
            )
            for item in items
        },
    )


def is_worth_offering(items, connection_id, profile, catalogue) -> bool:
    """Reject empty bundles, and connections that nobody asked for and nothing needs."""
    if not items:
        return False
    if connection_id is None or CONNECTION_NEEDS.intersection(profile.needs):
        return True
    # A second connection is only worth it when something needs one the business does not have yet.
    owned = owned_ids(profile)
    return any(
        connection_id in catalogue[item.product_id].requires_one_of
        and not owned.intersection(catalogue[item.product_id].requires_one_of)
        for item in items
    )


def build_candidates(profile, segment, catalogue) -> list[list[BundleItem]]:
    wanted_ids = wanted_product_ids(profile)
    candidates = []
    for connection_id in connection_options(profile, segment):
        if connection_id and ineligibility_reasons(catalogue[connection_id], profile):
            continue
        items = build_items(connection_id, profile, wanted_ids, catalogue)
        versions = [items]
        if profile.budget_monthly_inr:
            trimmed = trim_to_budget(items, connection_id, profile.budget_monthly_inr, catalogue)
            if trimmed != items:
                versions.append(trimmed)
        candidates += [v for v in versions if is_worth_offering(v, connection_id, profile, catalogue)]
    return candidates


def rank_candidates(candidates, profile, segment, catalogue) -> list[list[BundleItem]]:
    budget = profile.budget_monthly_inr

    def monthly(items):
        return calculate_quote(items, catalogue).monthly_total_inr

    def sort_key(items):
        fits = budget is None or monthly(items) <= budget
        score = score_bundle(profile, segment, {item.product_id for item in items}).total
        return (not fits, -score, monthly(items))

    ranked = sorted(candidates, key=sort_key)
    # If nothing fits the budget, show the cheapest option instead of the fullest one.
    if budget is not None and ranked and monthly(ranked[0]) > budget:
        ranked = sorted(candidates, key=monthly)
    return ranked


def alternatives_to(best, ranked, profile, segment, catalogue, peer_stats=None, assumed_internet=False) -> list[RecommendedBundle]:
    """Up to two other bundles, each built on a different connection."""
    def connection_of(items):
        return next((i.product_id for i in items if i.product_id in STANDARD_CONNECTIONS + LEASED_LINES), None)

    seen = {connection_of(best)}
    alternatives = []
    for items in ranked:
        connection = connection_of(items)
        if connection not in seen and len(alternatives) < 2:
            seen.add(connection)
            alternatives.append(
                to_recommended_bundle(
                    items, profile, segment, catalogue, peer_stats,
                    is_alternative=True, assumed_internet=assumed_internet,
                )
            )
    return alternatives


def explain_not_included(best_ids, wanted_ids, profile, catalogue) -> list[NotIncluded]:
    """Tell the owner why something they asked for cannot be sold to them."""
    results = []
    present_ids = set(best_ids) | owned_ids(profile)
    for product_id in wanted_ids:
        product = catalogue[product_id]
        reasons = ineligibility_reasons(product, profile)
        problem = missing_dependency(product, present_ids, catalogue)
        if reasons:
            results.append(NotIncluded(product_id=product_id, name=product.name, reasons=reasons))
        elif problem and product_id not in best_ids:
            results.append(NotIncluded(product_id=product_id, name=product.name, reasons=[problem]))

    # Connection needs have no single product, so explain the ones that could have met them.
    for need, product_ids in [("dedicated_internet", LEASED_LINES), ("high_speed_internet", ["P02", "P03"])]:
        if need in profile.needs and not is_need_covered(need, best_ids):
            for product_id in product_ids:
                reasons = ineligibility_reasons(catalogue[product_id], profile)
                if reasons:
                    results.append(NotIncluded(product_id=product_id, name=catalogue[product_id].name, reasons=reasons))
    return results


def build_addons(
    best_ids, wanted_ids, excluded_ids, profile, segment, catalogue, *, items=None, peer_stats=None
) -> list[AddOn]:
    """Things the owner can switch on: first anything cut for budget, then popular extras.

    `items` is the bundle with its quantities, used only to explain each add-on's effect on the bill.
    """
    addons = []
    bundle_items = items if items is not None else [
        BundleItem(product_id=product_id, quantity=default_quantity(product_id, profile)) for product_id in best_ids
    ]

    def add(product_id, reason, was_cut=False):
        product = catalogue[product_id]
        item = BundleItem(product_id=product_id, quantity=default_quantity(product_id, profile))
        line = calculate_quote([item], catalogue).lines[0]
        addons.append(
            AddOn(
                product_id=product_id,
                name=product.name,
                quantity=item.quantity,
                monthly_inr=line.monthly_inr,
                setup_inr=line.setup_inr,
                reason=reason,
                detail=product_details.build_addon_detail(
                    item, profile, segment, bundle_items, catalogue, peer_stats, profile.preferred_language,
                    was_cut=was_cut,
                ),
            )
        )

    for product_id in wanted_ids:
        if product_id not in best_ids and product_id not in excluded_ids:
            add(product_id, "You asked for this, but it is over your budget", was_cut=True)

    # Nothing the business already has from us is suggested again.
    already_used = set(best_ids) | {addon.product_id for addon in addons} | set(excluded_ids) | owned_ids(profile)
    present_ids = set(best_ids) | owned_ids(profile)
    has_mobile = bool(already_used.intersection({"P07", "P08"}))
    suggestions = 0
    for product_id in SUGGESTED_ADDONS[segment]:
        product = catalogue[product_id]
        if suggestions == MAX_SUGGESTIONS:
            break
        if product_id in already_used or (has_mobile and product_id in {"P07", "P08"}):
            continue
        if ineligibility_reasons(product, profile) or missing_dependency(product, present_ids, catalogue):
            continue
        add(product_id, "Popular with businesses like yours")
        suggestions += 1
    return addons


def assisted_reasons(profile, best_items, over_budget) -> list[str]:
    """When a person should help, so nobody hits a dead end in the app."""
    reasons = []
    if not best_items:
        reasons.append("We could not build a bundle from what you asked for")
    if over_budget:
        reasons.append("The closest bundle is over your budget")
    if profile.num_sites > LARGEST_SELF_SERVE_SITES:
        reasons.append(f"More than {LARGEST_SELF_SERVE_SITES} sites need a site-by-site plan")
    if any(item.product_id in LEASED_LINES for item in best_items):
        reasons.append("A leased line needs a site survey")
    return reasons


def recommend(profile: BusinessProfile, catalogue: Catalogue, peer_stats=None) -> Recommendation:
    """`peer_stats` (from product_stats.load_peer_stats) only adds facts to the explanations.
    It never changes what is chosen. Without it, the details simply have no peer facts."""
    # With no stated need, assume the basic one, since most other products depend on it.
    assumed_internet = not profile.needs
    if assumed_internet:
        profile = profile.model_copy(update={"needs": ["internet"]})

    segment = infer_segment(profile)
    wanted_ids = wanted_product_ids(profile)
    ranked = rank_candidates(build_candidates(profile, segment, catalogue), profile, segment, catalogue)
    best_items = ranked[0] if ranked else []
    best_ids = {item.product_id for item in best_items}

    not_included = explain_not_included(best_ids, wanted_ids, profile, catalogue)
    excluded_ids = {entry.product_id for entry in not_included}
    budget = profile.budget_monthly_inr
    best_monthly = calculate_quote(best_items, catalogue).monthly_total_inr
    over_budget = bool(budget is not None and best_items and best_monthly > budget)

    return Recommendation(
        segment=segment,
        bundle=(
            to_recommended_bundle(best_items, profile, segment, catalogue, peer_stats, assumed_internet=assumed_internet)
            if best_items
            else None
        ),
        alternatives=alternatives_to(best_items, ranked, profile, segment, catalogue, peer_stats, assumed_internet),
        addons=build_addons(
            best_ids, wanted_ids, excluded_ids, profile, segment, catalogue, items=best_items, peer_stats=peer_stats
        ),
        not_included=not_included,
        over_budget=over_budget,
        assisted_reasons=assisted_reasons(profile, best_items, over_budget),
    )


OWNER_CHOSE_IT = "You chose this from the rate list"


def owner_chosen_plan(
    profile: BusinessProfile, items: list[BundleItem], catalogue: Catalogue, peer_stats=None
) -> Recommendation:
    """Turns a plan the owner picked from the rate list into a quote. The caller has already checked
    it with check_bundle, so every rule that applies to a recommendation applies here too."""
    segment = infer_segment(profile)
    chosen_ids = {item.product_id for item in items}
    bundle = RecommendedBundle(
        quote=calculate_quote(items, catalogue),
        reasons={item.product_id: OWNER_CHOSE_IT for item in items},
        # The owner chose this, so there is no recommender score to show.
        score=ScoreParts(needs_covered=0, size_fit=0, simplicity=0, total=0),
        # The owner chose these, so the details have no peer facts and no score, only plain facts.
        details={
            item.product_id: product_details.build_details(
                item.product_id, profile, segment, items, catalogue, None, profile.preferred_language,
                chosen_by="owner",
            )
            for item in items
        },
    )
    return Recommendation(
        segment=segment,
        bundle=bundle,
        alternatives=[],
        addons=build_addons(chosen_ids, [], set(), profile, segment, catalogue, items=items, peer_stats=peer_stats),
        not_included=[],
        over_budget=False,
        assisted_reasons=assisted_reasons(profile, items, False),
        chosen_by="owner",
    )
