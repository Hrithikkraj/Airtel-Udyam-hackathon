"""The shape of the data our API accepts and sends back."""
from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Every need the advisor may send. Anything else is rejected, so the LLM cannot invent one.
Need = Literal[
    "internet",
    "high_speed_internet",
    "dedicated_internet",
    "mobile_lines",
    "premium_mobile_lines",
    "failover",
    "multi_site_management",
    "static_ip",
    "phone_system",
    "toll_free",
    "bulk_sms",
    "whatsapp",
    "email_office",
    "cloud_backup",
    "website",
    "pos_billing",
    "endpoint_security",
    "firewall",
    "guest_wifi",
    "cctv",
    "machine_monitoring",
    "fleet_tracking",
]


# A 10-digit Indian mobile number.
PhoneNumber = Annotated[str, Field(pattern=r"^[6-9]\d{9}$")]

CurrentInternet = Literal["mobile_hotspot", "home_broadband", "business_broadband", "leased_line", "mixed", "none"]


class ProductOut(BaseModel):
    product_id: str
    category: str
    name: str
    description: str
    unit: str
    price_min_inr: int
    price_max_inr: int
    setup_fee_inr: int
    min_contract_months: int
    city_tiers: list[int]
    min_employees: int
    min_sites: int
    requires_gstin: bool
    requires_one_of: list[str]
    install_days: int
    target_segments: list[str]


class BusinessProfile(BaseModel):
    """What the advisor learns about a business. Only what bundle choice needs."""
    employee_count: int = Field(ge=1)
    num_sites: int = Field(default=1, ge=1)
    city_tier: Literal[1, 2]
    has_gstin: bool
    fibre_available: bool = True
    segment: Literal["micro", "prof", "multi", "mfg"] | None = None
    needs: list[Need] = []  # Most important first. Budget cuts remove the last ones first.
    budget_monthly_inr: int | None = Field(default=None, ge=1)
    # Exact answers, such as {"P23": 4} for four cameras.
    quantities: dict[str, Annotated[int, Field(ge=1)]] = {}
    current_internet: CurrentInternet | None = None  # Only used to explain the change.
    preferred_language: str = Field(default="English", max_length=30)


class BundleItem(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1)


class QuoteLine(BaseModel):
    product_id: str
    name: str
    unit: str
    quantity: int
    unit_price_inr: int
    monthly_inr: int
    setup_inr: int


class QuoteOut(BaseModel):
    lines: list[QuoteLine]
    monthly_total_inr: int
    setup_total_inr: int
    contract_months: int
    install_days: int


class QuoteRequest(BaseModel):
    profile: BusinessProfile
    items: list[BundleItem]


class ScoreParts(BaseModel):
    """Each part is shown so the choice can be explained."""
    needs_covered: int  # Out of 60
    size_fit: int  # Out of 30
    simplicity: int  # Out of 10
    total: int


class RecommendedBundle(BaseModel):
    quote: QuoteOut
    reasons: dict[str, str]  # product_id -> why it is in the bundle
    score: ScoreParts


class AddOn(BaseModel):
    product_id: str
    name: str
    quantity: int
    monthly_inr: int
    setup_inr: int
    reason: str


class NotIncluded(BaseModel):
    product_id: str
    name: str
    reasons: list[str]


class Recommendation(BaseModel):
    segment: str
    bundle: RecommendedBundle | None
    alternatives: list[RecommendedBundle]
    addons: list[AddOn]
    not_included: list[NotIncluded]
    over_budget: bool
    assisted_reasons: list[str]  # Empty when the owner can finish alone.
    explanation: str = ""


class SaveQuoteRequest(QuoteRequest):
    business_name: str | None = Field(default=None, max_length=120)
    city: str | None = Field(default=None, max_length=60)


class QuoteSaved(BaseModel):
    quote_id: int
    order_id: int
    business_id: int
    access_token: str
    status: str
    quote: QuoteOut


class CityOut(BaseModel):
    city: str
    city_tier: int


class AdvisorStatus(BaseModel):
    available: bool


class AdvisorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class AdvisorAnswers(BaseModel):
    """What the owner has told the advisor so far. It has no field for a product or a price."""
    employee_count: int | None = None
    num_sites: int | None = None
    city: str | None = Field(default=None, max_length=60)
    has_gstin: bool | None = None
    fibre_available: bool | None = None
    segment: Literal["micro", "prof", "multi", "mfg"] | None = None
    current_internet: CurrentInternet | None = None
    needs: list[Need] = []
    budget_monthly_inr: int | None = None
    camera_count: int | None = None
    mobile_line_count: int | None = None
    vehicle_count: int | None = None
    machine_count: int | None = None


class AdvisorRequest(BaseModel):
    messages: list[AdvisorMessage] = Field(min_length=1, max_length=40)
    preferred_language: str = Field(default="English", max_length=30)
    answers: AdvisorAnswers = AdvisorAnswers()  # The browser sends these back each turn.


class AdvisorTurn(AdvisorAnswers):
    """What the LLM must return each turn: the next message, plus any new answers."""
    reply: str


class AdvisorResponse(BaseModel):
    reply: str
    answers: AdvisorAnswers
    profile: BusinessProfile | None = None
    recommendation: Recommendation | None = None
