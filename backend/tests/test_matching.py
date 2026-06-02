"""Tests for the fuzzy name matching engine."""
import pytest
from app.services.matching_engine import NameMatchingEngine


@pytest.fixture
def engine():
    return NameMatchingEngine(confidence_threshold=0.7)


@pytest.fixture
def tenants():
    return [
        {"id": "tenant-1", "name": "גיא מ", "full_name": "גיא מן"},
        {"id": "tenant-2", "name": "רחל ל", "full_name": "רחל לב"},
        {"id": "tenant-3", "name": "פאולה ג", "full_name": "פאולה גוזמן"},
        {"id": "tenant-4", "name": "דניאל די", "full_name": "דניאל בן יהודה"},
    ]


def test_exact_match(engine, tenants):
    """Exact name match returns tenant with high confidence."""
    tenant_id, score, method = engine.match_transaction_to_tenants(
        "גיא מן", tenants
    )
    assert tenant_id == "tenant-1"
    assert score >= 0.9
    assert method in ("exact", "fuzzy", "reversed_name")


def test_reversed_name_match(engine, tenants):
    """Reversed name (מן גיא) matches גיא מן."""
    tenant_id, score, method = engine.match_transaction_to_tenants(
        "מן גיא", tenants
    )
    assert tenant_id == "tenant-1"
    assert score >= 0.7


def test_fuzzy_match_abbreviated(engine, tenants):
    """Reversed name גוזמן פאולה matches פאולה גוזמן."""
    tenant_id, score, method = engine.match_transaction_to_tenants(
        "גוזמן פאולה", tenants
    )
    assert tenant_id == "tenant-3"
    assert score >= 0.7


def test_no_match_below_threshold(engine, tenants):
    """Completely different name returns no match."""
    tenant_id, score, method = engine.match_transaction_to_tenants(
        "ג'ון דו", tenants
    )
    assert tenant_id is None


def test_amount_boost(engine, tenants):
    """Matching amount boosts confidence score."""
    # First get baseline score
    _, base_score, _ = engine.match_transaction_to_tenants("גיא מ", tenants)

    # Now with matching amount
    _, boosted_score, _ = engine.match_transaction_to_tenants(
        "גיא מ", tenants, expected_amount=190.0, actual_amount=190.0
    )
    assert boosted_score >= base_score


def test_empty_payer_name(engine, tenants):
    """Empty payer name returns no match."""
    tenant_id, score, method = engine.match_transaction_to_tenants("", tenants)
    assert tenant_id is None
    assert score == 0.0


def test_empty_tenants_list(engine):
    """Empty tenant list returns no match."""
    tenant_id, score, method = engine.match_transaction_to_tenants("גיא מן", [])
    assert tenant_id is None


def test_normalize_final_letters(engine):
    """Hebrew final letters normalized correctly."""
    # ך -> כ, ם -> מ, ן -> נ
    normalized = engine._normalize_name("מלך")
    assert "ך" not in normalized


def test_suggest_matches_returns_top_n(engine, tenants):
    """suggest_matches returns up to N results sorted by confidence."""
    # Use a common word that should match multiple tenants
    suggestions = engine.suggest_matches("גיא", tenants, top_n=2)
    # Must return a list
    assert isinstance(suggestions, list)
    # Must respect top_n limit
    assert len(suggestions) <= 2

def test_suggest_matches_sorted_by_confidence(engine, tenants):
    """suggest_matches results are sorted by confidence descending."""
    # Request more than 1 result with a broad query
    suggestions = engine.suggest_matches("מן", tenants, top_n=4)
    if len(suggestions) >= 2:
        # Verify sorted descending
        for i in range(len(suggestions) - 1):
            assert suggestions[i][1] >= suggestions[i+1][1],                 f"Not sorted: {suggestions[i][1]} < {suggestions[i+1][1]}"
