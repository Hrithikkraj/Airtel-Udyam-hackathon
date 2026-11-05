"""Funnel numbers for the staff dashboard, worked out from the lead data each time."""
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .catalogue import load_catalogue
from .lead_score import measure_quality
from .import_data import DATA_DIR
from .models import Lead, Order
from .rules import check_bundle
from .schemas import BundleItem, BusinessProfile

# Order matters: a lead that reached a stage also passed every stage before it.
STAGES = ["Lead", "Contacted", "Needs assessed", "Quote accepted", "KYC complete", "Activated"]

# These targets are hypotheses for a pilot, not forecasts.
TARGETS = {
    "lead_to_activation_pct": 10,
    "average_days_to_activate": 7,
    "follow_up_calls": 1,
    "quote_acceptance_pct": 55,
    "kyc_completion_pct": 80,
}


def stage_counts(leads: pd.DataFrame) -> list[dict]:
    reached = leads["stage_reached"].map(STAGES.index)
    stages = []
    previous = None
    for position, stage in enumerate(STAGES):
        count = int((reached >= position).sum())
        stages.append(
            {
                "stage": stage,
                "count": count,
                "pct_of_previous": round(count / previous * 100, 1) if previous else None,
                "lost": previous - count if previous else 0,
            }
        )
        previous = count
    return stages


def group_summary(leads: pd.DataFrame, column: str) -> list[dict]:
    """Conversion and true cost per activation. Cost includes leads that never activated."""
    rows = []
    for name, group in leads.groupby(column):
        activated = group[group["outcome"] == "Activated"]
        count = len(activated)
        rows.append(
            {
                "name": name,
                "leads": len(group),
                "activated": count,
                "activation_pct": round(count / len(group) * 100, 1),
                "cost_per_activation_inr": round(group["acquisition_cost_inr"].sum() / count) if count else None,
                "median_bundle_inr": round(activated["monthly_bundle_value_inr"].median()) if count else None,
                "churn_pct": round((activated["churned_within_6_months"] == "Y").mean() * 100, 1) if count else None,
            }
        )
    return sorted(rows, key=lambda row: row["activation_pct"], reverse=True)


def drop_reasons(leads: pd.DataFrame) -> list[dict]:
    """For each stage, the reasons leads stopped there. These counts explain each funnel step."""
    dropped = leads[leads["outcome"] == "Dropped"]
    results = []
    for stage in STAGES[:-1]:
        at_stage = dropped[dropped["stage_reached"] == stage]
        counts = at_stage["drop_reason"].value_counts()
        results.append(
            {
                "stage": stage,
                "total": len(at_stage),
                "reasons": [{"reason": reason, "count": int(count)} for reason, count in counts.items()],
            }
        )
    return results


def bundles_breaking_rules(activated: pd.DataFrame, db: Session) -> int:
    """How many sold bundles our own rules would have refused."""
    catalogue = load_catalogue(db)
    broken = 0
    for lead in activated.itertuples():
        profile = BusinessProfile(
            employee_count=lead.employee_count,
            num_sites=lead.num_sites,
            city_tier=lead.city_tier,
            has_gstin=lead.has_gstin == "Y",
        )
        items = [
            BundleItem(product_id=part.split("x")[0], quantity=int(part.split("x")[1]))
            for part in lead.bundle_products.split(";")
        ]
        if check_bundle(items, profile, catalogue):
            broken += 1
    return broken


def funnel_summary(db: Session) -> dict:
    leads = pd.read_sql(select(Lead), db.connection())
    activated = leads[leads["outcome"] == "Activated"]
    stages = stage_counts(leads)
    by_stage = {stage["stage"]: stage for stage in stages}
    live_orders = dict(db.execute(select(Order.status, func.count()).group_by(Order.status)).all())

    return {
        "stages": stages,
        "kpis": {
            "lead_to_activation_pct": round(len(activated) / len(leads) * 100, 2),
            "average_days_to_activate": round(activated["days_lead_to_activation"].mean(), 1),
            "follow_up_calls": round(activated["customer_follow_up_calls"].mean(), 1),
            "cost_per_activation_inr": round(leads["acquisition_cost_inr"].sum() / len(activated)),
            "churn_pct": round((activated["churned_within_6_months"] == "Y").mean() * 100, 1),
            "average_nps": round(activated["nps_score"].mean(), 1),
            "quote_acceptance_pct": by_stage["Quote accepted"]["pct_of_previous"],
            "kyc_completion_pct": by_stage["KYC complete"]["pct_of_previous"],
        },
        "targets": TARGETS,
        "by_segment": group_summary(leads, "segment"),
        "by_source": group_summary(leads, "lead_source"),
        "drop_reasons": drop_reasons(leads),
        "bundles_breaking_rules": bundles_breaking_rules(activated, db),
        "activated_bundles": len(activated),
        "score_quality": measure_quality(str(DATA_DIR / "smb_leads.csv")),
        "live_orders": live_orders,
    }
