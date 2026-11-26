"""Words that mean money or a price, in the languages owners write in.

Prices only ever come from our pricing code. Text the LLM writes for the owner is checked with these
patterns, so a price it makes up is caught in every language, not only in English and Hindi.
Python's \\d also matches Indic digits such as ५ or ௫, so amounts written with them are caught too.
"""
import re

# A currency sign or the word for rupee (or taka), in any script. One of these is enough.
CURRENCY = (
    r"₹|\bRs\.?\b|\bINR\b|\brupees?\b"
    r"|\b(?:rupaye|rupaiye|rupay|rupaya|rupaiya|rupiya|rupiye|rupye|rupya|ruppe|roobai|rubai|rupai)\b"
    r"|\bpais[ae]\b|\btaka\b"
    r"|रुपये|रुपए|रुपया|रुपयों|रुपयांचा|रु\."
    r"|ரூபாய்|ரூ\."
    r"|రూపాయ|రూ\."
    r"|ರೂಪಾಯಿ|ರೂ\."
    r"|രൂപ(?=[\sയ.,!?]|$)"
    r"|টাকা|টকা"
    r"|રૂપિયા|રૂ\."
    r"|ਰੁਪਏ|ਰੁਪਈਏ|ਰੁਪਿਆ"
    r"|ଟଙ୍କା"
    r"|روپے|روپیہ|روپیے"
)

# An amount: a number with "/-", thousand, lakh or crore, or "a month" after it.
AMOUNT = (
    r"\d\s*/-"
    r"|\d[\d,.]*\s*(?:k\b|lakh|lac\b|crore|cr\b|hazaa?r|hajar"
    r"|हज़ार|हजार|लाख|करोड़|ஆயிரம்|லட்சம்|వేల|లక్ష|ಸಾವಿರ|ಲಕ್ಷ|হাজার|লাখ|હજાર|લાખ|ਹਜ਼ਾਰ|ਲੱਖ|ആയിരം|ലക്ഷം|ହଜାର|ଲକ୍ଷ|ہزار|لاکھ)"
    r"|\d[\d,.]*\s*(?:/\s*(?:month|mo|mahina|maah)\b|(?:a|per|each|every)\s+month\b|per\s+mahina\b|prati\s+maah\b"
    r"|प्रति\s*(?:माह|महीना)|मासिक)"
    r"|\b(?:ek|do|teen|tin|char|chaar|paanch|panch|chhe|chhah|saat|aath|nau|das|bees|pachas|sau)\s+(?:sau|hazaa?r|hajar|lakh|crore)\b"
    r"|(?:एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस|सौ)\s*(?:सौ|हज़ार|हजार|लाख|करोड़)"
)

# Words that ask about or talk about a price, without an amount.
PRICE_WORDS = (
    r"\bk(?:i|ee)m+at\b|\bkitna\s+lag|\bkitne\s+ka\b|\bkitne\s+paise\b|\bdaam\b"
    r"|कीमत|क़ीमत|दाम|किंमत"
    r"|விலை|ధర(?!ి)|ಬೆಲೆ|দাম|કિંમત|ਕੀਮਤ|വില(?=[\sയ.,!?]|$)|ଦାମ|قیمت"
)

# Money itself: a currency word or an amount.
MONEY = re.compile(f"{CURRENCY}|{AMOUNT}", re.IGNORECASE)
PRICE_TALK = re.compile(PRICE_WORDS, re.IGNORECASE)
# Anything that means the LLM is talking about a price, which only our own code may do.
PRICE_MENTION = re.compile(f"{CURRENCY}|{AMOUNT}|{PRICE_WORDS}", re.IGNORECASE)
