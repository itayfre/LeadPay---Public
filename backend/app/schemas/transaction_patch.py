from datetime import date
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel


class TransactionPatchRequest(BaseModel):
    """Partial update for a Transaction. Only present fields are changed."""
    activity_date: Optional[date] = None
    description: Optional[str] = None
    credit_amount: Optional[Decimal] = None
    debit_amount: Optional[Decimal] = None
