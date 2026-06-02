import os
import secrets
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status

PLACEHOLDER_SECRET = "CHANGE_ME_in_production_use_openssl_rand_hex_32"
SECRET_KEY = os.getenv("APP_SECRET_KEY", PLACEHOLDER_SECRET)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))


def validate_secret_key(secret: str, app_env: str) -> None:
    """Fail-fast guard (C1): in production the JWT signing key must be a real,
    configured secret. A missing or placeholder key would let anyone forge tokens,
    so we refuse to start rather than boot insecurely. No-op outside production."""
    if app_env == "production" and (not secret or secret == PLACEHOLDER_SECRET):
        raise RuntimeError(
            "APP_SECRET_KEY is missing or still set to the placeholder value in "
            "production. Set APP_SECRET_KEY to a strong random value "
            "(e.g. `openssl rand -hex 32`) before starting the app."
        )


# Enforce the guard at import time so a misconfigured prod deploy fails to boot.
validate_secret_key(SECRET_KEY, os.getenv("APP_ENV", "development"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    """Hash a plain-text password with bcrypt."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str, role: str, building_id: Optional[str] = None) -> str:
    """Create a short-lived JWT access token (default: 30 min)."""
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": user_id,
        "role": role,
        "building_id": building_id,
        "type": "access",
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    """Create a long-lived JWT refresh token (default: 30 days)."""
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str, expected_type: Optional[str] = None) -> dict:
    """Decode and validate a JWT token. Raises 401 if invalid or expired.

    When ``expected_type`` is given (e.g. "access" or "refresh"), the token's
    ``type`` claim must match — this stops a long-lived refresh token from being
    used as an access bearer token, and vice versa (H1)."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if expected_type is not None and payload.get("type") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


def generate_invite_token() -> str:
    """Generate a secure random token for user invite links."""
    return secrets.token_urlsafe(32)
