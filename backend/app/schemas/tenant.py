from pydantic import BaseModel, EmailStr, ConfigDict, model_validator
from datetime import datetime, date
from typing import Optional
from uuid import UUID

from ..models.tenant import OwnershipType, LanguagePreference


class TenantBase(BaseModel):
    name: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    language: LanguagePreference = LanguagePreference.HEBREW
    ownership_type: Optional[OwnershipType] = None
    is_committee_member: bool = False
    standing_order_start_date: Optional[date] = None
    standing_order_end_date: Optional[date] = None
    standing_order_amount: Optional[float] = None
    notes: Optional[str] = None
    is_active: bool = True
    move_in_date: Optional[date] = None

    @model_validator(mode="after")
    def _validate_standing_order(self):
        if self.standing_order_start_date is not None:
            if self.standing_order_amount is None or self.standing_order_amount <= 0:
                raise ValueError(
                    "standing_order_amount must be > 0 when standing_order_start_date is set"
                )
        if (
            self.standing_order_start_date is not None
            and self.standing_order_end_date is not None
            and self.standing_order_end_date < self.standing_order_start_date
        ):
            raise ValueError("standing_order_end_date must be >= standing_order_start_date")
        return self


class TenantCreate(TenantBase):
    apartment_id: UUID
    building_id: UUID  # required — which building this tenant belongs to


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    language: Optional[LanguagePreference] = None
    ownership_type: Optional[OwnershipType] = None
    is_committee_member: Optional[bool] = None
    standing_order_start_date: Optional[date] = None
    standing_order_end_date: Optional[date] = None
    standing_order_amount: Optional[float] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None
    move_in_date: Optional[date] = None

    @model_validator(mode="after")
    def _validate_standing_order(self):
        if (
            self.standing_order_start_date is not None
            and self.standing_order_end_date is not None
            and self.standing_order_end_date < self.standing_order_start_date
        ):
            raise ValueError("standing_order_end_date must be >= standing_order_start_date")
        return self


class TenantResponse(TenantBase):
    id: UUID
    apartment_id: UUID
    building_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TenantImportRow(BaseModel):
    """Schema for importing a tenant from Excel"""
    apartment_number: int
    floor: int
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    ownership_type: str
    expected_payment: Optional[float] = None
