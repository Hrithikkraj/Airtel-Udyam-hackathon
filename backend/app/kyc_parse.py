"""Turn lines of OCR text into named fields, such as legal_name or bill_date."""
import re
from difflib import SequenceMatcher

GST_CERTIFICATE = "gst_certificate"
UDYAM_CERTIFICATE = "udyam_certificate"
SIGNATORY_ID = "signatory_id"
ADDRESS_PROOF = "address_proof"

# Words that identify each kind of document, with spaces removed because OCR often loses them.
TITLE_WORDS = {
    GST_CERTIFICATE: "gstregistrationcertificate",
    UDYAM_CERTIFICATE: "udyamregistrationcertificate",
    SIGNATORY_ID: "authorisedsignatoryid",
    ADDRESS_PROOF: "electricitybill",
}

# Printed label on the document -> our field name. An address can span two labels.
LABELS = {
    GST_CERTIFICATE: {
        "gstin": "gstin",
        "legal name": "legal_name",
        "trade name": "trade_name",
        "constitution": "constitution",
        "address of principal": "address",
        "place of business": "address",
        "date of liability": "registration_date",
        "type of registration": "registration_type",
    },
    UDYAM_CERTIFICATE: {
        "udyam reg. number": "udyam_number",
        "enterprise name": "enterprise_name",
        "major activity": "major_activity",
        "city": "city",
        "state": "state",
        "date of registration": "registration_date",
    },
    SIGNATORY_ID: {
        "name": "name",
        "designation": "designation",
        "for business": "business_name",
        "id no.": "id_number",
        "valid till": "valid_till",
    },
    # Real bills use many different labels for the same thing, so each field has several.
    ADDRESS_PROOF: {
        "consumer no.": "consumer_number",
        "consumer number": "consumer_number",
        "billed to": "billed_to",
        "consumer name": "billed_to",
        "customer name": "billed_to",
        "name of consumer": "billed_to",
        "name": "billed_to",
        "supply address": "address",
        "service address": "address",
        "premises address": "address",
        "installation address": "address",
        "billing address": "address",
        "address": "address",
        "bill date": "bill_date",
        "billing date": "bill_date",
        "bill issue date": "bill_date",
        "date of bill": "bill_date",
        "issue date": "bill_date",
        "invoice date": "bill_date",
        "units consumed": "units",
        "amount due (inr)": "amount_due",
    },
}

# A bill is recognised by its words, not one exact title, because every company words it differently.
BILL_WORDS = [
    "electricitybill", "electricity", "consumer", "unitsconsumed", "kwh", "meter", "tariff",
    "amountdue", "amountpayable", "duedate", "billdate", "billingperiod", "waterbill", "gasbill",
]
MIN_BILL_WORDS = 3

# "Name : Ganesh Woodcraft" has its label and value on one line.
LABEL_AND_VALUE = re.compile(r"^\s*([^:]{2,40}?)\s*:\s*(.+)$")

# Fields we must be able to read before any document can be judged.
REQUIRED_FIELDS = {
    GST_CERTIFICATE: ["legal_name", "address", "registration_date"],
    UDYAM_CERTIFICATE: ["enterprise_name", "city", "state", "registration_date"],
    SIGNATORY_ID: ["name", "business_name", "valid_till"],
    ADDRESS_PROOF: ["billed_to", "address", "bill_date"],
}


def squeeze(text: str) -> str:
    """Lowercase letters and digits only, so 'Date of liability' equals 'Dateofliability'."""
    return re.sub(r"[^a-z0-9]", "", text.lower())


def is_similar(first: str, second: str, threshold: float = 0.85) -> bool:
    return SequenceMatcher(None, first, second).ratio() >= threshold


def detect_document_type(lines: list[str]) -> str | None:
    """The title is near the top of the page, so the first few lines are checked first."""
    best_type, best_score = None, 0.8  # A title must be at least this close to count.
    for line in lines[:4]:
        cleaned = re.sub(r"^specimen", "", squeeze(line))
        for document_type, title in TITLE_WORDS.items():
            # GST and Udyam titles look alike, so keep the closest match, not the first.
            score = 1.0 if title in cleaned else SequenceMatcher(None, cleaned, title).ratio()
            if score > best_score:
                best_type, best_score = document_type, score
    if best_type:
        return best_type

    whole_page = squeeze(" ".join(lines))
    if sum(word in whole_page for word in BILL_WORDS) >= MIN_BILL_WORDS:
        return ADDRESS_PROOF
    return None


def extract_fields(lines: list[str], document_type: str) -> dict[str, str]:
    """A value is every line after a label, up to the next label."""
    labels = {squeeze(label): field for label, field in LABELS[document_type].items()}

    def field_for(text: str) -> str | None:
        cleaned = squeeze(text)
        if cleaned in labels:  # An exact match wins, so "Address" is not read as "Billing address".
            return labels[cleaned]
        return next((labels[known] for known in labels if is_similar(cleaned, known)), None)

    fields: dict[str, list[str]] = {}
    current_field = None
    for line in lines:
        cleaned = squeeze(line)
        if "hackath" in cleaned:  # The small print at the foot of each specimen.
            current_field = None
            continue

        same_line = LABEL_AND_VALUE.match(line)
        if same_line:
            label = field_for(same_line.group(1))
            # An unknown "Due Date : ..." line ends the field before it, so it is not mixed in.
            current_field = label
            if label and label not in fields:
                fields[label] = [same_line.group(2).strip()]
            continue

        label = field_for(line)
        if label:
            current_field = label
            fields.setdefault(label, [])
        elif current_field:
            fields[current_field].append(line.strip())
    # Long addresses wrap mid-word, so wrapped lines are joined with no space added.
    return {field: "".join(parts).strip() for field, parts in fields.items() if parts}


def missing_required_fields(fields: dict[str, str], document_type: str) -> list[str]:
    return [field for field in REQUIRED_FIELDS[document_type] if not fields.get(field)]


# ---------- Identifiers ----------

GSTIN_DIGIT_POSITIONS = {0, 1, 7, 8, 9, 10}
GSTIN_LETTER_POSITIONS = {2, 3, 4, 5, 6, 11}
LOOKS_LIKE_DIGIT = {"O": "0", "I": "1", "L": "1", "S": "5", "B": "8", "Z": "2"}
LOOKS_LIKE_LETTER = {"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z"}
GSTIN_PATTERN = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$")
GSTIN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def gstin_check_character(first_14: str) -> str:
    """The official GSTIN checksum: weight digits by 1, 2, 1, 2... in base 36."""
    total = 0
    for position, character in enumerate(first_14):
        product = GSTIN_ALPHABET.index(character) * (1 if position % 2 == 0 else 2)
        total += product // 36 + product % 36
    return GSTIN_ALPHABET[(36 - total % 36) % 36]


def is_valid_gstin(gstin: str) -> bool:
    return bool(GSTIN_PATTERN.match(gstin)) and gstin_check_character(gstin[:14]) == gstin[14]


def clean_gstin(text: str) -> str:
    """Undo common OCR swaps, such as O for 0, using what each position must hold."""
    characters = list(re.sub(r"[^A-Z0-9]", "", text.upper()))
    for position, character in enumerate(characters):
        if position in GSTIN_DIGIT_POSITIONS:
            characters[position] = LOOKS_LIKE_DIGIT.get(character, character)
        elif position in GSTIN_LETTER_POSITIONS:
            characters[position] = LOOKS_LIKE_LETTER.get(character, character)
    gstin = "".join(characters)

    # The last character can be a letter or a digit, so the format cannot settle it.
    # Try the look-alike, and accept it only if the check digit then passes.
    if len(gstin) == 15 and not is_valid_gstin(gstin):
        last = gstin[14]
        alternative = LOOKS_LIKE_DIGIT.get(last) or LOOKS_LIKE_LETTER.get(last)
        if alternative and is_valid_gstin(gstin[:14] + alternative):
            return gstin[:14] + alternative
    return gstin


def clean_udyam(text: str) -> str:
    """Udyam numbers end in digits only, so letters that look like digits can be corrected."""
    number = re.sub(r"\s", "", text.upper())
    head, separator, tail = number.rpartition("-")
    fixed_tail = "".join(LOOKS_LIKE_DIGIT.get(character, character) for character in tail)
    return head + separator + fixed_tail


def mask_identifier(identifier: str | None) -> str | None:
    """Show only the last 4 characters, in the API and on screen."""
    if not identifier:
        return None
    return "•" * max(len(identifier) - 4, 0) + identifier[-4:]
