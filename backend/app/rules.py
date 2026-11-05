"""Catalogue rules: what a business may buy. These are the only rules that decide this.

The advisor, the quote screen and any partner tool all pass through check_bundle,
so an invalid bundle cannot be priced, whatever the LLM or the browser sends.
"""
from .schemas import BundleItem, BusinessProfile, ProductOut

# Not a catalogue column: the catalogue describes these as needing fibre at the site.
FIBRE_PRODUCTS = {"P01", "P02", "P03"}

Catalogue = dict[str, ProductOut]


def ineligibility_reasons(product: ProductOut, profile: BusinessProfile) -> list[str]:
    """Why this business cannot buy this product. An empty list means it can."""
    reasons = []
    if profile.city_tier not in product.city_tiers:
        reasons.append(f"{product.name} is not sold in tier {profile.city_tier} cities")
    if profile.employee_count < product.min_employees:
        reasons.append(f"{product.name} needs at least {product.min_employees} employees")
    if profile.num_sites < product.min_sites:
        reasons.append(f"{product.name} needs at least {product.min_sites} sites")
    if product.requires_gstin and not profile.has_gstin:
        reasons.append(f"{product.name} needs an active GSTIN")
    if product.product_id in FIBRE_PRODUCTS and not profile.fibre_available:
        reasons.append(f"{product.name} needs fibre at your site")
    return reasons


def missing_dependency(product: ProductOut, bundle_ids: set[str], catalogue: Catalogue) -> str | None:
    """Explain the problem if the product needs a partner product that is not in the bundle."""
    if not product.requires_one_of or bundle_ids.intersection(product.requires_one_of):
        return None
    names = ", ".join(catalogue[product_id].name for product_id in product.requires_one_of)
    return f"{product.name} only works with one of these: {names}"


def check_bundle(items: list[BundleItem], profile: BusinessProfile, catalogue: Catalogue) -> list[str]:
    """Return every problem with this bundle. An empty list means it can be sold."""
    errors = []
    ids = [item.product_id for item in items]

    if not items:
        errors.append("The bundle has no products")

    for product_id in set(ids):
        if ids.count(product_id) > 1:
            errors.append(f"{product_id} is listed more than once")

    known_ids = {product_id for product_id in ids if product_id in catalogue}
    for product_id in sorted(set(ids) - known_ids):
        errors.append(f"{product_id} is not in the catalogue")

    for product_id in sorted(known_ids):
        product = catalogue[product_id]
        errors.extend(ineligibility_reasons(product, profile))
        problem = missing_dependency(product, known_ids, catalogue)
        if problem:
            errors.append(problem)
    return errors
