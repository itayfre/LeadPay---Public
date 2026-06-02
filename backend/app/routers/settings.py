"""System-wide settings endpoints, backed by the `app_config` key-value table.

GET /api/v1/settings/                  — any authenticated user; returns
                                          full config with synthesised defaults
PUT /api/v1/settings/risk_thresholds   — managers only; upserts the row
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import require_any_auth, require_manager
from ..models import AppConfig
from ..models.user import User
from ..schemas.settings import (
    AppConfigResponse,
    DEFAULT_RISK_THRESHOLDS,
    RiskThresholds,
)


router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


def _load_risk_thresholds(db: Session) -> RiskThresholds:
    """Read the `risk_thresholds` row, falling back to in-code defaults."""
    row = db.get(AppConfig, "risk_thresholds")
    if row is None:
        return DEFAULT_RISK_THRESHOLDS
    try:
        return RiskThresholds.model_validate(row.value)
    except Exception:
        # Stored value got corrupted somehow — never crash the dashboard.
        return DEFAULT_RISK_THRESHOLDS


@router.get("/", response_model=AppConfigResponse)
def get_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_any_auth),
) -> AppConfigResponse:
    """Return all system settings, synthesising defaults for unset keys."""
    return AppConfigResponse(risk_thresholds=_load_risk_thresholds(db))


@router.put("/risk_thresholds", response_model=RiskThresholds)
def put_risk_thresholds(
    body: RiskThresholds,
    db: Session = Depends(get_db),
    user: User = Depends(require_manager),
) -> RiskThresholds:
    """Upsert the risk_thresholds key. Validation lives on the schema."""
    row = db.get(AppConfig, "risk_thresholds")
    payload = body.model_dump()
    if row is None:
        row = AppConfig(
            key="risk_thresholds",
            value=payload,
            updated_by=user.id,
        )
        db.add(row)
    else:
        row.value = payload
        row.updated_by = user.id
        row.updated_at = datetime.utcnow()
    db.commit()
    return body
