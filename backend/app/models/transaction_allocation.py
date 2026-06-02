"""
TransactionAllocation — links a bank Transaction to one or more "targets":
a tenant (the common case), or an arbitrary label (non-tenant income/expense).

Introduced in PR-2 as the storage primitive for split allocations and
expense categorization. PR-2 itself does not yet create split allocations;
the upload + manual-match paths write at most one allocation per transaction
to maintain backwards compatibility with the denormalized
`Transaction.matched_tenant_id` cache.

PR-3 lifts that one-allocation-per-transaction invariant (UI for splits).
PR-4 starts populating `category` for expense rows.
"""
from sqlalchemy import (
    Column,
    String,
    DateTime,
    Numeric,
    ForeignKey,
    CheckConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from ..database import Base


# Allocation categories — populated in PR-4 by the vendor classifier.
# Kept as strings (not a SQL enum) because the value set is expected to grow
# as new categories are added; using a varchar avoids a migration per change.
ALLOCATION_CATEGORIES = (
    "routine_maintenance",
    "technical_maintenance",
    "administrative",
    "extraordinary",
)


class TransactionAllocation(Base):
    __tablename__ = "transaction_allocations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    transaction_id = Column(
        UUID(as_uuid=True),
        ForeignKey("transactions.id", ondelete="CASCADE"),
        nullable=False,
        comment="Parent bank transaction this allocation is part of",
    )

    # Soft FK — ON DELETE SET NULL keeps allocation history when a tenant is
    # removed, mirroring the existing behavior of Transaction.matched_tenant_id.
    tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        comment="Tenant credited/charged by this allocation (null for non-tenant rows)",
    )

    label = Column(
        String,
        nullable=True,
        comment="Free-text label for non-tenant allocations (e.g. 'החזר ביטוח')",
    )

    amount = Column(
        Numeric(10, 2),
        nullable=False,
        comment="Portion of the parent transaction's amount allocated here",
    )

    category = Column(
        String(32),
        nullable=True,
        comment=(
            "Legacy expense category (string) — populated by the vendor classifier "
            f"at upload time. Expected values: {', '.join(ALLOCATION_CATEGORIES)}. "
            "DEPRECATED for new UI: use category_id instead. Kept for backward compat."
        ),
    )

    category_id = Column(
        UUID(as_uuid=True),
        ForeignKey("expense_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="User-defined per-building category (introduced post PR-4).",
    )

    # Pointers introduced in Phase-1 and made canonical in Phase-6b cutover.
    # An allocation either pays down a monthly apartment debt (most common),
    # a one-off special charge, or is a label-only income/expense row (both
    # pointers NULL). The XOR is enforced by ck_allocation_debt_pointer_xor.
    apartment_period_debt_id = Column(
        UUID(as_uuid=True),
        ForeignKey("apartment_period_debts.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="Allocation pays down this period's apartment debt",
    )
    special_charge_id = Column(
        UUID(as_uuid=True),
        ForeignKey("special_charges.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
        comment="Allocation pays down this one-off special charge",
    )

    notes = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    transaction = relationship("Transaction", back_populates="allocations")
    tenant = relationship("Tenant", back_populates="allocations")
    category_ref = relationship("ExpenseCategory", back_populates="allocations")
    apartment_period_debt = relationship("ApartmentPeriodDebt", lazy="joined")

    __table_args__ = (
        # Every allocation must point somewhere — at a tenant, a label, or both.
        # Without this constraint we could end up with "ghost" allocations that
        # silently swallow money.
        CheckConstraint(
            "tenant_id IS NOT NULL OR label IS NOT NULL",
            name="ck_allocation_has_target",
        ),
        # Tenant rows must point at EITHER a period-debt OR a special-charge
        # (XOR). Label-only rows (no tenant) carry neither pointer.
        # Introduced in Phase 6b cutover after period_year/month were dropped.
        CheckConstraint(
            "(tenant_id IS NULL AND apartment_period_debt_id IS NULL"
            " AND special_charge_id IS NULL)"
            " OR (tenant_id IS NOT NULL AND ("
            "(apartment_period_debt_id IS NOT NULL)::int"
            " + (special_charge_id IS NOT NULL)::int = 1"
            "))",
            name="ck_allocation_debt_pointer_xor",
        ),
        Index("ix_allocations_transaction_id", "transaction_id"),
    )

    def __repr__(self) -> str:
        target = (
            f"tenant={self.tenant_id}"
            if self.tenant_id
            else f"label={self.label!r}"
        )
        return (
            f"<TransactionAllocation id={self.id} txn={self.transaction_id} "
            f"{target} amount={self.amount}>"
        )
