def test_apartment_has_weight_and_fallback_owner():
    """Schema-level check that the new columns exist on the model."""
    from app.models.apartment import Apartment
    cols = {c.name for c in Apartment.__table__.columns}
    assert "weight" in cols
    assert "fallback_owner_tenant_id" in cols
