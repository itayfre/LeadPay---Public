from __future__ import annotations

from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, field_validator, model_validator


class AllocationItem(BaseModel):
    tenant_id: Optional[UUID] = None
    label: Optional[str] = None
    amount: Decimal
    period_month: Optional[int] = None
    period_year: Optional[int] = None

    @field_validator("amount")
    @classmethod
    def must_be_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

    @model_validator(mode="after")
    def tenant_or_label_required(self) -> "AllocationItem":
        if self.tenant_id is None and not self.label:
            raise ValueError("each allocation requires tenant_id or label")
        return self


class SetAllocationsRequest(BaseModel):
    allocations: List[AllocationItem]

    @field_validator("allocations")
    @classmethod
    def must_not_be_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("allocations list must not be empty")
        return v


class AllocationResponse(BaseModel):
    id: str
    transaction_id: str
    tenant_id: Optional[str]
    label: Optional[str]
    amount: float
    period_month: Optional[int]
    period_year: Optional[int]
    category: Optional[str]
    notes: Optional[str]
    created_at: str
