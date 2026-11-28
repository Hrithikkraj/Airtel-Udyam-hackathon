"""The shape of the data our API accepts and sends back."""
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

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
    # Products this business already has from us, on an earlier order. They count as present when a
    # product needs a partner (CCTV needs a connection) and are not suggested again. The server sets
    # this itself from the business's orders before saving, so a browser cannot claim what it lacks.
    owned_product_ids: list[str] = Field(default=[], max_length=40)


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


class DetailPrice(BaseModel):
    """One product's money, copied from calculate_quote. Nothing here is calculated a second way."""
    unit_price_inr: int = 0
    quantity: int = 0
    monthly_inr: int = 0
    setup_inr: int = 0
    range_min_inr: int = 0
    range_max_inr: int = 0
    share_of_bill_pct: int = 0  # 0 when the bill total is 0.


class OtherOption(BaseModel):
    product_id: str
    name: str
    difference: str


class Upgrade(BaseModel):
    product_id: str
    name: str
    extra_monthly_inr: int
    note: str


class ProductDetail(BaseModel):
    """Why we chose a product, and what the owner should know about it. Written by our own code."""
    product_id: str = ""
    what_you_get: str = ""  # The catalogue description, unchanged.
    why: list[str] = []  # Most important first, at most 4.
    good_to_know: list[str] = []
    price: DetailPrice = DetailPrice()
    why_not_others: list[OtherOption] = []  # Connections only, at most 2.
    upgrade: Upgrade | None = None
    if_removed: str | None = None


class RecommendedBundle(BaseModel):
    quote: QuoteOut
    reasons: dict[str, str]  # product_id -> why it is in the bundle
    score: ScoreParts
    details: dict[str, ProductDetail] = {}  # product_id -> the longer explanation


class AddOn(BaseModel):
    product_id: str
    name: str
    quantity: int
    monthly_inr: int
    setup_inr: int
    reason: str
    detail: ProductDetail | None = None


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
    # "advisor" when our recommender chose the bundle, "owner" when the owner picked it from the rate list.
    chosen_by: Literal["advisor", "owner"] = "advisor"


class SaveQuoteRequest(QuoteRequest):
    business_name: str | None = Field(default=None, max_length=120)
    business_type: str | None = Field(default=None, max_length=80)
    city: str | None = Field(default=None, max_length=60)
    # Who built the bundle, so a reopened quote explains it the same way.
    chosen_by: Literal["advisor", "owner"] = "advisor"
    # Set when the owner orders again for a business they already have. The new order joins that
    # business, so its details and its verified documents are used again.
    business_id: int | None = None


class AcceptedQuoteOut(BaseModel):
    """An accepted quote, rebuilt so the owner can look at it again or change it."""
    profile: BusinessProfile
    recommendation: Recommendation
    city: str | None = None
    can_change: bool  # False once the order is placed or cancelled.
    business_name: str | None = None
    business_type: str | None = None


class QuoteSaved(BaseModel):
    quote_id: int
    order_id: int
    business_id: int
    access_token: str
    status: str
    quote: QuoteOut
    # Where the new order starts. kyc_complete when the business was already verified.
    order_status: str = ""


class CityOut(BaseModel):
    city: str
    city_tier: int


class AdvisorStatus(BaseModel):
    available: bool


class VoiceTranscript(BaseModel):
    """What the owner said into the microphone, as text they can check before sending."""
    text: str


class AdvisorMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class AdvisorAnswers(BaseModel):
    """What the owner has told the advisor so far. It has no field for a product or a price."""
    # Only shown on the quote and saved on the business. They never change what is recommended.
    business_name: str | None = None
    business_type: str | None = None
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

    @field_validator("business_name", "business_type", mode="before")
    @classmethod
    def short_text(cls, value, info):
        # A long or odd value from the LLM must not fail the whole turn, so it is trimmed instead.
        if not isinstance(value, str):
            return None
        limit = 120 if info.field_name == "business_name" else 80
        return " ".join(value.split())[:limit] or None


class AdvisorRequest(BaseModel):
    messages: list[AdvisorMessage] = Field(min_length=1, max_length=40)
    preferred_language: str = Field(default="English", max_length=30)
    answers: AdvisorAnswers = AdvisorAnswers()  # The browser sends these back each turn.
    # Set when the owner shops again for a business they already have. The server then reads what
    # that business already has from us, so the advisor builds on it instead of starting over.
    business_id: int | None = None


class AdvisorTurn(AdvisorAnswers):
    """What the LLM extracts from a turn and how it should respond."""
    reply: str
    replace_needs: bool = False
    reply_only: bool = False
    # The language of the owner's latest message, which is the language of the reply. Our code checks
    # it (answer_checks.normalize_language), so a missing, odd or very long value is never used as is.
    language: str = Field(
        default="",
        description="Full English name of the language of the reply, such as English, Hindi, Hinglish or Tamil",
    )

    @field_validator("language", mode="before")
    @classmethod
    def language_is_text(cls, value):
        # A null or a number from the LLM must not fail the whole turn. Our code treats "" as unknown.
        return value if isinstance(value, str) else ""


class AdvisorResponse(BaseModel):
    reply: str
    answers: AdvisorAnswers
    # The language the chat is in now. The browser sends it back as the next hint.
    language: str
    profile: BusinessProfile | None = None
    recommendation: Recommendation | None = None
