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
    r"^\s*(hi+(?:\s+there)?|hello+(?:\s+there)?|hey(?:\s+there)?|namaste|namaskar|नमस्ते|नमस्कार|nice\s+to\s+meet\s+you(?:\s+too)?|good\s+(morning|afternoon|evening))[\s!.,]*$",
    re.IGNORECASE,
)

# What the owner is asked, by the step that is still missing. English and Hindi.
QUESTIONS = {
    "kind": (
        "Let's start with your business—what do you do? A shop, clinic, office or factory, for example.",
        "पहले आपके व्यवसाय से शुरू करते हैं—आप क्या काम करते हैं? जैसे दुकान, क्लिनिक, दफ़्तर या फ़ैक्ट्री।",
    ),
    "people": ("And roughly how many people work there?", "और वहाँ करीब कितने लोग काम करते हैं?"),
    "branches": ("How many locations or branches do you have? An estimate is fine.", "आपकी कितनी जगहें या शाखाएँ हैं? अंदाज़ा भी चलेगा।"),
    "city": ("Which city is the business based in?", "आपका व्यवसाय किस शहर में है?"),
    "gstin": (
        "One quick check: does the business have a GSTIN? Just yes or no is fine.",
        "एक छोटी-सी ज़रूरी बात: क्या आपके व्यवसाय के पास GSTIN है? हाँ या नहीं काफ़ी है।",
    ),
    "needs": (
        "What would help most right now—reliable internet, business SIMs, billing, WhatsApp, email, CCTV or something else?",
        "अभी आपके काम में सबसे ज़्यादा क्या मदद करेगा—अच्छा इंटरनेट, बिज़नेस सिम, बिलिंग, WhatsApp, ईमेल, CCTV या कुछ और?",
    ),
    "internet": (
        "And what do you use for internet at the moment—a mobile hotspot, home broadband, business broadband or none?",
        "और अभी आप इंटरनेट के लिए क्या इस्तेमाल करते हैं—मोबाइल हॉटस्पॉट, होम ब्रॉडबैंड, बिज़नेस ब्रॉडबैंड या कुछ नहीं?",
    ),
}
HELLO = ("Hi! Nice to meet you too.", "नमस्ते! आपसे मिलकर अच्छा लगा।")


def in_hindi(language: str) -> bool:
    return language == "Hindi"


def ask(step: str, language: str) -> str:
    english, hindi = QUESTIONS[step]
    return hindi if in_hindi(language) else english


def greeting_reply(latest_message: str, language: str) -> str | None:
    if not GREETING.match(latest_message):
        return None
    return HELLO[1] if in_hindi(language) else HELLO[0]


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


def city_not_served(name: str, language: str) -> str:
    if in_hindi(language):
        return (
            f"मुझे \"{name}\" अभी हमारे सेवा वाले शहरों में नहीं मिला। "
            "अगर आपका व्यवसाय भारत के किसी और शहर में है, तो राज्य का नाम भी बता देंगे? जैसे \"आगरा, उत्तर प्रदेश\"।"
        )
    return (
        f"I couldn't match \"{name}\" to a location we currently serve. "
        "If it's another city in India, could you share the state too? For example, \"Agra, Uttar Pradesh\"."
    )


def number_problem(field: str, value: int, language: str) -> str:
    if in_hindi(language):
        return f"\"{value}\" संख्या थोड़ी गलत लग रही है—क्या आप इसे जाँच सकते हैं?"
    names = {
        "employee_count": "the number of people working there",
        "num_sites": "the number of branches",
        "budget_monthly_inr": "a monthly budget in rupees",
    }
    return f"\"{value}\" seems a little off for {names.get(field, 'that number')}. Could you check it?"


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
            problems.append(city_not_served(turn.city.strip(), language))

    for field, (smallest, largest) in NUMBER_LIMITS.items():
        value = getattr(turn, field)
        if value is not None and not smallest <= value <= largest:
            keep[field] = None
            if field in ("employee_count", "num_sites", "budget_monthly_inr"):
                problems.append(number_problem(field, value, language))

    return turn.model_copy(update=keep), problems
