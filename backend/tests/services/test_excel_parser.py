"""Tests for the bank statement Excel parser.

Focuses on the per-row dict shape produced by `_parse_transactions`. The Leumi
XLSX format exposes a separate `תאור מורחב` (extended description) column —
we need to preserve its content verbatim so the UI can surface the full
transaction detail to the user.
"""
from __future__ import annotations

import pandas as pd

from app.services.excel_parser import BankStatementParser


def test_parser_persists_extended_description():
    """Leumi-style row with extended description survives the parse."""
    # Already-normalized DataFrame (English column names — same shape the
    # parser's _normalize_columns step would produce for a Leumi file).
    df = pd.DataFrame([{
        'activity_date': '01/05/26',
        'description': "העב' לאחר-נייד",
        'extended_description': 'תשלום לחברת החשמל - חשבון 12345',
        'reference': '',
        'credit': 87.5,
        'debit': None,
        'balance': 1000.0,
    }])

    parser = BankStatementParser()
    rows = parser._parse_transactions(df)

    assert len(rows) == 1
    assert rows[0]['description'] == "העב' לאחר-נייד"
    assert rows[0]['extended_description'] == 'תשלום לחברת החשמל - חשבון 12345'


def test_parser_extended_description_none_when_missing():
    """Formats without a תאור מורחב column produce extended_description=None."""
    df = pd.DataFrame([{
        'activity_date': '01/05/26',
        'description': 'העברה מבנק הפועלים - דוד כהן',
        'reference': '12345',
        'credit': 500.0,
        'debit': None,
        'balance': 5000.0,
    }])

    parser = BankStatementParser()
    rows = parser._parse_transactions(df)

    assert len(rows) == 1
    assert rows[0]['extended_description'] is None
