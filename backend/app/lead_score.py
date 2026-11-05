"""A simple score for which past leads are worth a call.

It uses a logistic regression, because each input's effect can be read and explained.
Only facts known when a lead arrives go in, never anything from later in the funnel.
City name, language and contact details are left out on purpose.
The score only orders a call list. It never blocks anyone from buying.
"""
from functools import lru_cache

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder

CATEGORY_INPUTS = ["lead_source", "segment"]
NUMBER_INPUTS = ["is_tier_1", "has_gstin_flag", "has_udyam_flag"]
PLAIN_NUMBER_INPUTS = {
    "is_tier_1": "In a tier 1 city",
    "has_gstin_flag": "Has a GSTIN",
    "has_udyam_flag": "Has Udyam registration",
}
HOW_MANY_REASONS = 2


def model_inputs(leads: pd.DataFrame) -> pd.DataFrame:
    inputs = leads[CATEGORY_INPUTS].copy()
    inputs["is_tier_1"] = (leads["city_tier"] == 1).astype(int)
    inputs["has_gstin_flag"] = (leads["has_gstin"] == "Y").astype(int)
    inputs["has_udyam_flag"] = (leads["has_udyam"] == "Y").astype(int)
    return inputs


def new_model():
    encoder = ColumnTransformer(
        [("category", OneHotEncoder(handle_unknown="ignore"), CATEGORY_INPUTS)],
        remainder="passthrough",  # The yes/no inputs are already 0 or 1.
    )
    return make_pipeline(encoder, LogisticRegression(max_iter=1000))


def plain_input_names(model) -> list[str]:
    """The model's input names, in order, in words staff can read."""
    names = []
    for name in model[0].get_feature_names_out():
        field = name.split("__", 1)[1]
        if field.startswith("lead_source_"):
            names.append(f"Came from {field.removeprefix('lead_source_').lower()}")
        elif field.startswith("segment_"):
            names.append(field.removeprefix("segment_"))
        else:
            names.append(PLAIN_NUMBER_INPUTS[field])
    return names


def reasons_for(row, weights, names) -> str:
    """The inputs pushing this lead's score up the most."""
    pushes = sorted(zip(row * weights, names), reverse=True)
    return "; ".join(name for push, name in pushes[:HOW_MANY_REASONS] if push > 0)


def add_scores(leads: pd.DataFrame) -> pd.DataFrame:
    """Return the leads with propensity_pct (chance of activating) and score_reasons added."""
    inputs = model_inputs(leads)
    model = new_model().fit(inputs, leads["outcome"] == "Activated")

    encoded = model[0].transform(inputs)
    encoded = encoded.toarray() if hasattr(encoded, "toarray") else encoded
    weights = model[1].coef_[0]
    names = plain_input_names(model)

    scored = leads.copy()
    scored["propensity_pct"] = (model.predict_proba(inputs)[:, 1] * 100).round(1)
    scored["score_reasons"] = [reasons_for(row, weights, names) for row in encoded]
    return scored


@lru_cache(maxsize=1)
def measure_quality(data_file: str) -> dict:
    """Test on leads kept out of training, as a score can look good on data it has already seen."""
    leads = pd.read_csv(data_file)
    inputs = model_inputs(leads)
    activated = leads["outcome"] == "Activated"
    train_inputs, test_inputs, train_outcome, test_outcome = train_test_split(
        inputs, activated, test_size=0.25, random_state=7, stratify=activated
    )
    chances = new_model().fit(train_inputs, train_outcome).predict_proba(test_inputs)[:, 1]

    results = pd.DataFrame({"chance": chances, "activated": test_outcome.to_numpy()})
    top_fifth = results.nlargest(len(results) // 5, "chance")
    return {
        "auc": round(float(roc_auc_score(test_outcome, chances)), 2),
        "test_leads": len(results),
        "top_fifth_share_of_activations_pct": round(top_fifth["activated"].sum() / results["activated"].sum() * 100),
        "top_fifth_activation_pct": round(top_fifth["activated"].mean() * 100, 1),
        "all_leads_activation_pct": round(results["activated"].mean() * 100, 1),
    }
