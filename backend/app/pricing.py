"""Pricing: the only place that calculates money.

Three rules, all checked against the 368 activated bundles in smb_leads.csv:
- Unit price is the middle of the catalogue range. Sold bundles sit inside the range,
  48% of the way up on average, so the middle is the fairest single price.
- Setup fee is the unit fee times quantity (matches all 368).
- Contract length is the longest minimum in the bundle (matches all 368).
"""
from .rules import Catalogue
from .schemas import BundleItem, ProductOut, QuoteLine, QuoteOut


def unit_price(product: ProductOut) -> int:
    # Adding 1 before dividing rounds half-rupees up, so 137.50 becomes 138.
    return (product.price_min_inr + product.price_max_inr + 1) // 2


def calculate_quote(items: list[BundleItem], catalogue: Catalogue) -> QuoteOut:
    lines = []
    for item in items:
        product = catalogue[item.product_id]
        price = unit_price(product)
        lines.append(
            QuoteLine(
                product_id=product.product_id,
                name=product.name,
                unit=product.unit,
                quantity=item.quantity,
                unit_price_inr=price,
                monthly_inr=price * item.quantity,
                setup_inr=product.setup_fee_inr * item.quantity,
            )
        )

    products = [catalogue[item.product_id] for item in items]
    return QuoteOut(
        lines=lines,
        monthly_total_inr=sum(line.monthly_inr for line in lines),
        setup_total_inr=sum(line.setup_inr for line in lines),
        contract_months=max((p.min_contract_months for p in products), default=0),
        install_days=max((p.install_days for p in products), default=0),
    )
