"""Pydantic schemas for system-wide configuration (`app_config` table)."""
from pydantic import BaseModel, Field, field_validator, model_validator


class RiskThresholds(BaseModel):
    """Home-page collection-rate thresholds.

    Buildings with `collection_rate < partial` are "at risk".
    Buildings with `collection_rate >= onTrack` are "on track".
    Anything in between is "partial".
    """
    partial: int = Field(..., ge=0, le=100)
    onTrack: int = Field(..., ge=0, le=100)

    @field_validator("partial", "onTrack")
    @classmethod
    def _integer_only(cls, v: int) -> int:
        # Field already enforces int via type, but reject NaN-like floats etc.
        if not isinstance(v, int) or isinstance(v, bool):
            raise ValueError("must be an integer")
        return v

    @model_validator(mode="after")
    def _ordering(self) -> "RiskThresholds":
        if self.partial >= self.onTrack:
            raise ValueError("partial must be strictly less than onTrack")
        return self


class AppConfigResponse(BaseModel):
    """Full system-config payload returned to the client.

    Always returns every known key, synthesising defaults for keys not yet
    stored in the database. Frontend therefore never needs to handle a
    "missing key" case.
    """
    risk_thresholds: RiskThresholds


# In-code defaults — single source of truth. Mirrored in
# `frontend/src/lib/buildingStatus.ts` as DEFAULT_RISK_THRESHOLDS.
DEFAULT_RISK_THRESHOLDS = RiskThresholds(partial=30, onTrack=70)
