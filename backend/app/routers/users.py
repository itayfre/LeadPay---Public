import logging
import os
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from uuid import UUID

from ..database import get_db
from ..models.user import User, UserRole, UserStatus
from ..models.building import Building
from ..services.auth_service import generate_invite_token
from ..dependencies.auth import require_manager, require_worker_plus
from ..utils.user_utils import user_to_dict

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/users", tags=["users"])


class InviteUserRequest(BaseModel):
    email: EmailStr
    full_name: str
    role: UserRole = UserRole.VIEWER
    building_id: Optional[str] = None


class UpdateUserRequest(BaseModel):
    role: Optional[UserRole] = None
    status: Optional[UserStatus] = None
    building_id: Optional[str] = None
    full_name: Optional[str] = None


@router.get("/", response_model=List[dict])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """List all users (manager only)."""
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [user_to_dict(u) for u in users]


@router.get("/pending", response_model=List[dict])
def list_pending(
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """List pending tenant registrations (manager/worker)."""
    users = db.query(User).filter(User.status == UserStatus.PENDING).all()
    return [user_to_dict(u) for u in users]


@router.post("/invite", status_code=status.HTTP_201_CREATED)
def invite_user(
    body: InviteUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Create a user and return an invite link (manager only). The link is valid for 7 days."""
    existing = db.query(User).filter(User.email == body.email.lower().strip()).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    building_uuid = None
    if body.building_id:
        building = db.query(Building).filter(Building.id == body.building_id).first()
        if not building:
            raise HTTPException(status_code=404, detail="Building not found")
        building_uuid = building.id

    token = generate_invite_token()
    expires = datetime.utcnow() + timedelta(days=7)

    user = User(
        email=body.email.lower().strip(),
        full_name=body.full_name,
        role=body.role,
        status=UserStatus.INVITED,
        building_id=building_uuid,
        invite_token=token,
        invite_expires_at=expires,
        created_by=current_user.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    invite_url = f"{frontend_url}/invite/{token}"
    return {
        "user": user_to_dict(user),
        "invite_url": invite_url,
        "expires_at": expires.isoformat(),
        "message": f"Send this link to {user.email}: {invite_url}",
    }


@router.patch("/{user_id}", response_model=dict)
def update_user(
    user_id: UUID,
    body: UpdateUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Update user role/status/building/name (manager only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.role is not None:
        user.role = body.role

    if body.status is not None:
        user.status = body.status

    if body.building_id is not None:
        user.building_id = UUID(body.building_id) if body.building_id else None

    if body.full_name is not None:
        user.full_name = body.full_name

    db.commit()
    db.refresh(user)
    return user_to_dict(user)


@router.post("/{user_id}/approve", response_model=dict)
def approve_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Approve a pending tenant registration (manager/worker)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.status != UserStatus.PENDING:
        raise HTTPException(status_code=400, detail="User is not in pending status")

    user.status = UserStatus.ACTIVE
    db.commit()
    db.refresh(user)
    return {"message": "User approved", "user": user_to_dict(user)}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_manager),
):
    """Delete a user (manager only). Cannot delete your own account."""
    if str(user_id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return None
