from pydantic import BaseModel, ConfigDict
from datetime import datetime, date
from typing import Optional
from decimal import Decimal
from uuid import UUID


class BuildingBase(BaseModel):
    name: str
    address: str
    city: str
    bank_account_number: Optional[str] = None
    total_tenants: Optional[int] = 0
    expected_monthly_payment: Optional[Decimal] = None
    default_move_in_date: Optional[date] = None


class BuildingCreate(BuildingBase):
    pass


class BuildingUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    bank_account_number: Optional[str] = None
    total_tenants: Optional[int] = None
    expected_monthly_payment: Optional[Decimal] = None
    default_move_in_date: Optional[date] = None


class BuildingResponse(BuildingBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    default_move_in_date: date

    model_config = ConfigDict(from_attributes=True)
