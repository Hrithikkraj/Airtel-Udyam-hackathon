"""Checks on the answers the LLM records from the advisor chat.

The LLM is good at reading free text, but it will also record things it should not: "america" as a
city, a city the owner never typed, or a number no business has. Our own code decides what counts
as a real answer, in the same way it decides prices. An answer that fails a check is not kept, and
the owner is told why and asked again.

Owners may write in any Indian language, in its own script or in English letters, so these checks
work on any script, not only English and Devanagari.
"""
import re
import unicodedata

from .schemas import AdvisorTurn, CityOut
from .translate import say

# A fixed message in English and in Hindi. Other languages are translated from the English.
Text = tuple[str, str]

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
    # The same, as owners write them in Hindi and Marathi.
    "आंध्र प्रदेश", "असम", "बिहार", "छत्तीसगढ़", "गोवा", "गुजरात", "हरियाणा", "हिमाचल प्रदेश", "झारखंड",
    "कर्नाटक", "केरल", "मध्य प्रदेश", "महाराष्ट्र", "ओडिशा", "पंजाब", "राजस्थान", "तमिलनाडु", "तमिल नाडु",
    "तेलंगाना", "उत्तर प्रदेश", "उत्तराखंड", "पश्चिम बंगाल", "दिल्ली", "जम्मू और कश्मीर",
    "मध्यप्रदेश", "उत्तरप्रदेश", "तेलंगणा", "कर्नाटका",
    # Tamil
    "தமிழ்நாடு", "தமிழ் நாடு", "கர்நாடகா", "கர்நாடக", "கேரளா", "கேரளம்", "ஆந்திர", "ஆந்திரா", "தெலங்கானா",
    "புதுச்சேரி", "மகாராஷ்டிரா", "டெல்லி",
    # Telugu
    "ఆంధ్ర ప్రదేశ్", "ఆంధ్రప్రదేశ్", "తెలంగాణ", "కర్ణాటక", "తమిళనాడు", "కేరళ", "మహారాష్ట్ర", "ఢిల్లీ", "ఒడిశా",
    # Kannada
    "ಕರ್ನಾಟಕ", "ಕೇರಳ", "ತಮಿಳುನಾಡು", "ಆಂಧ್ರ ಪ್ರದೇಶ", "ತೆಲಂಗಾಣ", "ಮಹಾರಾಷ್ಟ್ರ", "ಗೋವಾ",
    # Malayalam
    "കേരളം", "കേരള", "തമിഴ്നാട്", "കർണാടക",
    # Bengali and Assamese
    "পশ্চিমবঙ্গ", "পশ্চিম বঙ্গ", "আসাম", "অসম", "ত্রিপুরা", "বিহার", "ওড়িশা", "ঝাড়খণ্ড",
    # Gujarati
    "ગુજરાત", "મહારાષ્ટ્ર", "રાજસ્થાન",
    # Punjabi
    "ਪੰਜਾਬ", "ਹਰਿਆਣਾ", "ਹਿਮਾਚਲ ਪ੍ਰਦੇਸ਼", "ਦਿੱਲੀ", "ਚੰਡੀਗੜ੍ਹ",
    # Odia
    "ଓଡ଼ିଶା", "ଓଡିଶା",
    # Urdu
    "اتر پردیش", "بہار", "جموں و کشمیر", "دہلی", "تلنگانہ", "مہاراشٹر", "پنجاب",
]

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
    r"^\s*(?:(?:hi+|hello+|helo|hey)(?:\s+there)?|namaste|namaskar(?:am|a)?|nomoskar|vanakkam|vanakam"
    r"|sat\s+s(?:h)?ri\s+akaa?l|kem\s+cho|ram\s+ram|salaam|as+alamu?\s*alaikum"
    r"|nice\s+to\s+meet\s+you(?:\s+too)?|good\s+(?:morning|afternoon|evening)"
    r"|नमस्ते|नमस्कार|राम\s+राम|வணக்கம்|నమస్కారం|నమస్తే|ನಮಸ್ಕಾರ|ನಮಸ್ತೆ|നമസ്കാരം|নমস্কার|নমস্তে"
    r"|ਸਤ\s+ਸ੍ਰੀ\s+ਅਕਾਲ|કેમ\s+છો|નમસ્તે|ନମସ୍କାର|السلام\s+علیکم|آداب)"
    r"(?:\s+(?:ji|जी|sir|madam|bhai|bhaiya|anna|garu))?[\s!.,।🙏]*$",
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


# ---------- The language of the chat ----------

LANGUAGE_NAME = re.compile(r"^[A-Za-z][A-Za-z -]{0,29}$")
LANGUAGE_ALIASES = {
    "english": "English",
    "hindi": "Hindi",
    "hinglish": "Hinglish",
    "roman hindi": "Hinglish",
    "romanized hindi": "Hinglish",
    "romanised hindi": "Hinglish",
    "bangla": "Bengali",
    "oriya": "Odia",
}
# "Hindi (romanized)" and similar are Hinglish, even though the brackets are not a plain name.
ROMAN_HINDI = re.compile(r"hindi\s*\((?:romani[sz]ed|roman|latin)(?:\s+script)?\)")
# A value the LLM or a browser might send that is not the name of a language.
NOT_A_LANGUAGE = {
    "unknown", "none", "null", "undefined", "other", "mixed", "same", "previous", "auto", "na", "n",
    "ignore", "rule", "rules", "instruction", "instructions", "prompt", "system", "pirate", "reply",
    "respond", "answer", "language", "forget", "pretend", "act", "mode", "developer", "admin", "price",
    "free", "all", "please", "say", "tell", "you", "must", "jailbreak",
}

# Short replies that say nothing about the owner's language, so the chat keeps its language.
NEUTRAL_WORDS = {
    "ok", "okay", "okk", "k", "yes", "yeah", "yep", "no", "nope", "y", "n", "gst", "gstin", "udyam",
    "skip", "sure", "done", "hmm", "hi", "hello", "hey", "thanks", "thank", "you", "sim", "sims",
    "cctv", "wifi", "internet",
}

# Used to spot a message that only asks for a language, such as "Hindi mein baat karo".
LANGUAGE_WORDS = [
    "english", "hindi", "hinglish", "marathi", "tamil", "telugu", "kannada", "gujarati", "bengali",
    "bangla", "punjabi", "malayalam", "odia", "oriya", "urdu", "assamese", "angrezi", "angreji",
    "हिंदी", "हिन्दी", "अंग्रेज़ी", "अंग्रेजी", "इंग्लिश", "तमिल", "तेलुगु", "मराठी", "कन्नड़", "गुजराती",
    "बंगाली", "बांग्ला", "पंजाबी", "मलयालम", "उड़िया", "ओड़िया", "उर्दू",
    "தமிழ்", "ஆங்கில", "తెలుగు", "ఇంగ్లీష్", "ಕನ್ನಡ", "ಇಂಗ್ಲಿಷ್", "বাংলা", "ইংরেজি", "ગુજરાતી", "અંગ્રેજી",
    "ਪੰਜਾਬੀ", "ਅੰਗਰੇਜ਼ੀ", "മലയാളം", "ഇംഗ്ലീഷ്", "ଓଡ଼ିଆ", "اردو", "انگریزی",
]
REQUEST_WORDS = [
    "reply", "talk", "speak", "answer", "respond", "write", "chat", "switch", "baat", "bolo", "boliye",
    "bolie", "bolen", "bol", "likho", "likhiye", "samjhao",
    "बात", "बोलो", "बोलिए", "बोलिये", "बोलें", "बोला", "लिखो", "लिखिए", "लिखें", "समझाइए",
    "பேசு", "சொல்லு", "మాట్లాడ", "చెప్పండి", "ಮಾತಾಡಿ", "ಮಾತನಾಡಿ", "ಹೇಳಿ", "বলুন", "বলো", "কথা",
    "બોલો", "વાત", "ਬੋਲੋ", "ਗੱਲ", "സംസാരിക്ക", "പറയൂ", "କୁହ", "بات", "بولیں",
]
# A message with these is about the business, even if it also names a language.
BUSINESS_WORDS = {
    "website", "site", "app", "internet", "wifi", "sim", "sims", "cctv", "camera", "cameras", "billing",
    "email", "whatsapp", "shop", "dukaan", "dukan", "clinic", "office", "staff", "log", "people",
}


def clean_language(raw) -> str | None:
    """A plain language name such as "Tamil", or None when the value is not one."""
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    lower = name.lower()
    if ROMAN_HINDI.fullmatch(lower):
        return "Hinglish"
    if lower in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[lower]
    if not LANGUAGE_NAME.fullmatch(name):
        return None
    words = lower.replace("-", " ").split()
    if not words or len(words) > 3 or NOT_A_LANGUAGE.intersection(words):
        return None
    return " ".join(word.capitalize() for word in name.split())


def normalize_language(raw, previous) -> str:
    """The language to use from here on. Anything that is not a plain language name keeps `previous`."""
    return clean_language(raw) or clean_language(previous) or "English"


def has_letters(text: str) -> bool:
    return any(character.isalpha() for character in text)


def has_non_latin_letters(text: str) -> bool:
    return any(
        character.isalpha() and not unicodedata.name(character, "").startswith("LATIN") for character in text
    )


def keeps_previous_language(latest_message: str, cities: list[CityOut]) -> bool:
    """True for "2", "ok", "👍", "Delhi" and similar: they say nothing about the owner's language."""
    if not has_letters(latest_message):
        return True
    words = simplify(latest_message).split()
    if words and all(word in NEUTRAL_WORDS for word in words):
        return True
    return city_we_serve(latest_message, cities) is not None


def only_asks_for_language(latest_message: str) -> bool:
    """True for "Hindi mein baat karo", "reply in English" or "तमिल में बोलिए". Such a message is not an answer."""
    if any(character.isdigit() for character in latest_message):
        return False
    simple = simplify(latest_message)
    words = simple.split()
    if not words or len(words) > 6 or BUSINESS_WORDS.intersection(words):
        return False

    def mentions(options: list[str]) -> bool:
        # Other scripts add endings to words ("தமிழில்"), so they are matched inside words.
        return any(option in words if option.isascii() else option in simple for option in options)

    return mentions(LANGUAGE_WORDS) and mentions(REQUEST_WORDS)


# ---------- Fixed messages ----------

def question(step: str) -> Text:
    return QUESTIONS[step]


def ask(step: str, language: str) -> str:
    return say(language, *QUESTIONS[step])


def is_greeting(latest_message: str) -> bool:
    return bool(GREETING.match(latest_message))


def greeting_reply(latest_message: str, language: str) -> str | None:
    if not is_greeting(latest_message):
        return None
    return say(language, *HELLO)


# ---------- Cities ----------

def simplify(text: str) -> str:
    """Lower case letters only, in any script. Vowel signs stay, as they are part of the word."""
    kept = []
    for character in text.lower():
        category = unicodedata.category(character)
        if character.isalpha() or category.startswith("M"):
            kept.append(character)
        elif category != "Cf":  # Joiners inside Malayalam or Kannada words are dropped, not spaced.
            kept.append(" ")
    return " ".join("".join(kept).split())


STATE_SPELLINGS = [simplify(state) for state in INDIAN_STATES]


def city_we_serve(name: str, cities: list[CityOut]) -> str | None:
    """The city's spelling in our list, if we serve it, including its common old names."""
    wanted = simplify(name)
    for city in cities:
        if simplify(city.city) == wanted:
            return city.city
    return CITY_ALIASES.get(wanted)


def names_an_indian_state(text: str) -> bool:
    simple = simplify(text)
    padded = f" {simple} "
    # Other scripts add endings to names ("தமிழ்நாட்டில்"), so they are matched inside words.
    return any(f" {state} " in padded if state.isascii() else state in simple for state in STATE_SPELLINGS)


def owner_typed(value: str, owner_texts: list[str]) -> bool:
    """The LLM may only record a place the owner actually wrote."""
    wanted = simplify(value)
    return bool(wanted) and any(wanted in simplify(text) for text in owner_texts)


def city_not_served(name: str) -> Text:
    return (
        f"I couldn't match \"{name}\" to a location we currently serve. "
        "If it's another city in India, could you share the state too? For example, \"Patna, Bihar\".",
        f"हमें \"{name}\" उन शहरों में नहीं मिला। "
        "अगर आपका व्यवसाय भारत के किसी और शहर में है, तो राज्य का नाम भी बता दें। "
        "जैसे \"पटना, बिहार\"।",
    )


def number_problem(field: str, value: int) -> Text:
    names = {
        "employee_count": "the number of people working there",
        "num_sites": "the number of branches",
        "budget_monthly_inr": "a monthly budget in rupees",
    }
    return (
        f"\"{value}\" seems a little off for {names.get(field, 'that number')}. Could you check it?",
        f"\"{value}\" संख्या थोड़ी गलत लग रही है—क्या आप इसे जाँच सकते हैं?",
    )


def check_new_answers(turn: AdvisorTurn, owner_texts: list[str], cities: list[CityOut]) -> tuple[AdvisorTurn, list[Text]]:
    """Returns the turn with only believable answers kept, and a message for each answer refused."""
    keep: dict = {}
    problems: list[Text] = []
    latest = owner_texts[-1] if owner_texts else ""

    if turn.city is not None:
        # "Agra, Uttar Pradesh" is checked as "Agra", and its state lets an unlisted city through.
        place = turn.city.split(",")[0].strip()
        known = city_we_serve(turn.city, cities) or city_we_serve(place, cities)
        # The owner typed "Bangalore" and the LLM wrote "Bengaluru": that still counts as typed.
        spellings = [turn.city, place] + [old for old, proper in CITY_ALIASES.items() if proper == known]
        # A city written in another script comes back in English letters, so it cannot be matched by spelling.
        written_in_another_script = has_non_latin_letters(latest)
        if not written_in_another_script and not any(owner_typed(spelling, owner_texts) for spelling in spellings):
            keep["city"] = None  # The owner never wrote this place. The LLM made it up.
        elif known:
            keep["city"] = known
        elif place and (names_an_indian_state(turn.city) or names_an_indian_state(latest)):
            keep["city"] = place.title()
        else:
            keep["city"] = None
            problems.append(city_not_served(turn.city.strip()))

    for field, (smallest, largest) in NUMBER_LIMITS.items():
        value = getattr(turn, field)
        if value is not None and not smallest <= value <= largest:
            keep[field] = None
            if field in ("employee_count", "num_sites", "budget_monthly_inr"):
                problems.append(number_problem(field, value))

    return turn.model_copy(update=keep), problems
