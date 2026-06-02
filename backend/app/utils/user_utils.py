from ..models.user import User


def user_to_dict(user: User) -> dict:
    """Serialize a User ORM object to a dict for API responses."""
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value,
        "status": user.status.value,
        "building_id": str(user.building_id) if user.building_id else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }
