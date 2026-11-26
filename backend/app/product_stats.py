"""What similar businesses bought, from the activated leads in smb_leads.csv.

Used only to tell an owner a true fact, such as "62% of the 120 similar businesses we onboarded also
chose this". A number from a small sample can mislead, so a segment with fewer than MIN_SAMPLE
activated businesses gives no number at all. If the leads table is empty or missing, there are no
facts and everything else still works.
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .models import Lead

MIN_SAMPLE = 30

# Lead segment names, mapped to the recommender's segments in the same order.
LEAD_SEGMENTS = {
    "Micro retail & services": "micro",
    "Professional offices": "prof",
    "Small multi-site businesses": "multi",
    "Small manufacturers": "mfg",
}


@dataclass(frozen=True)
class PeerStat:
    pct: int  # Whole percent, 1 to 100.
    n: int  # Activated businesses in this segment.


# segment -> product_id -> PeerStat
PeerStats = dict[str, dict[str, PeerStat]]


def products_in(bundle_products: str | None) -> set[str]:
    """"P01x1;P07x2" -> {"P01", "P07"}. Each product counts once per business."""
    if not bundle_products:
        return set()
    products = set()
    for part in bundle_products.split(";"):
        product_id = part.strip().split("x")[0].strip()
        if product_id:
            products.add(product_id)
    return products


def peer_stats_from_rows(rows) -> PeerStats:
    """rows: (lead segment name, bundle_products) for activated leads only."""
    counts: dict[str, dict[str, int]] = {}
    totals: dict[str, int] = {}
    for lead_segment, bundle_products in rows:
        segment = LEAD_SEGMENTS.get(lead_segment)
        if segment is None:
            continue
        totals[segment] = totals.get(segment, 0) + 1
        bought_in_segment = counts.setdefault(segment, {})
        for product_id in products_in(bundle_products):
            bought_in_segment[product_id] = bought_in_segment.get(product_id, 0) + 1

    stats: PeerStats = {}
    for segment, n in totals.items():
        if n < MIN_SAMPLE:
            continue
        for product_id, bought in counts.get(segment, {}).items():
            pct = max(0, min(100, round(bought * 100 / n)))
            if pct > 0:  # "0% chose this" is not a reason to suggest anything.
                stats.setdefault(segment, {})[product_id] = PeerStat(pct=pct, n=n)
    return stats


def load_peer_stats(db: Session) -> PeerStats:
    try:
        rows = db.execute(select(Lead.segment, Lead.bundle_products).where(Lead.outcome == "Activated")).all()
    except SQLAlchemyError:
        return {}
    return peer_stats_from_rows(rows)


def peer_stat(stats: PeerStats | None, segment: str, product_id: str) -> PeerStat | None:
    if not stats:
        return None
    return stats.get(segment, {}).get(product_id)
