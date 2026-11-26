"""Product details: why we chose each product, and what the owner should know about it.

Pure code, no LLM. Every sentence is built from facts we hold: the catalogue (through ProductOut),
the owner's profile, the recommender's own rules, and what similar businesses bought (product_stats).
Every amount comes from pricing.calculate_quote. "Saves ₹X" and "₹X more" are always the difference
between two real quotes, never a second way of working out a price.
No text the owner typed is ever put into these sentences.

Sentences are written in English and Hindi, chosen by profile.preferred_language, in the same way
as explain.py. Any other language gets English.
"""
import re

# Imported as a module, because recommend.py also imports this one. Names are looked up when a
# function runs, so the two files can load in either order.
from . import recommend as rec
from .explain import CURRENT_SETUP_WORDS, rupees
from .pricing import calculate_quote
from .product_stats import PeerStats, peer_stat
from .rules import Catalogue, ineligibility_reasons, missing_dependency
from .schemas import BundleItem, BusinessProfile, DetailPrice, OtherOption, ProductDetail, QuoteOut, Upgrade

MAX_WHY = 4
MAX_OTHER_OPTIONS = 2

# The next step up inside one family of products.
FAMILIES = [["P01", "P02", "P03"], ["P07", "P08"], ["P05", "P06"]]
UPGRADE_NOTES = {
    "P02": ("Need more speed later?", "आगे चलकर ज़्यादा स्पीड चाहिए?"),
    "P03": ("Need more speed later?", "आगे चलकर ज़्यादा स्पीड चाहिए?"),
    "P08": ("Need more data or roaming later?", "आगे चलकर ज़्यादा डेटा या रोमिंग चाहिए?"),
    "P06": ("Need more bandwidth later?", "आगे चलकर ज़्यादा बैंडविड्थ चाहिए?"),
}

# The same words the quote and rate list use for each segment.
SEGMENT_WORDS = {
    "micro": ("shops and small service businesses", "दुकानों और छोटे सेवा व्यवसायों"),
    "prof": ("offices such as clinics, CA firms and coaching centres", "क्लिनिक, CA फ़र्म और कोचिंग सेंटर जैसे दफ़्तरों"),
    "multi": ("businesses with 3 or more branches", "3 या ज़्यादा शाखाओं वाले व्यवसायों"),
    "mfg": ("factories and workshops", "फ़ैक्ट्रियों और वर्कशॉप"),
}

# What the owner asked for, in their words rather than ours.
ASKED_WORDS = {
    "P07": ("business SIMs", "बिज़नेस सिम"),
    "P08": ("business SIMs with more data and roaming", "ज़्यादा डेटा और रोमिंग वाले बिज़नेस सिम"),
    "P09": ("a backup connection", "बैकअप कनेक्शन"),
    "P10": ("one network across your branches", "सभी शाखाओं के लिए एक नेटवर्क"),
    "P11": ("a fixed IP", "फ़िक्स्ड IP"),
    "P12": ("office phone lines", "ऑफ़िस फ़ोन लाइनें"),
    "P13": ("a toll-free number", "टोल-फ़्री नंबर"),
    "P14": ("SMS alerts", "SMS अलर्ट"),
    "P15": ("WhatsApp for your business", "बिज़नेस के लिए WhatsApp"),
    "P16": ("business email", "बिज़नेस ईमेल"),
    "P17": ("automatic backup", "ऑटोमैटिक बैकअप"),
    "P18": ("a website", "वेबसाइट"),
    "P19": ("billing and payments", "बिलिंग और पेमेंट"),
    "P20": ("antivirus", "एंटीवायरस"),
    "P21": ("a firewall", "फ़ायरवॉल"),
    "P22": ("Wi-Fi for customers", "ग्राहकों के लिए Wi-Fi"),
    "P23": ("CCTV", "CCTV"),
    "P24": ("machine monitoring", "मशीन मॉनिटरिंग"),
    "P25": ("vehicle tracking", "गाड़ियों की ट्रैकिंग"),
}
CONNECTION_ASKED_WORDS = {
    "dedicated_internet": ("guaranteed bandwidth", "पक्की (डेडिकेटेड) बैंडविड्थ"),
    "high_speed_internet": ("very fast internet", "बहुत तेज़ इंटरनेट"),
    "internet": ("internet", "इंटरनेट"),
}
CURRENT_SETUP_WORDS_HINDI = {
    "mobile_hotspot": "आपके मोबाइल हॉटस्पॉट",
    "home_broadband": "आपके होम ब्रॉडबैंड",
    "business_broadband": "आपके मौजूदा बिज़नेस ब्रॉडबैंड",
    "leased_line": "आपकी मौजूदा लीज़्ड लाइन",
    "mixed": "आपकी अलग-अलग जगहों के अलग-अलग प्रोवाइडर",
}

# catalogue unit -> (one, many, Hindi one, Hindi many, Hindi "per ...")
UNIT_WORDS = {
    "per site": ("site", "sites", "जगह", "जगहें", "हर जगह"),
    "per line": ("line", "lines", "लाइन", "लाइनें", "हर लाइन"),
    "per IP": ("IP", "IPs", "IP", "IP", "हर IP"),
    "per channel": ("channel", "channels", "चैनल", "चैनल", "हर चैनल"),
    "per number": ("number", "numbers", "नंबर", "नंबर", "हर नंबर"),
    "per pack": ("pack", "packs", "पैक", "पैक", "हर पैक"),
    "per account": ("account", "accounts", "अकाउंट", "अकाउंट", "हर अकाउंट"),
    "per user": ("user", "users", "यूज़र", "यूज़र", "हर यूज़र"),
    "per counter": ("counter", "counters", "काउंटर", "काउंटर", "हर काउंटर"),
    "per device": ("device", "devices", "डिवाइस", "डिवाइस", "हर डिवाइस"),
    "per camera": ("camera", "cameras", "कैमरा", "कैमरे", "हर कैमरे"),
    "per vehicle": ("vehicle", "vehicles", "गाड़ी", "गाड़ियाँ", "हर गाड़ी"),
}

# rules.py writes why a product cannot be sold, in English. These are the same sentences in Hindi.
# A sentence that does not match is shown in English, so rules.py stays the only place for the rules.
HINDI_RULE_REASONS = [
    (re.compile(r"is not sold in tier (\d+) cities"), "यह टियर {0} शहरों में नहीं मिलता"),
    (re.compile(r"needs at least (\d+) employees"), "इसके लिए कम से कम {0} कर्मचारी चाहिए"),
    (re.compile(r"needs at least (\d+) sites"), "इसके लिए कम से कम {0} जगहें चाहिए"),
    (re.compile(r"needs an active GSTIN"), "इसके लिए सक्रिय GSTIN चाहिए"),
    (re.compile(r"needs fibre at your site"), "इसके लिए आपकी जगह पर फ़ाइबर चाहिए"),
]
SPEED = re.compile(r"\d+\s*(?:Mbps|Gbps)")


class Words:
    """Picks the English or Hindi sentence. Any language other than Hindi gets English."""

    def __init__(self, language: str):
        self.hindi = language == "Hindi"

    def __call__(self, english: str, hindi: str) -> str:
        return hindi if self.hindi else english

    def join(self, names: list[str]) -> str:
        if len(names) <= 1:
            return "".join(names)
        last = " और " if self.hindi else " and "
        return ", ".join(names[:-1]) + last + names[-1]


# ---------- Small helpers ----------

def connection_ids() -> list[str]:
    return rec.STANDARD_CONNECTIONS + rec.LEASED_LINES


def unit_words(unit: str) -> tuple[str, str, str, str, str]:
    if unit in UNIT_WORDS:
        return UNIT_WORDS[unit]
    noun = unit.removeprefix("per ").strip() or "unit"
    return noun, f"{noun}s", noun, noun, unit


def count(quantity: int, unit: str, w: Words) -> str:
    one, many, hindi_one, hindi_many, _ = unit_words(unit)
    return w(f"{quantity} {one if quantity == 1 else many}", f"{quantity} {hindi_one if quantity == 1 else hindi_many}")


def swapped(items: list[BundleItem], old_id: str, new_id: str) -> list[BundleItem]:
    return [
        BundleItem(product_id=new_id if item.product_id == old_id else item.product_id, quantity=item.quantity)
        for item in items
    ]


def broken_products(items: list[BundleItem], catalogue: Catalogue) -> list[str]:
    """Names of products in these items that would be missing the connection they need."""
    ids = {item.product_id for item in items}
    return [
        catalogue[item.product_id].name
        for item in items
        if missing_dependency(catalogue[item.product_id], ids, catalogue)
    ]


def blocked_clause(product, reason: str, w: Words) -> str:
    """ "it is not sold in tier 2 cities", from the rules.py sentence about this product."""
    prefix = f"{product.name} "
    rest = reason[len(prefix):] if reason.startswith(prefix) else None
    if w.hindi and rest:
        for pattern, hindi in HINDI_RULE_REASONS:
            match = pattern.fullmatch(rest)
            if match:
                return hindi.format(*match.groups())
    return f"it {rest}" if rest else reason


def peer_sentence(peer_stats: PeerStats | None, segment: str, product_id: str, w: Words) -> str | None:
    stat = peer_stat(peer_stats, segment, product_id)
    if stat is None:
        return None
    return w(
        f"{stat.pct}% of the {stat.n} similar businesses we onboarded also chose this.",
        f"हमारे जोड़े गए {stat.n} मिलते-जुलते व्यवसायों में से {stat.pct}% ने भी इसे चुना।",
    )


def price_of(product_id: str, quote: QuoteOut, catalogue: Catalogue) -> DetailPrice:
    """The product's line exactly as the quote has it, plus its catalogue range."""
    line = next(line for line in quote.lines if line.product_id == product_id)
    product = catalogue[product_id]
    total = quote.monthly_total_inr
    share = round(line.monthly_inr * 100 / total) if total > 0 else 0
    return DetailPrice(
        unit_price_inr=line.unit_price_inr,
        quantity=line.quantity,
        monthly_inr=line.monthly_inr,
        setup_inr=line.setup_inr,
        range_min_inr=product.price_min_inr,
        range_max_inr=product.price_max_inr,
        share_of_bill_pct=max(0, min(100, share)),
    )


# ---------- Why ----------

def asked_sentence(product_id: str, profile: BusinessProfile, w: Words, assumed_internet: bool) -> str | None:
    words = ASKED_WORDS.get(product_id)
    need = _need_for(product_id)
    if words and need and need in profile.needs:
        return w(f"You asked for {words[0]}.", f"आपने {words[1]} के लिए कहा था।")
    if product_id not in connection_ids():
        return None
    if assumed_internet:
        return w(
            "You did not name a need, and most of our services need a connection, so we started with one.",
            "आपने कोई ज़रूरत नहीं बताई, और हमारी ज़्यादातर सेवाओं के लिए कनेक्शन चाहिए, इसलिए हमने इससे शुरुआत की।",
        )
    covers = {
        "dedicated_internet": product_id in rec.LEASED_LINES,
        "high_speed_internet": product_id in ["P02", "P03", *rec.LEASED_LINES],
        "internet": True,
    }
    for need, (english, hindi) in CONNECTION_ASKED_WORDS.items():
        if need in profile.needs and covers[need]:
            return w(f"You asked for {english}.", f"आपने {hindi} के लिए कहा था।")
    return None


def _need_for(product_id: str) -> str | None:
    return next((need for need, pid in rec.PRODUCT_FOR_NEED.items() if pid == product_id), None)


def connection_sentences(product_id, profile, segment, catalogue, w: Words, is_alternative: bool) -> list[str]:
    """Why this connection, from the same rules the recommender scores with (best_connections_for)."""
    best = rec.best_connections_for(profile, segment)
    segment_english, segment_hindi = SEGMENT_WORDS[segment]
    if "high_speed_internet" in profile.needs and "dedicated_internet" not in profile.needs:
        goal_english, goal_hindi = CONNECTION_ASKED_WORDS["high_speed_internet"]
    else:
        goal_english, goal_hindi = segment_english, segment_hindi

    sentences = []
    if "dedicated_internet" in profile.needs and product_id in rec.LEASED_LINES:
        sentences.append(w(
            "Only a leased line gives guaranteed bandwidth: dedicated 1:1 internet that is not shared.",
            "पक्की बैंडविड्थ सिर्फ़ लीज़्ड लाइन से मिलती है: यह 1:1 डेडिकेटेड इंटरनेट है, किसी के साथ बँटा नहीं।",
        ))
    elif product_id == "P04" and not profile.fibre_available:
        sentences.append(w(
            "Fibre is not available at your site, so we chose 5G AirFiber, which is made for sites without fibre.",
            "आपकी जगह पर फ़ाइबर नहीं है, इसलिए हमने 5G AirFiber चुना, जो बिना फ़ाइबर वाली जगहों के लिए बना है।",
        ))
    elif segment == "mfg" and product_id in rec.LEASED_LINES and product_id == best[0]:
        sentences.append(w(
            "For factories and workshops we start with a leased line: dedicated 1:1 internet that is not shared.",
            "फ़ैक्ट्रियों और वर्कशॉप के लिए हम लीज़्ड लाइन से शुरू करते हैं: 1:1 डेडिकेटेड इंटरनेट, जो किसी के साथ बँटा नहीं।",
        ))
    elif product_id == best[0]:
        sentences.append(w(f"It is our first choice for {goal_english}.", f"{goal_hindi} के लिए यह हमारी पहली पसंद है।"))
    elif len(best) > 1 and product_id == best[1]:
        sentences.append(w(f"It is our next choice for {goal_english}.", f"{goal_hindi} के लिए यह हमारी दूसरी पसंद है।"))
    elif not is_alternative:
        # True by construction: the recommender ranked this bundle above every other one it could build.
        sentences.append(w(
            "Among the connections you can get, it fits your needs and budget best.",
            "आपको मिल सकने वाले कनेक्शनों में से यह आपकी ज़रूरतों और बजट में सबसे सही बैठता है।",
        ))

    # Say why the first choice is not used, when a rule blocks it.
    if len(best) > 1 and product_id == best[1] and best[0] in catalogue:
        first = catalogue[best[0]]
        reasons = ineligibility_reasons(first, profile)
        if reasons:
            clause = blocked_clause(first, reasons[0], w)
            sentences.append(w(
                f"{first.name} would be our first choice, but {clause}.",
                f"हमारी पहली पसंद {first.name} होती, लेकिन {clause}।",
            ))
    return sentences


def needed_for_sentence(product_id: str, items: list[BundleItem], catalogue: Catalogue, w: Words) -> str | None:
    """From the catalogue's requires_one_of: which products in the bundle need this one."""
    dependents = [
        catalogue[item.product_id].name
        for item in items
        if product_id in catalogue[item.product_id].requires_one_of
    ]
    if not dependents:
        return None
    names = w.join(dependents)
    if len(dependents) == 1:
        return w(
            f"Needed for {names}, which only works with a connection like this.",
            f"{names} के लिए ज़रूरी, क्योंकि यह ऐसे कनेक्शन के बिना नहीं चलता।",
        )
    return w(
        f"Needed for {names}, which only work with a connection like this.",
        f"{names} के लिए ज़रूरी, क्योंकि ये ऐसे कनेक्शन के बिना नहीं चलते।",
    )


def quantity_sentence(item: BundleItem, profile: BusinessProfile, unit: str, w: Words) -> str | None:
    """Explains the quantity with the same rule that chose it (recommend.quantity_rule)."""
    default, rule = rec.quantity_rule(item.product_id, profile)
    quantity = item.quantity
    amount = count(quantity, unit, w)
    sites = profile.num_sites
    if quantity != default:
        return w(f"You chose {amount}.", f"आपने संख्या {quantity} चुनी।")
    if rule == "exact":
        return w(f"{amount}, as you told us.", f"{amount}, जैसा आपने बताया।")
    if rule == "per_site":
        if sites <= 1:
            return None
        return w(f"1 for each of your {sites} sites.", f"आपकी {sites} जगहों में से हर एक के लिए 1।")
    if rule == "two_per_site":
        if sites > 1:
            return w(
                f"2 for each of your {sites} sites, so {amount}.",
                f"आपकी {sites} जगहों में से हर एक के लिए 2, यानी कुल {amount}।",
            )
        return w(f"We start with {amount} for your site. You can change this.", f"शुरुआत में आपकी जगह के लिए {amount}। आप इसे बदल सकते हैं।")
    if rule == "most_staff":
        staff = profile.employee_count
        if quantity >= staff:
            return w(f"{amount}, one for each person who works there.", f"{amount}, काम करने वाले हर व्यक्ति के लिए एक।")
        share = round(rec.MOST_STAFF_SHARE * 100)
        return w(f"{amount}, for about {share}% of your {staff} staff.", f"{amount}, आपके {staff} लोगों में से लगभग {share}% के लिए।")
    return None


def cut_for_budget(profile: BusinessProfile, items: list[BundleItem], catalogue: Catalogue) -> list[str]:
    """Products the owner asked for that could have been in this bundle but were left out for the budget."""
    ids = {item.product_id for item in items}
    cut = []
    for product_id in rec.wanted_product_ids(profile):
        product = catalogue[product_id]
        if product_id in ids or ineligibility_reasons(product, profile) or missing_dependency(product, ids, catalogue):
            continue
        cut.append(product.name)
    return cut


def budget_sentence(profile, items, quote: QuoteOut, catalogue, w: Words, is_alternative: bool) -> str | None:
    budget = profile.budget_monthly_inr
    if not budget:
        return None
    total = quote.monthly_total_inr
    cut = cut_for_budget(profile, items, catalogue)
    if total > budget:
        over = rupees(total - budget)
        if is_alternative:
            sentence = w(f"This bundle is {over} over your {rupees(budget)} budget.", f"यह बंडल आपके {rupees(budget)} के बजट से {over} ज़्यादा है।")
        else:
            # The recommender shows the cheapest bundle when none fits, so "lowest" is true here.
            sentence = w(
                f"This is the lowest price we have for what you need, {over} over your {rupees(budget)} budget.",
                f"आपकी ज़रूरत के लिए यह हमारी सबसे कम कीमत है, जो आपके {rupees(budget)} के बजट से {over} ज़्यादा है।",
            )
        if cut:
            sentence += " " + w(
                f"To keep the price down, we left out {w.join(cut)}.",
                f"कीमत कम रखने के लिए हमने {w.join(cut)} को अलग रखा।",
            )
        return sentence
    sentence = w(
        f"The whole bundle is {rupees(total)} a month, within your {rupees(budget)} budget.",
        f"पूरा बंडल {rupees(total)} प्रति माह है, आपके {rupees(budget)} के बजट के अंदर।",
    )
    if cut:
        sentence += " " + w(
            f"To fit your budget, we left out {w.join(cut)}. You can add them back below.",
            f"बजट में रहने के लिए हमने {w.join(cut)} को अलग रखा। आप इन्हें नीचे फिर से जोड़ सकते हैं।",
        )
    return sentence


def replaces_sentence(profile: BusinessProfile, w: Words) -> str | None:
    """The same promise explain.py makes, and only where it makes it."""
    if profile.current_internet not in CURRENT_SETUP_WORDS:
        return None
    return w(
        f"It replaces {CURRENT_SETUP_WORDS[profile.current_internet]}, and everything comes on one bill.",
        f"यह {CURRENT_SETUP_WORDS_HINDI[profile.current_internet]} की जगह लेगा, और सब कुछ एक ही बिल में आएगा।",
    )


# ---------- Good to know ----------

def good_to_know(product, line_setup_inr: int, quantity: int, catalogue: Catalogue, w: Words) -> list[str]:
    one, _, hindi_one, _, hindi_each = unit_words(product.unit)
    facts = []
    if product.price_min_inr != product.price_max_inr:
        facts.append(w(
            "We show the middle of the price range. The quote confirms the exact price.",
            "हम कीमत की रेंज का बीच का दाम दिखाते हैं। सटीक कीमत कोटेशन में पक्की होती है।",
        ))
    facts.append(w(f"Priced {product.unit}.", f"कीमत {hindi_each} के हिसाब से है।"))
    if product.setup_fee_inr == 0:
        facts.append(w("No setup fee.", "कोई सेटअप शुल्क नहीं।"))
    elif quantity > 1:
        facts.append(w(
            f"{rupees(product.setup_fee_inr)} one-time setup for each {one}, so {rupees(line_setup_inr)} for {count(quantity, product.unit, w)}.",
            f"हर {hindi_one} का एक बार का सेटअप शुल्क {rupees(product.setup_fee_inr)}, यानी {count(quantity, product.unit, w)} के लिए {rupees(line_setup_inr)}।",
        ))
    else:
        facts.append(w(f"{rupees(line_setup_inr)} one-time setup.", f"एक बार का सेटअप शुल्क {rupees(line_setup_inr)}।"))
    facts.append(w(f"{product.min_contract_months}-month minimum contract.", f"कम से कम {product.min_contract_months} महीने का अनुबंध।"))
    days = product.install_days
    facts.append(w(f"Ready in about {days} {'day' if days == 1 else 'days'}.", f"लगभग {days} दिन में तैयार।"))
    if product.requires_gstin:
        facts.append(w("Needs an active GSTIN.", "सक्रिय GSTIN ज़रूरी है।"))
    if 2 not in product.city_tiers:
        facts.append(w("Only sold in tier 1 cities.", "सिर्फ़ टियर 1 शहरों में मिलता है।"))
    if product.min_employees > 1:
        facts.append(w(
            f"For businesses with at least {product.min_employees} employees.",
            f"कम से कम {product.min_employees} कर्मचारियों वाले व्यवसायों के लिए।",
        ))
    if product.min_sites > 1:
        facts.append(w(
            f"For businesses with at least {product.min_sites} sites.",
            f"कम से कम {product.min_sites} जगहों वाले व्यवसायों के लिए।",
        ))
    if product.requires_one_of:
        names = ", ".join(catalogue[pid].name for pid in product.requires_one_of if pid in catalogue)
        facts.append(w(
            f"Works only with one of these connections: {names}.",
            f"यह इनमें से किसी एक कनेक्शन के साथ ही चलता है: {names}।",
        ))
    if product.product_id in rec.LEASED_LINES:
        facts.append(w("A leased line needs a site survey before it is installed.", "लीज़्ड लाइन लगाने से पहले साइट सर्वे ज़रूरी है।"))
    return facts


# ---------- Other options, upgrade, removing ----------

def why_not_others(product_id, profile, segment, items, quote: QuoteOut, catalogue, w: Words) -> list[OtherOption]:
    """For the connection: how each other standard connection differs, with real quote differences."""
    ids = {item.product_id for item in items}
    best = rec.best_connections_for(profile, segment)
    segment_english, segment_hindi = SEGMENT_WORDS[segment]
    others = [pid for pid in rec.STANDARD_CONNECTIONS if pid != product_id and pid not in ids and pid in catalogue]
    # The connections our rules rate for this owner first, then the rest in catalogue order.
    others.sort(key=lambda pid: (pid not in best, best.index(pid) if pid in best else 0))
    budget = profile.budget_monthly_inr

    options = []
    for other_id in others[:MAX_OTHER_OPTIONS]:
        other = catalogue[other_id]
        reasons = ineligibility_reasons(other, profile)
        if reasons:
            clause = blocked_clause(other, reasons[0], w)
            difference = w(f"Not available for you: {clause}.", f"आपके लिए उपलब्ध नहीं: {clause}।")
        else:
            new_items = swapped(items, product_id, other_id)
            new_total = calculate_quote(new_items, catalogue).monthly_total_inr
            change = new_total - quote.monthly_total_inr
            speed_match = SPEED.search(other.description)
            speed = speed_match.group(0) if speed_match else ""
            if change > 0:
                money = w(f"{rupees(change)} more a month", f"हर महीने {rupees(change)} ज़्यादा")
            elif change < 0:
                money = w(f"{rupees(-change)} less a month", f"हर महीने {rupees(-change)} कम")
            else:
                money = w("The same price", "उतनी ही कीमत")
            parts = [money + (w(f", for {speed}.", f", {speed} के साथ।") if speed else w(".", "।"))]
            if other_id == "P04" and profile.fibre_available:
                parts.append(w("It is wireless 5G, made for sites without fibre.", "यह वायरलेस 5G है, उन जगहों के लिए जहाँ फ़ाइबर नहीं है।"))
            if other_id not in best:
                parts.append(w(f"It is not our first choice for {segment_english}.", f"यह {segment_hindi} के लिए हमारी पहली पसंद नहीं है।"))
            broken = broken_products(new_items, catalogue)
            if broken:
                names = w.join(broken)
                parts.append(w(f"{names} would not work with it.", f"{names} इसके साथ नहीं चलेंगे।"))
            if budget and new_total > budget >= quote.monthly_total_inr:
                parts.append(w(f"It would take you over your {rupees(budget)} budget.", f"इससे आप अपने {rupees(budget)} के बजट से ऊपर चले जाएँगे।"))
            difference = " ".join(parts)
        options.append(OtherOption(product_id=other_id, name=other.name, difference=difference))
    return options


def upgrade_for(product_id, profile, items, quote: QuoteOut, catalogue, w: Words) -> Upgrade | None:
    """The next step up in the same family, only if this owner may buy it and nothing breaks."""
    ids = {item.product_id for item in items}
    for family in FAMILIES:
        if product_id not in family:
            continue
        position = family.index(product_id)
        if position == len(family) - 1:
            return None  # Already the top of the family.
        next_id = family[position + 1]
        if next_id in ids or next_id not in catalogue or ineligibility_reasons(catalogue[next_id], profile):
            return None
        new_items = swapped(items, product_id, next_id)
        if broken_products(new_items, catalogue):
            return None
        extra = calculate_quote(new_items, catalogue).monthly_total_inr - quote.monthly_total_inr
        if extra <= 0:
            return None
        name = catalogue[next_id].name
        question_english, question_hindi = UPGRADE_NOTES[next_id]
        note = w(
            f"{question_english} {name} is {rupees(extra)} a month more.",
            f"{question_hindi} {name} हर महीने {rupees(extra)} ज़्यादा में मिलेगा।",
        )
        return Upgrade(product_id=next_id, name=name, extra_monthly_inr=extra, note=note)
    return None


def if_removed(product_id, items, quote: QuoteOut, catalogue, w: Words) -> str:
    """What removing it saves, as the difference between two real quotes, and what else must go."""
    if len(items) == 1:
        return w("This is the only service in your bundle.", "यह आपके बंडल की अकेली सेवा है।")
    remaining = [item for item in items if item.product_id != product_id]
    dependents = []
    while True:  # Removing a connection can leave several products without the one they need.
        ids = {item.product_id for item in remaining}
        broken = [item for item in remaining if missing_dependency(catalogue[item.product_id], ids, catalogue)]
        if not broken:
            break
        dependents += [catalogue[item.product_id].name for item in broken]
        remaining = [item for item in remaining if item not in broken]
    saves = rupees(quote.monthly_total_inr - calculate_quote(remaining, catalogue).monthly_total_inr)
    if not dependents:
        return w(f"Removing this saves {saves} a month.", f"इसे हटाने पर हर महीने {saves} बचेंगे।")
    names = w.join(dependents)
    if len(dependents) == 1:
        english = f"{names} needs it, so you would have to remove that too. Together that saves {saves} a month."
    else:
        english = f"{names} need it, so you would have to remove them too. Together that saves {saves} a month."
    return w(english, f"{names} इसके बिना नहीं चलते, इसलिए उन्हें भी हटाना होगा। कुल मिलाकर हर महीने {saves} बचेंगे।")


# ---------- The two entry points ----------

def build_details(
    product_id: str,
    profile: BusinessProfile,
    segment: str,
    items: list[BundleItem],
    catalogue: Catalogue,
    peer_stats: PeerStats | None,
    language: str,
    *,
    chosen_by: str = "advisor",
    is_alternative: bool = False,
    assumed_internet: bool = False,
) -> ProductDetail:
    """The details for one product that is in the bundle `items`."""
    w = Words(language)
    product = catalogue[product_id]
    item = next(item for item in items if item.product_id == product_id)
    quote = calculate_quote(items, catalogue)
    price = price_of(product_id, quote, catalogue)
    is_connection = product_id in connection_ids()
    by_owner = chosen_by == "owner"
    # The budget is explained once, on the connection, or on the first product if there is none.
    budget_carrier = next((i.product_id for i in items if i.product_id in connection_ids()), items[0].product_id)

    why: list[str | None] = []
    if by_owner:
        why.append(w("You chose this from the rate list.", "आपने इसे रेट लिस्ट से चुना।"))
    else:
        why.append(asked_sentence(product_id, profile, w, assumed_internet))
        if is_connection:
            why += connection_sentences(product_id, profile, segment, catalogue, w, is_alternative)
    why.append(needed_for_sentence(product_id, items, catalogue, w))
    why.append(quantity_sentence(item, profile, product.unit, w))
    if not by_owner:
        if product_id == budget_carrier:
            why.append(budget_sentence(profile, items, quote, catalogue, w, is_alternative))
        if is_connection and not is_alternative:
            why.append(replaces_sentence(profile, w))
        if is_connection:
            why.append(peer_sentence(peer_stats, segment, product_id, w))
    reasons = [sentence for sentence in why if sentence]
    if not reasons and segment in product.target_segments:
        english, hindi = SEGMENT_WORDS[segment]
        reasons.append(w(f"Made for {english}.", f"{hindi} के लिए बनी सेवा।"))

    return ProductDetail(
        product_id=product_id,
        what_you_get=product.description,
        why=reasons[:MAX_WHY],
        good_to_know=good_to_know(product, price.setup_inr, item.quantity, catalogue, w),
        price=price,
        why_not_others=why_not_others(product_id, profile, segment, items, quote, catalogue, w) if is_connection else [],
        upgrade=upgrade_for(product_id, profile, items, quote, catalogue, w),
        if_removed=if_removed(product_id, items, quote, catalogue, w),
    )


def build_addon_detail(
    item: BundleItem,
    profile: BusinessProfile,
    segment: str,
    bundle_items: list[BundleItem],
    catalogue: Catalogue,
    peer_stats: PeerStats | None,
    language: str,
    *,
    was_cut: bool = False,
) -> ProductDetail:
    """The details for an add-on the owner has not switched on yet: what it adds, and the budget effect."""
    w = Words(language)
    product = catalogue[item.product_id]
    base = [bundle_item for bundle_item in bundle_items if bundle_item.product_id != item.product_id]
    before = calculate_quote(base, catalogue)
    after = calculate_quote([*base, item], catalogue)
    added_monthly = after.monthly_total_inr - before.monthly_total_inr
    added_setup = after.setup_total_inr - before.setup_total_inr
    budget = profile.budget_monthly_inr
    asked_english, asked_hindi = ASKED_WORDS.get(item.product_id, (product.name, product.name))
    segment_english, segment_hindi = SEGMENT_WORDS[segment]

    why: list[str | None] = []
    if was_cut and budget:
        why.append(w(
            f"You asked for {asked_english}, but we left it out to stay within your {rupees(budget)} budget.",
            f"आपने {asked_hindi} के लिए कहा था, पर {rupees(budget)} के बजट में रहने के लिए हमने इसे अलग रखा।",
        ))
    elif was_cut:
        why.append(w(f"You asked for {asked_english}.", f"आपने {asked_hindi} के लिए कहा था।"))
    else:
        why.append(w(f"Popular with {segment_english}.", f"{segment_hindi} में लोकप्रिय।"))
        why.append(peer_sentence(peer_stats, segment, item.product_id, w))
    if added_setup > 0:
        why.append(w(
            f"Adds {rupees(added_monthly)} a month and {rupees(added_setup)} one time.",
            f"इससे हर महीने {rupees(added_monthly)} और एक बार {rupees(added_setup)} जुड़ेंगे।",
        ))
    else:
        why.append(w(
            f"Adds {rupees(added_monthly)} a month, with no setup fee.",
            f"इससे हर महीने {rupees(added_monthly)} जुड़ेंगे, कोई सेटअप शुल्क नहीं।",
        ))
    if budget:
        if after.monthly_total_inr > budget:
            over = rupees(after.monthly_total_inr - budget)
            why.append(w(
                f"With it, the bundle would be {over} over your {rupees(budget)} budget.",
                f"इसके साथ बंडल आपके {rupees(budget)} के बजट से {over} ज़्यादा हो जाएगा।",
            ))
        else:
            why.append(w(
                f"You would still be within your {rupees(budget)} budget, at {rupees(after.monthly_total_inr)} a month.",
                f"तब भी आप {rupees(budget)} के बजट में रहेंगे, कुल {rupees(after.monthly_total_inr)} प्रति माह।",
            ))
    why.append(quantity_sentence(item, profile, product.unit, w))

    price = price_of(item.product_id, after, catalogue)
    return ProductDetail(
        product_id=item.product_id,
        what_you_get=product.description,
        why=[sentence for sentence in why if sentence][:MAX_WHY],
        good_to_know=good_to_know(product, price.setup_inr, item.quantity, catalogue, w),
        price=price,
    )
