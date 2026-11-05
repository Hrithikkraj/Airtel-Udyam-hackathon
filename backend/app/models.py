"""All database tables.

Tables in the first part are loaded from the CSV files and use the same column
names as those files. Tables in the second part are filled as customers use the app.
"""
from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import relationship

from .database import Base


def utc_now():
    return datetime.now(timezone.utc)


# ---------- Loaded from the CSV files ----------

class Product(Base):
    __tablename__ = "products"

    product_id = Column(String, primary_key=True)
    category = Column(String, nullable=False)
    product_name = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    unit = Column(String, nullable=False)
    price_min_inr_per_month = Column(Integer, nullable=False)
    price_max_inr_per_month = Column(Integer, nullable=False)
    one_time_setup_inr = Column(Integer, nullable=False)
    min_contract_months = Column(Integer, nullable=False)
    available_city_tiers = Column(String, nullable=False)  # "1;2"
    min_employees = Column(Integer, nullable=False)
    min_sites = Column(Integer, nullable=False)
    requires_gstin = Column(String, nullable=False)  # "Y" or "N"
    requires_one_of = Column(String)  # "P01|P02", or empty when not needed
    typical_install_days = Column(Integer, nullable=False)
    target_segments = Column(String, nullable=False)  # "micro;prof"


class GstinRecord(Base):
    __tablename__ = "gstin_registry"

    gstin = Column(String, primary_key=True)
    legal_name = Column(String)
    trade_name = Column(String)
    constitution = Column(String)
    principal_place_of_business = Column(String)
    state = Column(String)
    registration_date = Column(String)
    status = Column(String)  # Active, Cancelled or Suspended


class UdyamRecord(Base):
    __tablename__ = "udyam_registry"

    udyam_number = Column(String, primary_key=True)
    enterprise_name = Column(String)
    enterprise_type = Column(String)
    major_activity = Column(String)
    nic_description = Column(String)
    state = Column(String)
    city = Column(String)
    date_of_registration = Column(String)


class Lead(Base):
    __tablename__ = "leads"

    lead_id = Column(String, primary_key=True)
    created_date = Column(String)
    lead_source = Column(String)
    business_name = Column(String)
    business_type = Column(String)
    segment = Column(String)
    city = Column(String)
    city_tier = Column(Integer)
    state = Column(String)
    preferred_language = Column(String)
    employee_count = Column(Integer)
    num_sites = Column(Integer)
    annual_turnover_band = Column(String)
    has_gstin = Column(String)
    gstin = Column(String)
    has_udyam = Column(String)
    udyam_number = Column(String)
    current_internet = Column(String)
    current_provider = Column(String)
    monthly_telecom_spend_inr = Column(Integer)
    products_of_interest = Column(String)
    contact_name = Column(String)
    contact_role = Column(String)
    stage_reached = Column(String)
    outcome = Column(String)
    drop_reason = Column(String)
    contacted_date = Column(String)
    needs_assessed_date = Column(String)
    quote_accepted_date = Column(String)
    kyc_complete_date = Column(String)
    activated_date = Column(String)
    days_lead_to_activation = Column(Integer)
    customer_follow_up_calls = Column(Integer)
    bundle_products = Column(String)
    monthly_bundle_value_inr = Column(Float)
    one_time_setup_inr = Column(Float)
    contract_months = Column(Integer)
    churned_within_6_months = Column(String)
    nps_score = Column(Integer)
    acquisition_cost_inr = Column(Integer)
    # Not in the CSV. Added on import by lead_score.py.
    propensity_pct = Column(Float)
    score_reasons = Column(String)


# ---------- Filled as customers use the app ----------

class Business(Base):
    __tablename__ = "businesses"

    business_id = Column(Integer, primary_key=True)
    business_name = Column(String)
    business_type = Column(String)
    employee_count = Column(Integer)
    num_sites = Column(Integer)
    city = Column(String)
    city_tier = Column(Integer)
    has_gstin = Column(String)
    preferred_language = Column(String)
    # A long random secret given only to this owner's browser. It protects their KYC and order data.
    access_token = Column(String, nullable=False)
    # A person's decision on a KYC review. Cleared when the documents change.
    kyc_review_decision = Column(String)  # approved or rejected
    kyc_review_note = Column(String)
    created_at = Column(DateTime, default=utc_now)


class Quote(Base):
    __tablename__ = "quotes"

    quote_id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.business_id"), nullable=False)
    status = Column(String, nullable=False, default="draft")
    monthly_total_inr = Column(Integer, nullable=False)
    setup_total_inr = Column(Integer, nullable=False)
    contract_months = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=utc_now)

    business = relationship("Business")
    items = relationship("QuoteItem")


class QuoteItem(Base):
    """Prices are copied here so a later catalogue change cannot alter a quote."""
    __tablename__ = "quote_items"

    quote_item_id = Column(Integer, primary_key=True)
    quote_id = Column(Integer, ForeignKey("quotes.quote_id"), nullable=False)
    product_id = Column(String, ForeignKey("products.product_id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price_inr = Column(Integer, nullable=False)
    unit_setup_inr = Column(Integer, nullable=False)


class Order(Base):
    __tablename__ = "orders"

    order_id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.business_id"), nullable=False)
    quote_id = Column(Integer, ForeignKey("quotes.quote_id"), nullable=False)
    status = Column(String, nullable=False)
    expected_activation = Column(Date)  # Set when the order is placed.
    help_requested_at = Column(DateTime)
    help_phone = Column(String)  # Deleted when the request closes.
    created_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)

    business = relationship("Business")
    quote = relationship("Quote")


class OrderEvent(Base):
    """One row for each status change. This is what the tracker timeline shows."""
    __tablename__ = "order_events"

    event_id = Column(Integer, primary_key=True)
    order_id = Column(Integer, ForeignKey("orders.order_id"), nullable=False)
    old_status = Column(String)
    new_status = Column(String, nullable=False)
    actor = Column(String, nullable=False)  # customer, system or partner
    created_at = Column(DateTime, default=utc_now)


class Consent(Base):
    """One row per purpose, so each consent can be proved or withdrawn on its own."""
    __tablename__ = "consents"

    consent_id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.business_id"), nullable=False)
    purpose = Column(String, nullable=False)
    notice_version = Column(String, nullable=False)
    granted_at = Column(DateTime, default=utc_now)
    revoked_at = Column(DateTime)


class CallbackRequest(Base):
    """An owner the advisor could not fully help, asking a person to call."""
    __tablename__ = "callback_requests"

    callback_id = Column(Integer, primary_key=True)
    phone = Column(String)  # Deleted when the request closes.
    city = Column(String)
    segment = Column(String)
    employee_count = Column(Integer)
    num_sites = Column(Integer)
    has_gstin = Column(String)
    needs = Column(JSON)
    reasons = Column(JSON)
    monthly_estimate_inr = Column(Integer)
    notice_version = Column(String, nullable=False)
    status = Column(String, nullable=False, default="open")
    created_at = Column(DateTime, default=utc_now)


class KycRecord(Base):
    __tablename__ = "kyc_records"

    kyc_id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.business_id"), nullable=False)
    document_type = Column(String, nullable=False)
    extracted_fields = Column(JSON)
    status = Column(String, nullable=False)  # verified, needs_review or failed
    reasons = Column(JSON)
    created_at = Column(DateTime, default=utc_now)
