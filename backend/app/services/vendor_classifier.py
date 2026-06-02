"""
Vendor classifier — maps bank transaction descriptions to expense categories.

Algorithm (token-based, Option B):
  1. Tokenise description on whitespace.
  2. Check building-specific VendorMapping rows first (confidence 1.0).
     Longest keyword wins when multiple rules match.
  3. Fall back to DEFAULT_VENDOR_RULES (confidence 0.8).
  4. Return None if neither matches.

Token matching avoids false positives like "מים" inside "שמים" —
each keyword token must appear as a standalone token in the description.
"""

from __future__ import annotations

from typing import TypedDict

from ..models.vendor_mapping import VendorMapping


# ── Result type ──────────────────────────────────────────────────────────────

class ClassificationResult(TypedDict):
    vendor_label: str
    category: str
    confidence: float


# ── Static default rules ─────────────────────────────────────────────────────
# Each entry: (keyword, vendor_label, category)
# Listed longest-first within each category so the sort below preserves intent.

DEFAULT_VENDOR_RULES: list[tuple[str, str, str]] = [
    # routine_maintenance ─────────────────────────────────────────────────────
    ("חברת החשמל",       "חברת החשמל",          "routine_maintenance"),
    ("חברת חשמל",        "חברת החשמל",          "routine_maintenance"),
    ("שירותי ניקיון",    "שירותי ניקיון",       "routine_maintenance"),
    ("תאגיד מים",        "תאגיד מים",           "routine_maintenance"),
    ("מי אביבים",        "מי אביבים",           "routine_maintenance"),
    ("מקורות",           "מקורות",              "routine_maintenance"),
    ("ניקיון",           "ניקיון",              "routine_maintenance"),
    ("גינון",            "גינון",               "routine_maintenance"),
    ("גנן",              "גנן",                 "routine_maintenance"),
    ("ועד בית",          "ועד בית",             "routine_maintenance"),
    ("חשמל",             "חשמל",                "routine_maintenance"),
    ("מים",              "מים",                 "routine_maintenance"),

    # technical_maintenance ───────────────────────────────────────────────────
    ("שירות מעליות",     "שירות מעליות",        "technical_maintenance"),
    ("מעליות",           "מעליות",              "technical_maintenance"),
    ("מעלית",            "מעלית",               "technical_maintenance"),
    ("שינדלר",           "שינדלר",              "technical_maintenance"),
    ("אוטיס",            "אוטיס",               "technical_maintenance"),
    ("כיבוי אש",         "כיבוי אש",            "technical_maintenance"),
    ("גנרטור",           "גנרטור",              "technical_maintenance"),
    ("מזגן",             "מזגן",                "technical_maintenance"),
    ("אינסטלציה",        "אינסטלציה",           "technical_maintenance"),

    # administrative ──────────────────────────────────────────────────────────
    ("ביטוח מבנה",       "ביטוח מבנה",          "administrative"),
    ("ביטוח",            "ביטוח",               "administrative"),
    ("רואה חשבון",       "רואה חשבון",          "administrative"),
    ("עורך דין",         "עורך דין",            "administrative"),
    ('עו"ד',             'עו"ד',                "administrative"),
    ("ארנונה",           "ארנונה",              "administrative"),
    ("ניהול",            "ניהול",               "administrative"),

    # extraordinary ───────────────────────────────────────────────────────────
    ("שיפוצים",          "שיפוצים",             "extraordinary"),
    ("שיפוץ",            "שיפוץ",               "extraordinary"),
    ("איטום",            "איטום",               "extraordinary"),
    ("אטימה",            "אטימה",               "extraordinary"),
    ("בנייה",            "בנייה",               "extraordinary"),
    ("קבלן",             "קבלן",                "extraordinary"),
    ("חיזוק",            "חיזוק",               "extraordinary"),
    ("צנרת",             "צנרת",                "extraordinary"),
]


# ── Token helpers ─────────────────────────────────────────────────────────────

def _tokenise(text: str) -> set[str]:
    """Lower-case + split on whitespace."""
    return set(text.lower().split())


def _keyword_matches(keyword: str, description_tokens: set[str]) -> bool:
    """Return True if every token of `keyword` is present in `description_tokens`."""
    return all(tok in description_tokens for tok in keyword.lower().split())


# ── Public API ────────────────────────────────────────────────────────────────

def classify(
    description: str,
    building_mappings: list[VendorMapping],
) -> ClassificationResult | None:
    """
    Classify a debit transaction description into a vendor + category.

    Checks building-specific mappings first (confidence 1.0), then falls back
    to DEFAULT_VENDOR_RULES (confidence 0.8).  Longest matching keyword wins.
    Returns None if no rule matches.
    """
    tokens = _tokenise(description)

    # 1. User-defined mappings — sort longest keyword first so a more specific
    #    rule beats a shorter one that is also a substring.
    user_rules = sorted(building_mappings, key=lambda m: len(m.keyword), reverse=True)
    for mapping in user_rules:
        if _keyword_matches(mapping.keyword, tokens):
            return ClassificationResult(
                vendor_label=mapping.vendor_label,
                category=mapping.category,
                confidence=1.0,
            )

    # 2. Static defaults — already written longest-first above, but sort anyway
    #    for safety when the list is extended.
    static_rules = sorted(DEFAULT_VENDOR_RULES, key=lambda r: len(r[0]), reverse=True)
    for keyword, vendor_label, category in static_rules:
        if _keyword_matches(keyword, tokens):
            return ClassificationResult(
                vendor_label=vendor_label,
                category=category,
                confidence=0.8,
            )

    return None
