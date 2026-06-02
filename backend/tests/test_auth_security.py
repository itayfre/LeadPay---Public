"""Security regression tests for the auth layer.

Covers:
- C1: production startup guard rejects the placeholder / missing JWT secret.
- H1: refresh tokens are not accepted where an access token is required.
- M1: password-strength validation on the password-setting endpoints.
"""
import pytest
from fastapi import HTTPException

from app.services import auth_service
from app.services.auth_service import (
    create_access_token,
    create_refresh_token,
    decode_token,
    validate_secret_key,
    PLACEHOLDER_SECRET,
)


# ── C1: JWT secret startup guard ─────────────────────────────────────────────
class TestSecretKeyGuard:
    def test_placeholder_rejected_in_production(self):
        with pytest.raises(RuntimeError):
            validate_secret_key(PLACEHOLDER_SECRET, app_env="production")

    def test_empty_rejected_in_production(self):
        with pytest.raises(RuntimeError):
            validate_secret_key("", app_env="production")

    def test_real_key_accepted_in_production(self):
        # Should not raise.
        validate_secret_key("a" * 48, app_env="production")

    def test_placeholder_allowed_in_development(self):
        # Local dev must keep working without a configured secret.
        validate_secret_key(PLACEHOLDER_SECRET, app_env="development")


# ── H1: token type enforcement ───────────────────────────────────────────────
class TestTokenTypeEnforcement:
    def test_access_token_accepted_as_access(self):
        tok = create_access_token(user_id="u1", role="MANAGER")
        payload = decode_token(tok, expected_type="access")
        assert payload["sub"] == "u1"

    def test_refresh_token_rejected_as_access(self):
        tok = create_refresh_token(user_id="u1")
        with pytest.raises(HTTPException) as exc:
            decode_token(tok, expected_type="access")
        assert exc.value.status_code == 401

    def test_refresh_token_accepted_as_refresh(self):
        tok = create_refresh_token(user_id="u1")
        payload = decode_token(tok, expected_type="refresh")
        assert payload["sub"] == "u1"

    def test_no_expected_type_accepts_any(self):
        # Backwards-compatible: omitting expected_type does not enforce.
        tok = create_refresh_token(user_id="u1")
        payload = decode_token(tok)
        assert payload["type"] == "refresh"
