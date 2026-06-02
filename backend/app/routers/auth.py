import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session
from uuid import UUID

from ..database import get_db
from ..models.user import User, UserRole, UserStatus
from ..models.building import Building
from ..services.auth_service import (
    hash_password, verify_password,
    create_access_token, create_refresh_token,
    decode_token,
)
from ..dependencies.auth import get_current_user
from ..utils.user_utils import user_to_dict

logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

MIN_PASSWORD_LENGTH = 8


def _validate_password_strength(value: str) -> str:
    """Shared password policy (M1): enforce a minimum length on every endpoint
    that sets a password."""
    if value is None or len(value) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return value


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    building_id: Optional[str] = None

    _check_password = field_validator("password")(_validate_password_strength)


class SetupRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str

    _check_password = field_validator("password")(_validate_password_strength)


class InviteAcceptRequest(BaseModel):
    full_name: str
    password: str

    _check_password = field_validator("password")(_validate_password_strength)


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login")
@limiter.limit("5/minute")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Login with email + password. Returns access_token, refresh_token and user info."""
    user = db.query(User).filter(User.email == form_data.username.lower().strip()).first()
    if not user or not user.hashed_password or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status == UserStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is pending approval. Contact your building manager.",
        )
    if user.status == UserStatus.INVITED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please complete your account setup using the invite link.",
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active. Contact your manager.",
        )

    access_token = create_access_token(
        user_id=str(user.id),
        role=user.role.value,
        building_id=str(user.building_id) if user.building_id else None,
    )
    refresh_token = create_refresh_token(user_id=str(user.id))

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user_to_dict(user),
    }


@router.post("/refresh")
@limiter.limit("20/minute")
def refresh_token(request: Request, body: RefreshRequest, db: Session = Depends(get_db)):
    """
    Exchange a valid refresh token for a new access token + a fresh refresh token.
    Sliding window: every use resets the 30-day inactivity clock.
    """
    payload = decode_token(body.refresh_token, expected_type="refresh")

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    new_access_token = create_access_token(
        user_id=str(user.id),
        role=user.role.value,
        building_id=str(user.building_id) if user.building_id else None,
    )
    # Issue a fresh refresh token (sliding window — resets the 30-day clock on every use)
    new_refresh_token = create_refresh_token(user_id=str(user.id))

    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.get("/me")
def get_me(current_user: User = Depends(get_current_user)):
    """Get the current authenticated user's profile."""
    return user_to_dict(current_user)


@router.post("/register", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def register_tenant(request: Request, body: RegisterRequest, db: Session = Depends(get_db)):
    """
    Tenant self-registration. Creates account with status=PENDING.
    Must be approved by Manager/Worker before login is allowed.
    """
    existing = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    if body.building_id:
        building = db.query(Building).filter(Building.id == body.building_id).first()
        if not building:
            raise HTTPException(status_code=404, detail="Building not found")

    user = User(
        email=body.email.lower().strip(),
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=UserRole.TENANT,
        status=UserStatus.PENDING,
        building_id=UUID(body.building_id) if body.building_id else None,
    )
    db.add(user)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail="שגיאה בהרשמה. אנא נסה שוב.")

    return {
        "message": "הרשמתך התקבלה ותאושר בקרוב על ידי המנהל",
        "status": "pending",
    }


@router.get("/setup/status")
def setup_status(db: Session = Depends(get_db)):
    """Check if initial setup is needed (no users exist yet)."""
    has_users = db.query(User).first() is not None
    return {"setup_needed": not has_users}


@router.post("/setup", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
def initial_setup(request: Request, body: SetupRequest, db: Session = Depends(get_db)):
    """
    One-time setup: create the first manager account.
    Returns 403 if any user already exists — use the regular login after that.
    """
    # Password length is enforced by SetupRequest's field validator (M1).
    existing_users = db.query(User).first()
    if existing_users:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Setup already completed. Use /login instead.",
        )

    user = User(
        email=body.email.lower().strip(),
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=UserRole.MANAGER,
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(
        user_id=str(user.id),
        role=user.role.value,
        building_id=None,
    )
    refresh_token = create_refresh_token(user_id=str(user.id))
    return {
        "message": "Manager account created successfully",
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user_to_dict(user),
    }


@router.get("/invite/{token}")
def validate_invite(token: str, db: Session = Depends(get_db)):
    """Validate an invite token and return basic user info for the accept form."""
    user = db.query(User).filter(
        User.invite_token == token,
        User.status == UserStatus.INVITED,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="Invalid or expired invite link")
    if user.invite_expires_at and user.invite_expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Invite link has expired")
    return {
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
    }


@router.post("/invite/{token}/accept")
@limiter.limit("10/minute")
def accept_invite(request: Request, token: str, body: InviteAcceptRequest, db: Session = Depends(get_db)):
    """Accept an invite link: set password and activate the account. Returns JWT tokens."""
    user = db.query(User).filter(
        User.invite_token == token,
        User.status == UserStatus.INVITED,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="Invalid or expired invite link")
    if user.invite_expires_at and user.invite_expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Invite link has expired")

    user.hashed_password = hash_password(body.password)
    user.full_name = body.full_name
    user.status = UserStatus.ACTIVE
    user.invite_token = None
    user.invite_expires_at = None
    db.commit()

    access_token = create_access_token(
        user_id=str(user.id),
        role=user.role.value,
        building_id=str(user.building_id) if user.building_id else None,
    )
    refresh_token = create_refresh_token(user_id=str(user.id))
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user_to_dict(user),
    }
