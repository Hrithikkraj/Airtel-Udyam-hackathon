"""Checks on the answers the LLM records from the advisor chat.

The LLM is good at reading free text, but it will also record things it should not: "america" as a
city, a city the owner never typed, or a number no business has. Our own code decides what counts
as a real answer, in the same way it decides prices. An answer that fails a check is not kept, and
the owner is told why and asked again.
"""
import re

from .schemas import AdvisorTurn, CityOut

# Old and common spellings of the cities we serve.
CITY_ALIASES = {
    "bangalore": "Bengaluru",
    "bengaluru": "Bengaluru",
    "bombay": "Mumbai",
    "calcutta": "Kolkata",
    "madras": "Chennai",
    "new delhi": "Delhi",
    "vizag": "Visakhapatnam",
    "mysore": "Mysuru",
    "poona": "Pune",
    "baroda": "Vadodara",
}

# A city we do not list is accepted only when the owner names its Indian state, too.
INDIAN_STATES = [
    "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "goa", "gujarat",
    "haryana", "himachal pradesh", "jharkhand", "karnataka", "kerala", "madhya pradesh",
    "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland", "odisha", "orissa", "punjab",
    "rajasthan", "sikkim", "tamil nadu", "telangana", "tripura", "uttar pradesh", "uttarakhand",
    "west bengal", "andaman and nicobar", "chandigarh", "dadra and nagar haveli", "daman and diu",
    "delhi", "jammu and kashmir", "ladakh", "lakshadweep", "puducherry", "pondicherry",
    # The same, as owners write them in Hindi.
    "आंध्र प्रदेश", "असम", "बिहार", "छत्तीसगढ़", "गोवा", "गुजरात", "हरियाणा", "हिमाचल प्रदेश", "झारखंड",
    "कर्नाटक", "केरल", "मध्य प्रदेश", "महाराष्ट्र", "ओडिशा", "पंजाब", "राजस्थान", "तमिलनाडु", "तमिल नाडु",
    "तेलंगाना", "उत्तर प्रदेश", "उत्तराखंड", "पश्चिम बंगाल", "दिल्ली", "जम्मू और कश्मीर",
]
DEVANAGARI = re.compile(r"[ऀ-ॿ]")

# Smallest and largest believable values. Anything outside is a typing mistake or not an answer.
NUMBER_LIMITS = {
    "employee_count": (1, 100_000),
    "num_sites": (1, 10_000),
    "budget_monthly_inr": (100, 10_000_000),
    "camera_count": (1, 10_000),
    "mobile_line_count": (1, 10_000),
    "vehicle_count": (1, 10_000),
    "machine_count": (1, 10_000),
}

GREETING = re.compile(
    r"^\s*(hi+|hello+|hey+|hii+|namaste|namaskar|नमस्ते|नमस्कार|good\s+(morning|afternoon|evening))[\s!.,]*$",
    re.IGNORECASE,
)

# What the owner is asked, by the step that is still missing. English and Hindi.
QUESTIONS = {
    "kind": (
        "What kind of business do you run? For example a shop, clinic, office or factory.",
        "आप किस तरह का व्यवसाय चलाते हैं? जैसे दुकान, क्लिनिक, दफ़्तर या फ़ैक्ट्री।",
    ),
    "people": ("How many people work there?", "वहाँ कितने लोग काम करते हैं?"),
    "branches": ("How many branches do you have?", "आपकी कितनी शाखाएँ हैं?"),
    "city": ("Which city is your business in?", "आपका व्यवसाय किस शहर में है?"),
    "gstin": ("Do you have a GSTIN? Please answer yes or no.", "क्या आपके पास GSTIN है? हाँ या नहीं में बताएँ।"),
    "needs": (
        "What does your business need? For example internet, business SIMs, WhatsApp, billing, email or CCTV.",
        "आपके व्यवसाय को क्या चाहिए? जैसे इंटरनेट, बिज़नेस सिम, WhatsApp, बिलिंग, ईमेल या सीसीटीवी।",
    ),
    "internet": (
        "What internet do you use today? For example mobile hotspot, home broadband, or none.",
        "अभी आप कौन सा इंटरनेट इस्तेमाल करते हैं? जैसे मोबाइल हॉटस्पॉट, होम ब्रॉडबैंड, या कोई नहीं।",
    ),
}
NOT_UNDERSTOOD = ("Sorry, I didn't catch that.", "माफ़ कीजिए, मैं समझ नहीं पाया।")
HELLO = ("Hello!", "नमस्ते!")


def in_hindi(language: str) -> bool:
    return language == "Hindi"


def ask(step: str, language: str) -> str:
    english, hindi = QUESTIONS[step]
    return hindi if in_hindi(language) else english


def not_understood(latest_message: str, language: str) -> str:
    """A greeting gets a greeting back. Anything else that gave no answer gets a short apology."""
    pair = HELLO if GREETING.match(latest_message) else NOT_UNDERSTOOD
    return pair[1] if in_hindi(language) else pair[0]


def simplify(text: str) -> str:
    return re.sub(r"[^a-zऀ-ॿ]+", " ", text.lower()).strip()


def city_we_serve(name: str, cities: list[CityOut]) -> str | None:
    """The city's spelling in our list, if we serve it, including its common old names."""
    wanted = simplify(name)
    for city in cities:
        if simplify(city.city) == wanted:
            return city.city
    return CITY_ALIASES.get(wanted)


def names_an_indian_state(text: str) -> bool:
    simple = f" {simplify(text)} "
    return any(f" {state} " in simple for state in INDIAN_STATES)


def owner_typed(value: str, owner_texts: list[str]) -> bool:
    """The LLM may only record a place the owner actually wrote."""
    wanted = simplify(value)
    return bool(wanted) and any(wanted in simplify(text) for text in owner_texts)


def city_not_served(name: str, cities: list[CityOut], language: str) -> str:
    served = ", ".join(city.city for city in cities)
    if in_hindi(language):
        return (
            f"हमें \"{name}\" उन शहरों में नहीं मिला जहाँ हम सेवा देते हैं: {served}। "
            "अगर आपका व्यवसाय भारत के किसी और शहर में है, तो शहर के साथ राज्य भी लिखें, जैसे \"आगरा, उत्तर प्रदेश\"।"
        )
    return (
        f"We could not find \"{name}\" among the cities we serve: {served}. "
        "If your business is in another city in India, type the city with its state, for example \"Agra, Uttar Pradesh\"."
    )


def number_problem(field: str, value: int, language: str) -> str:
    if in_hindi(language):
        return f"\"{value}\" सही संख्या नहीं लगती।"
    names = {
        "employee_count": "the number of people working there",
        "num_sites": "the number of branches",
        "budget_monthly_inr": "a monthly budget in rupees",
    }
    return f"\"{value}\" does not look like {names.get(field, 'a sensible number')}."


def check_new_answers(
    turn: AdvisorTurn, owner_texts: list[str], cities: list[CityOut], language: str
) -> tuple[AdvisorTurn, list[str]]:
    """Returns the turn with only believable answers kept, and a message for each answer refused."""
    keep: dict = {}
    problems: list[str] = []

    if turn.city is not None:
        known = city_we_serve(turn.city, cities)
        # The owner typed "Bangalore" and the LLM wrote "Bengaluru": that still counts as typed.
        spellings = [turn.city] + [old for old, proper in CITY_ALIASES.items() if proper == known]
        # A city written in Hindi comes back in English letters, so it cannot be matched by spelling.
        written_in_hindi = bool(DEVANAGARI.search(owner_texts[-1]))
        if not written_in_hindi and not any(owner_typed(spelling, owner_texts) for spelling in spellings):
            keep["city"] = None  # The owner never wrote this place. The LLM made it up.
        elif known:
            keep["city"] = known
        elif names_an_indian_state(turn.city) or names_an_indian_state(owner_texts[-1]):
            keep["city"] = turn.city.split(",")[0].strip().title()  # "Agra, Uttar Pradesh" is kept as "Agra"
        else:
            keep["city"] = None
            problems.append(city_not_served(turn.city.strip(), cities, language))

    for field, (smallest, largest) in NUMBER_LIMITS.items():
        value = getattr(turn, field)
        if value is not None and not smallest <= value <= largest:
            keep[field] = None
            if field in ("employee_count", "num_sites", "budget_monthly_inr"):
                problems.append(number_problem(field, value, language))

    return turn.model_copy(update=keep), problems
