from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional

from ..database import get_db
from ..models.user import User, UserRole, UserStatus
from ..services.auth_service import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the JWT bearer token. Returns the authenticated User."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token, expected_type="access")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    return user


def require_role(*roles: UserRole):
    """Dependency factory: raise 403 if the authenticated user does not have one of the specified roles."""
    def dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user
    return dep


def require_building_access(building_id: UUID, user: User = Depends(get_current_user)) -> User:
    """Tenant users can only access their own building."""
    if user.role == UserRole.TENANT and str(user.building_id) != str(building_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to this building is not permitted",
        )
    return user


def assert_tenant_building_access(user: User, building_id) -> None:
    """Raise 403 if user is a TENANT and building_id doesn't match their assignment.
    No-op for non-tenant roles. Call inside endpoints that take a building_id from the path."""
    if user.role == UserRole.TENANT and str(user.building_id) != str(building_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access to this building is not permitted",
        )


# Convenience role-check shortcuts
require_manager = require_role(UserRole.MANAGER)
require_worker_plus = require_role(UserRole.MANAGER, UserRole.WORKER)
require_viewer_plus = require_role(UserRole.MANAGER, UserRole.WORKER, UserRole.VIEWER)
require_viewer_or_tenant = require_role(UserRole.MANAGER, UserRole.WORKER, UserRole.VIEWER, UserRole.TENANT)
require_any_auth = require_role(UserRole.MANAGER, UserRole.WORKER, UserRole.VIEWER, UserRole.TENANT)
