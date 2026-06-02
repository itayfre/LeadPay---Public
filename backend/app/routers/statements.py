from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from ..database import get_db
from ..models import (
    BankStatement, Transaction, Building, Tenant,
    Apartment, TransactionType, MatchMethod, NameMapping, MappingCreatedBy,
    TransactionAllocation, VendorMapping, ExpenseCategory,
)
from ..models.user import User
from ..schemas.allocation import SetAllocationsRequest, AllocationResponse
from ..schemas.expense import CategorizeRequest
from ..schemas.transaction_patch import TransactionPatchRequest
from ..services.excel_parser import BankStatementParser
from ..services.matching_engine import NameMatchingEngine
from ..services import allocation_service
from ..services import vendor_classifier as vc
from ..services.expense_categories import ensure_fee_category
from ..dependencies.auth import require_worker_plus, require_viewer_plus, require_manager
import logging
import os
from slowapi import Limiter
from slowapi.util import get_remote_address

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)

# File upload security constants
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {'.xlsx', '.xls'}


def _is_check_or_cash(description: str) -> bool:
    """Return True if transaction is a check or cash deposit.
    These cause false positive name matches and should be skipped for NameMapping."""
    desc = description or ''
    return 'שיק' in desc or 'הפקדת מזומן' in desc or 'כספומט' in desc


_HEBREW_MONTHS = {
    1: 'ינואר', 2: 'פברואר', 3: 'מרץ', 4: 'אפריל',
    5: 'מאי', 6: 'יוני', 7: 'יולי', 8: 'אוגוסט',
    9: 'ספטמבר', 10: 'אוקטובר', 11: 'נובמבר', 12: 'דצמבר',
}


def _format_period_label(period_month: int, period_year: int) -> str:
    month_name = _HEBREW_MONTHS.get(period_month, str(period_month))
    return f"{month_name} {period_year}"

router = APIRouter(
    prefix="/api/v1/statements",
    tags=["bank statements"]
)

# Sub-router for transaction-level operations (categorize)
transactions_router = APIRouter(
    prefix="/api/v1/transactions",
    tags=["transactions"],
)

# Sub-router for vendor-mapping management
vendor_mappings_router = APIRouter(
    prefix="/api/v1",
    tags=["vendor mappings"],
)


@router.post("/{building_id}/upload", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def upload_bank_statement(
    request: Request,
    building_id: UUID,
    file: UploadFile = File(...),
    auto_match: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Upload and parse a bank statement Excel file for a building.
    Optionally auto-match transactions to tenants.
    """
    # Verify building exists
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    # Validate file extension
    filename = file.filename or ''
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="סוג קובץ לא נתמך. יש להעלות קבצי Excel בלבד (.xlsx, .xls)",
        )

    # L3: reject oversized uploads early using the declared size, before
    # buffering the whole file into memory.
    if file.size is not None and file.size > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="הקובץ גדול מדי. הגודל המקסימלי הוא 10MB",
        )

    # Read file content
    try:
        contents = await file.read()
    except Exception as e:
        logger.error(f"File read error for building {building_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to read file. Please check the format."
        )

    # Validate file size (fallback if size wasn't declared up front)
    if len(contents) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="הקובץ גדול מדי. הגודל המקסימלי הוא 10MB",
        )

    # Parse the Excel file (return_all=True so fees/transfers are saved for review UI)
    parser = BankStatementParser()
    try:
        transactions_data, metadata = parser.parse_excel(contents, file.filename, return_all=True)
    except Exception as e:
        logger.error(f"Excel parse error for building {building_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to parse Excel file. Please check the format."
        )

    # Check if a statement for this period already exists for this building
    duplicate_warning: str | None = None
    period_month = metadata.get('period_month')
    period_year = metadata.get('period_year')
    if period_month and period_year:
        existing_stmt = db.query(BankStatement).filter(
            BankStatement.building_id == building_id,
            BankStatement.period_month == period_month,
            BankStatement.period_year == period_year,
        ).first()
        if existing_stmt:
            month_name = _HEBREW_MONTHS.get(period_month, str(period_month))
            duplicate_warning = f"דף בנק לתקופה {month_name} {period_year} כבר הועלה לבניין זה."

    # Create bank statement record
    bank_statement = BankStatement(
        building_id=building_id,
        period_month=period_month,
        period_year=period_year,
        original_filename=file.filename,
        raw_data={'metadata': metadata, 'row_count': len(transactions_data)}
    )
    db.add(bank_statement)
    db.flush()

    # Get all tenants for this building for matching
    tenants = []
    if auto_match:
        tenants = db.query(Tenant).join(Apartment, Tenant.apartment_id == Apartment.id).filter(
            Apartment.building_id == building_id,
            Tenant.is_active == True
        ).all()

        # Convert to dict format for matcher
        tenants_dict = [
            {
                'id': str(t.id),
                'name': t.name,
                'full_name': t.full_name or t.name,
                'apartment_id': str(t.apartment_id)
            }
            for t in tenants
        ]

    # Initialize matching engine
    matcher = NameMatchingEngine(confidence_threshold=0.7)

    # Load NameMappings for this building to enable learned matching
    name_mappings = db.query(NameMapping).filter(
        NameMapping.building_id == building_id
    ).all()
    learned_map = {nm.bank_name.strip().lower(): nm.tenant_id for nm in name_mappings}

    # Load VendorMappings for expense classification
    building_vendor_mappings = db.query(VendorMapping).filter(
        VendorMapping.building_id == building_id
    ).all()

    # Create transaction records
    matched_count = 0
    unmatched_count = 0
    skipped_count = 0
    expense_classified = 0
    expense_unclassified = 0
    payment_transactions = []

    for trans_data in transactions_data:
        # Deduplication: skip if this transaction already exists in the DB
        ref_num = trans_data.get('reference_number', '')
        # Only use reference number as a dedup key if it's meaningful (> 4 chars).
        # Short/generic values like "1", "0", "null" appear on checks and cash deposits
        # and repeat across different transactions — using them would wrongly skip real entries.
        use_ref_num = ref_num and len(str(ref_num).strip()) > 4
        if use_ref_num:
            # Primary: deduplicate by reference number (אסמכתא)
            existing = db.query(Transaction).join(
                BankStatement, Transaction.statement_id == BankStatement.id
            ).filter(
                Transaction.reference_number == ref_num,
                BankStatement.building_id == building_id
            ).first()
        else:
            # Fallback: deduplicate by date + amount + description
            credit_val = trans_data.get('credit_amount')
            credit_filter = (
                Transaction.credit_amount.is_(None)
                if credit_val is None
                else Transaction.credit_amount == credit_val
            )
            existing = db.query(Transaction).join(
                BankStatement, Transaction.statement_id == BankStatement.id
            ).filter(
                Transaction.activity_date == trans_data['activity_date'],
                credit_filter,
                Transaction.description == trans_data['description'],
                BankStatement.building_id == building_id
            ).first()
        if existing:
            # Only skip truly confirmed transactions (matched + approved by user).
            # Unmatched/unconfirmed duplicates are skipped from re-insertion too,
            # but they will surface in the building-wide unmatched review.
            if existing.is_confirmed or existing.matched_tenant_id:
                skipped_count += 1
                continue
            # Unmatched duplicate: skip inserting but don't count as skipped
            # (it will appear in the building-wide unmatched review)
            continue

        payer_name = trans_data.get('payer_name') or ''

        # Create transaction
        transaction = Transaction(
            statement_id=bank_statement.id,
            activity_date=trans_data['activity_date'],
            reference_number=trans_data['reference_number'],
            description=trans_data['description'],
            extended_description=trans_data.get('extended_description'),
            payer_name=payer_name or None,
            credit_amount=trans_data['credit_amount'],
            debit_amount=trans_data['debit_amount'],
            balance=trans_data['balance'],
            transaction_type=TransactionType(trans_data['transaction_type'])
        )

        # Try to match if auto_match enabled and it's a payment
        if auto_match and trans_data['transaction_type'] == 'payment' and payer_name:
            description = trans_data.get('description', '')

            # 1. Learned match: check against previously confirmed NameMappings first
            if not _is_check_or_cash(description):
                learned_tid = learned_map.get(payer_name.strip().lower())
                if learned_tid:
                    transaction.matched_tenant_id = learned_tid
                    transaction.match_confidence = 1.0
                    transaction.match_method = MatchMethod.LEARNED
                    transaction.is_confirmed = True
                    matched_count += 1
                    db.add(transaction)
                    db.flush()  # need transaction.id before creating allocation
                    allocation_service.upsert_single_tenant_allocation(
                        db=db,
                        transaction=transaction,
                        tenant_id=learned_tid,
                    )
                    if trans_data['transaction_type'] == 'payment':
                        payment_transactions.append(trans_data)
                    continue  # skip fuzzy matching

            # 2. Fuzzy matching
            tenant_id, confidence, method = matcher.match_transaction_to_tenants(
                payer_name=payer_name,
                tenants=tenants_dict,
                actual_amount=trans_data['credit_amount']
            )

            if tenant_id:
                transaction.matched_tenant_id = UUID(tenant_id)
                transaction.match_confidence = confidence
                # Safe fallback: new engine methods (token_based, family_name) may not
                # be in the MatchMethod enum yet — map unknown methods to FUZZY
                try:
                    transaction.match_method = MatchMethod(method)
                except ValueError:
                    transaction.match_method = MatchMethod.FUZZY
                # Auto-confirm high confidence matches
                is_auto_confirmed = confidence >= 0.9
                transaction.is_confirmed = is_auto_confirmed
                matched_count += 1

                # Mirror the match into transaction_allocations (PR-2 invariant)
                db.add(transaction)
                db.flush()  # so transaction.id is populated
                allocation_service.upsert_single_tenant_allocation(
                    db=db,
                    transaction=transaction,
                    tenant_id=UUID(tenant_id),
                )

                # Save to NameMapping when auto-confirming a high-confidence fuzzy match
                if is_auto_confirmed and not _is_check_or_cash(description):
                    existing_mapping = db.query(NameMapping).filter(
                        NameMapping.building_id == building_id,
                        NameMapping.bank_name == payer_name,
                    ).first()
                    if not existing_mapping:
                        db.add(NameMapping(
                            building_id=building_id,
                            bank_name=payer_name,
                            tenant_id=UUID(tenant_id),
                            created_by=MappingCreatedBy.AUTO,
                        ))
                        # Also update learned_map so subsequent transactions in this upload benefit
                        learned_map[payer_name.strip().lower()] = UUID(tenant_id)
            else:
                unmatched_count += 1

        # Expense classification: outgoing transfers (debit rows)
        elif (
            trans_data['transaction_type'] == 'transfer'
            and trans_data.get('debit_amount')
        ):
            from decimal import Decimal as _D
            description = trans_data.get('description', '')
            result = vc.classify(description, building_vendor_mappings)
            if result:
                db.add(transaction)
                db.flush()
                db.add(TransactionAllocation(
                    transaction_id=transaction.id,
                    tenant_id=None,
                    label=result['vendor_label'],
                    category=result['category'],
                    amount=_D(str(abs(trans_data['debit_amount']))),
                ))
                expense_classified += 1
                continue  # already added above
            else:
                expense_unclassified += 1

        # Bank fees & VAT: auto-route to the "עמלות ומסים" expense category
        elif (
            trans_data['transaction_type'] == 'fee'
            and trans_data.get('debit_amount')
        ):
            from decimal import Decimal as _D
            fee_cat = ensure_fee_category(db, building_id)
            db.add(transaction)
            db.flush()
            db.add(TransactionAllocation(
                transaction_id=transaction.id,
                tenant_id=None,
                label=(trans_data.get('description') or 'עמלות / מסים')[:255],
                category_id=fee_cat.id,
                amount=_D(str(abs(trans_data['debit_amount']))),
            ))
            expense_classified += 1
            continue

        db.add(transaction)

        if trans_data['transaction_type'] == 'payment':
            payment_transactions.append(trans_data)

    # Commit all changes
    try:
        db.commit()
        db.refresh(bank_statement)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save transactions: {str(e)}"
        )

    return {
        "message": "Bank statement uploaded and processed successfully",
        "statement_id": str(bank_statement.id),
        "period": f"{metadata.get('period_month')}/{metadata.get('period_year')}",
        "total_transactions": len(transactions_data),
        "payment_transactions": len(payment_transactions),
        "matched": matched_count,
        "unmatched": unmatched_count,
        "skipped_duplicates": skipped_count,
        "expense_classified": expense_classified,
        "expense_unclassified": expense_unclassified,
        "match_rate": f"{(matched_count / len(payment_transactions) * 100):.1f}%" if payment_transactions else "N/A",
        "duplicate_warning": duplicate_warning,
    }


@router.get("/{statement_id}/review")
def get_statement_review(
    statement_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer_plus),
):
    """
    Get a grouped review of all transactions in a statement.
    Returns matched, unmatched (with engine suggestions), and expense rows.
    Used to power the post-upload review modal.
    """
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bank statement with id {statement_id} not found"
        )

    # Load all transactions for this statement
    statement_transactions = db.query(Transaction).filter(
        Transaction.statement_id == statement_id
    ).order_by(Transaction.activity_date).all()

    # Load ALL unmatched payment/credit-transfer transactions for the building (across all statements).
    # This ensures previously uploaded but unmatched transactions are always surfaced.
    #
    # NOTE: `is_confirmed == False` is critical here. By the PR-3 invariant,
    # `matched_tenant_id` is also NULL for confirmed multi-tenant splits and
    # confirmed non-tenant labeled allocations (e.g. "החזר חשמל" expense
    # refunds). Without the is_confirmed filter those resolved rows would
    # bleed into the "unmatched" tab of any future statement's review modal,
    # letting the user accidentally re-assign them to a tenant and overwrite
    # the existing allocations.
    all_unmatched_transactions = (
        db.query(Transaction)
        .join(BankStatement, Transaction.statement_id == BankStatement.id)
        .filter(
            BankStatement.building_id == statement.building_id,
            Transaction.matched_tenant_id == None,
            Transaction.is_confirmed == False,
            Transaction.transaction_type.in_([TransactionType.PAYMENT, TransactionType.TRANSFER]),
            # Only credit-side transfers belong in unmatched; debit transfers go to expenses
            ~((Transaction.transaction_type == TransactionType.TRANSFER) & (Transaction.debit_amount != None)),
        )
        .order_by(Transaction.activity_date)
        .all()
    )

    # Load active tenants for suggestion engine
    tenants = db.query(Tenant).join(Apartment, Tenant.apartment_id == Apartment.id).filter(
        Apartment.building_id == statement.building_id,
        Tenant.is_active == True
    ).all()
    tenants_dict = [
        {'id': str(t.id), 'name': t.name, 'full_name': t.full_name or t.name}
        for t in tenants
    ]

    # Tenant lookup by id for matched group
    tenant_map = {str(t.id): t.name for t in tenants}

    matcher = NameMatchingEngine(confidence_threshold=0.7)
    parser = BankStatementParser()

    # Load ALL outgoing debit transfers for the building (across all statements).
    # Mirrors the all_unmatched_transactions logic so previously-uploaded
    # expenses that were never categorized stay visible until the user deals
    # with them — same UX guarantee the unmatched-income tab provides.
    all_expense_transactions = (
        db.query(Transaction)
        .join(BankStatement, Transaction.statement_id == BankStatement.id)
        .filter(
            BankStatement.building_id == statement.building_id,
            Transaction.transaction_type == TransactionType.TRANSFER,
            Transaction.debit_amount != None,
        )
        .order_by(Transaction.activity_date)
        .all()
    )

    matched = []
    unmatched = []
    expenses = []
    statement_tx_ids = {str(t.id) for t in statement_transactions}

    def _build_expense_row(t: Transaction, *, is_current: bool) -> dict:
        payer_name = t.payer_name or parser._extract_payer_name(t.description) or ''
        expense_alloc = next(
            (a for a in (t.allocations or [])
             if a.tenant_id is None and (a.category or a.category_id)),
            None,
        )
        cat_name = None
        cat_color = None
        cat_id = None
        if expense_alloc and expense_alloc.category_id:
            cat = db.query(ExpenseCategory).filter(
                ExpenseCategory.id == expense_alloc.category_id
            ).first()
            if cat:
                cat_name = cat.name
                cat_color = cat.color
                cat_id = str(cat.id)
        source_label: str | None = None
        if not is_current and t.statement:
            source_label = _format_period_label(t.statement.period_month, t.statement.period_year)
        return {
            'id': str(t.id),
            'activity_date': t.activity_date.isoformat(),
            'description': t.description,
            'extended_description': t.extended_description,
            'payer_name': payer_name,
            'credit_amount': float(t.credit_amount) if t.credit_amount else None,
            'debit_amount': float(t.debit_amount) if t.debit_amount else None,
            'transaction_type': t.transaction_type.value if t.transaction_type else 'other',
            'vendor_label': expense_alloc.label if expense_alloc else None,
            'category': expense_alloc.category if expense_alloc else None,
            'category_id': cat_id,
            'category_name': cat_name,
            'category_color': cat_color,
            'notes': expense_alloc.notes if expense_alloc else None,
            'allocation_id': str(expense_alloc.id) if expense_alloc else None,
            'is_from_current_statement': is_current,
            'source_period_label': source_label,
        }

    # Process current statement for matched / expenses
    for t in statement_transactions:
        # Prefer stored payer_name (correctly extracted during upload for all formats)
        # Fall back to on-the-fly extraction from description for older transactions
        payer_name = t.payer_name or parser._extract_payer_name(t.description) or ''
        base = {
            'id': str(t.id),
            'activity_date': t.activity_date.isoformat(),
            'description': t.description,
            'extended_description': t.extended_description,
            'payer_name': payer_name,
            'credit_amount': float(t.credit_amount) if t.credit_amount else None,
            'debit_amount': float(t.debit_amount) if t.debit_amount else None,
            'transaction_type': t.transaction_type.value if t.transaction_type else 'other',
        }

        # Any non-payment row (outgoing transfer, bank fee, "other"/ignored)
        # is treated as an expense row. Credit-side payment matching still
        # owns the 'payment' type.
        is_expense_row = (
            (t.transaction_type == TransactionType.TRANSFER and t.debit_amount)
            or t.transaction_type == TransactionType.FEE
            or t.transaction_type == TransactionType.OTHER
        )
        if is_expense_row:
            expenses.append(_build_expense_row(t, is_current=True))
            continue

        if t.matched_tenant_id or (t.is_confirmed and (t.allocations or [])):
            # Three flavors of "resolved" payment rows land here:
            #   1. Single-tenant match (matched_tenant_id is set)
            #   2. Confirmed multi-tenant split (matched_tenant_id NULL, 2+ allocations)
            #   3. Confirmed non-tenant labeled allocation (matched_tenant_id NULL,
            #      1+ label allocs — e.g. "החזר חשמל" refunds)
            # All three need to leave the unmatched bucket so the user gets
            # visible feedback and can't accidentally double-match them.
            allocations_payload = [
                {
                    'id': str(a.id),
                    'tenant_id': str(a.tenant_id) if a.tenant_id else None,
                    'tenant_name': tenant_map.get(str(a.tenant_id), '') if a.tenant_id else None,
                    'label': a.label,
                    'amount': float(a.amount) if a.amount is not None else None,
                    'period_month': (
                        a.apartment_period_debt.month if a.apartment_period_debt
                        else (t.activity_date.month if t.activity_date else None)
                    ),
                    'period_year': (
                        a.apartment_period_debt.year if a.apartment_period_debt
                        else (t.activity_date.year if t.activity_date else None)
                    ),
                    'category': a.category,
                }
                for a in (t.allocations or [])
            ]
            matched.append({
                **base,
                'tenant_id': str(t.matched_tenant_id) if t.matched_tenant_id else None,
                'tenant_name': (
                    tenant_map.get(str(t.matched_tenant_id), '')
                    if t.matched_tenant_id else None
                ),
                'match_confidence': t.match_confidence,
                'match_method': t.match_method.value if t.match_method else None,
                'is_confirmed': t.is_confirmed,
                'allocations': allocations_payload,
            })
        # Unmatched from the current statement will be included via all_unmatched_transactions below

    # Build unmatched list from ALL building-wide unmatched payment transactions
    seen_ids = {t['id'] for t in matched}  # avoid double-counting if statement overlaps
    for t in all_unmatched_transactions:
        if str(t.id) in seen_ids:
            continue
        payer_name = t.payer_name or parser._extract_payer_name(t.description) or ''
        suggestions = []
        if payer_name and tenants_dict:
            raw_suggestions = matcher.suggest_matches(payer_name, tenants_dict, top_n=3)
            suggestions = [
                {'tenant_id': s[0], 'tenant_name': s[2], 'score': round(s[1], 2)}
                for s in raw_suggestions
            ]
        is_current = t.statement_id == statement_id
        source_label: str | None = None
        if not is_current and t.statement:
            source_label = _format_period_label(t.statement.period_month, t.statement.period_year)
        unmatched.append({
            'id': str(t.id),
            'activity_date': t.activity_date.isoformat(),
            'description': t.description,
            'extended_description': t.extended_description,
            'payer_name': payer_name,
            'credit_amount': float(t.credit_amount) if t.credit_amount else None,
            'debit_amount': float(t.debit_amount) if t.debit_amount else None,
            'transaction_type': t.transaction_type.value if t.transaction_type else 'other',
            'suggestions': suggestions,
            'is_from_current_statement': is_current,
            'source_period_label': source_label,
        })

    # Append legacy expenses: uncategorized debit transfers from PREVIOUS statements.
    # Same UX guarantee as the unmatched-income legacy section — keeps orphan
    # expenses visible until the user categorizes or deletes them.
    for t in all_expense_transactions:
        if str(t.id) in statement_tx_ids:
            continue
        has_category = any(
            (a.tenant_id is None and (a.category or a.category_id))
            for a in (t.allocations or [])
        )
        if has_category:
            continue
        expenses.append(_build_expense_row(t, is_current=False))

    # All tenants list (for manual selection dropdown in UI)
    all_tenants = [
        {'tenant_id': str(t.id), 'tenant_name': t.name}
        for t in tenants
    ]

    return {
        'statement_id': str(statement_id),
        'period': f"{statement.period_month}/{statement.period_year}",
        'matched': matched,
        'unmatched': unmatched,
        'expenses': expenses,
        'all_tenants': all_tenants,
    }


@router.get("/{statement_id}/transactions")
def get_statement_transactions(
    statement_id: UUID,
    include_matched: bool = True,
    include_unmatched: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer_plus),
):
    """Get all transactions for a specific bank statement"""
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bank statement with id {statement_id} not found"
        )

    query = db.query(Transaction).filter(Transaction.statement_id == statement_id)

    # Apply filters
    if not include_matched:
        query = query.filter(Transaction.matched_tenant_id == None)
    if not include_unmatched:
        query = query.filter(Transaction.matched_tenant_id != None)

    transactions = query.all()

    return {
        "statement_id": str(statement_id),
        "building_id": str(statement.building_id),
        "period": f"{statement.period_month}/{statement.period_year}",
        "transaction_count": len(transactions),
        "transactions": [
            {
                "id": str(t.id),
                "activity_date": t.activity_date.isoformat(),
                "description": t.description,
                "extended_description": t.extended_description,
                "credit_amount": float(t.credit_amount) if t.credit_amount else None,
                "debit_amount": float(t.debit_amount) if t.debit_amount else None,
                "matched_tenant_id": str(t.matched_tenant_id) if t.matched_tenant_id else None,
                "match_confidence": t.match_confidence,
                "match_method": t.match_method.value if t.match_method else None,
                "is_confirmed": t.is_confirmed
            }
            for t in transactions
        ]
    }


@router.get("/transactions/{transaction_id}/review-form")
def get_transaction_review_form(
    transaction_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer_plus),
):
    """Return a single transaction shaped like a `ReviewTransaction` plus
    the building's tenant list — used by the AllocationDrawer when opened
    outside of the statement-review flow (e.g. from CollectionTab).
    """
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction with id {transaction_id} not found",
        )

    # Resolve owning building. Statement-derived transactions carry statement_id;
    # manual payments (is_manual=True) do not — derive building from the first
    # allocation's tenant → apartment instead.
    statement = None
    if transaction.statement_id:
        statement = db.query(BankStatement).filter(
            BankStatement.id == transaction.statement_id
        ).first()

    building_id = None
    if statement:
        building_id = statement.building_id
    else:
        first_alloc = next(
            (a for a in (transaction.allocations or []) if a.tenant_id is not None),
            None,
        )
        if first_alloc is not None:
            apt = (
                db.query(Apartment)
                .join(Tenant, Tenant.apartment_id == Apartment.id)
                .filter(Tenant.id == first_alloc.tenant_id)
                .first()
            )
            if apt is not None:
                building_id = apt.building_id

    if building_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Unable to resolve owning building for this transaction",
        )

    tenants = db.query(Tenant).join(Apartment, Tenant.apartment_id == Apartment.id).filter(
        Apartment.building_id == building_id,
        Tenant.is_active == True,
    ).all()
    tenant_map = {str(t.id): t.name for t in tenants}

    parser = BankStatementParser()
    payer_name = transaction.payer_name or parser._extract_payer_name(transaction.description) or ''

    allocations_payload = [
        {
            'id': str(a.id),
            'tenant_id': str(a.tenant_id) if a.tenant_id else None,
            'tenant_name': tenant_map.get(str(a.tenant_id), '') if a.tenant_id else None,
            'label': a.label,
            'amount': float(a.amount) if a.amount is not None else None,
            'period_month': (
                a.apartment_period_debt.month if a.apartment_period_debt
                else (transaction.activity_date.month if transaction.activity_date else None)
            ),
            'period_year': (
                a.apartment_period_debt.year if a.apartment_period_debt
                else (transaction.activity_date.year if transaction.activity_date else None)
            ),
            'category': a.category,
        }
        for a in (transaction.allocations or [])
    ]

    tx_payload = {
        'id': str(transaction.id),
        'activity_date': transaction.activity_date.isoformat(),
        'description': transaction.description,
        'extended_description': transaction.extended_description,
        'payer_name': payer_name,
        'credit_amount': float(transaction.credit_amount) if transaction.credit_amount else None,
        'debit_amount': float(transaction.debit_amount) if transaction.debit_amount else None,
        'transaction_type': transaction.transaction_type.value if transaction.transaction_type else 'other',
        'tenant_id': str(transaction.matched_tenant_id) if transaction.matched_tenant_id else None,
        'tenant_name': tenant_map.get(str(transaction.matched_tenant_id), '') if transaction.matched_tenant_id else None,
        'match_confidence': transaction.match_confidence,
        'match_method': transaction.match_method.value if transaction.match_method else None,
        'is_confirmed': transaction.is_confirmed,
        'allocations': allocations_payload,
    }

    all_tenants = [
        {'tenant_id': str(t.id), 'tenant_name': t.name}
        for t in tenants
    ]

    return {
        'tx': tx_payload,
        'all_tenants': all_tenants,
        'building_id': str(building_id),
    }


@router.post("/transactions/{transaction_id}/allocations", response_model=List[AllocationResponse])
def set_transaction_allocations(
    transaction_id: UUID,
    payload: SetAllocationsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Replace all allocations for a transaction with the given list.

    Accepts splits (multiple tenants), multi-month (one tenant, multiple
    period rows), and non-tenant income (label only). Sum must equal the
    transaction's headline amount within 0.01.

    Sets matched_tenant_id only when the result is a single full-amount
    tenant allocation; NULL otherwise.
    """
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction with id {transaction_id} not found"
        )

    try:
        created = allocation_service.set_split_allocations(
            db=db,
            transaction=transaction,
            allocations=[a.model_dump() for a in payload.allocations],
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    transaction.match_method = MatchMethod.MANUAL
    transaction.match_confidence = 1.0
    transaction.is_confirmed = True

    db.commit()

    return [
        AllocationResponse(
            id=str(a.id),
            transaction_id=str(a.transaction_id),
            tenant_id=str(a.tenant_id) if a.tenant_id else None,
            label=a.label,
            amount=float(a.amount),
            period_month=(
                a.apartment_period_debt.month if a.apartment_period_debt
                else (transaction.activity_date.month if transaction.activity_date else None)
            ),
            period_year=(
                a.apartment_period_debt.year if a.apartment_period_debt
                else (transaction.activity_date.year if transaction.activity_date else None)
            ),
            category=a.category,
            notes=a.notes,
            created_at=a.created_at.isoformat(),
        )
        for a in created
    ]


@router.post("/transactions/{transaction_id}/match/{tenant_id}")
def manually_match_transaction(
    transaction_id: UUID,
    tenant_id: UUID,
    remember: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Manually match a transaction to a single tenant (thin wrapper over set_transaction_allocations)."""
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction with id {transaction_id} not found"
        )

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant with id {tenant_id} not found"
        )

    from decimal import Decimal as _D
    headline = (
        _D(str(transaction.credit_amount))
        if transaction.credit_amount is not None
        else _D(str(transaction.debit_amount or 0))
    )
    try:
        allocation_service.set_split_allocations(
            db=db,
            transaction=transaction,
            allocations=[{"tenant_id": tenant_id, "amount": headline}],
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    transaction.match_method = MatchMethod.MANUAL
    transaction.match_confidence = 1.0
    transaction.is_confirmed = True

    if remember:
        parser = BankStatementParser()
        payer_name = transaction.payer_name or parser._extract_payer_name(transaction.description)

        if payer_name and not _is_check_or_cash(transaction.description):
            statement = db.query(BankStatement).filter(
                BankStatement.id == transaction.statement_id
            ).first()

            if statement:
                existing_mapping = db.query(NameMapping).filter(
                    NameMapping.building_id == statement.building_id,
                    NameMapping.bank_name == payer_name,
                ).first()

                if not existing_mapping:
                    db.add(NameMapping(
                        building_id=statement.building_id,
                        bank_name=payer_name,
                        tenant_id=tenant_id,
                        created_by=MappingCreatedBy.MANUAL,
                    ))
                elif existing_mapping.tenant_id != tenant_id:
                    existing_mapping.tenant_id = tenant_id
                    existing_mapping.created_by = MappingCreatedBy.MANUAL

    db.commit()
    db.refresh(transaction)

    return {
        "message": "Transaction matched successfully",
        "transaction_id": str(transaction.id),
        "tenant_id": str(tenant_id),
        "remember": remember,
    }


@router.post("/transactions/{transaction_id}/unmatch")
def unmatch_transaction(
    transaction_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Remove a match from a transaction, sending it back to the unmatched pool."""
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction with id {transaction_id} not found"
        )

    transaction.matched_tenant_id = None
    transaction.match_confidence = None
    transaction.match_method = None
    transaction.is_confirmed = False
    # Drop any allocations attached to this transaction
    allocation_service.clear_for_transaction(db, transaction.id)

    db.commit()
    return {"ok": True, "transaction_id": str(transaction_id)}


@router.post("/transactions/{transaction_id}/ignore")
def ignore_transaction(
    transaction_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Convert a transaction into an uncategorized expense (e.g., the user
    decided a credit row isn't a tenant payment, or a fee row needs manual
    categorization). Clears any tenant match, flips type to OTHER so the
    review endpoint surfaces it in the Expenses tab, and creates an empty
    expense allocation the user can categorize.
    """
    from decimal import Decimal as _D

    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction with id {transaction_id} not found"
        )

    transaction.matched_tenant_id = None
    transaction.match_confidence = None
    transaction.match_method = None
    transaction.is_confirmed = False
    transaction.transaction_type = TransactionType.OTHER
    # Drop any prior tenant allocations and seed an uncategorized expense row.
    allocation_service.clear_for_transaction(db, transaction.id)
    amount = transaction.debit_amount or transaction.credit_amount or _D("0")
    db.add(TransactionAllocation(
        transaction_id=transaction.id,
        tenant_id=None,
        label=(transaction.description or 'ללא קטגוריה')[:255],
        amount=_D(str(abs(amount))),
    ))

    db.commit()
    return {"ok": True, "transaction_id": str(transaction_id)}


@router.patch("/transactions/{transaction_id}")
def patch_transaction(
    transaction_id: UUID,
    payload: TransactionPatchRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Edit fields on a single transaction.

    Amount-change semantics:
    - 0 or 1 allocations → update freely; if 1 allocation, sync its amount too.
    - 2+ allocations → 409 with code='split_allocation_requires_resplit'.
    Description/date edits are never blocked.
    """
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail=f"Transaction with id {transaction_id} not found")

    data = payload.model_dump(exclude_unset=True)
    amount_changed = "credit_amount" in data or "debit_amount" in data

    if amount_changed:
        allocations = list(transaction.allocations or [])
        if len(allocations) >= 2:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "split_allocation_requires_resplit",
                    "message": "Transaction has split allocations; reassign them before changing the amount.",
                    "allocation_count": len(allocations),
                    "transaction_id": str(transaction.id),
                },
            )

    if "activity_date" in data:
        transaction.activity_date = data["activity_date"]
    if "description" in data:
        transaction.description = data["description"]
    if "credit_amount" in data:
        transaction.credit_amount = data["credit_amount"]
    if "debit_amount" in data:
        transaction.debit_amount = data["debit_amount"]

    # Sync the single allocation amount when present
    if amount_changed and (transaction.allocations and len(transaction.allocations) == 1):
        new_amt = transaction.credit_amount if transaction.credit_amount is not None else transaction.debit_amount
        if new_amt is not None:
            transaction.allocations[0].amount = abs(new_amt)

    db.commit()
    db.refresh(transaction)

    return {
        "id": str(transaction.id),
        "activity_date": transaction.activity_date.isoformat(),
        "description": transaction.description,
        "extended_description": transaction.extended_description,
        "credit_amount": float(transaction.credit_amount) if transaction.credit_amount is not None else None,
        "debit_amount": float(transaction.debit_amount) if transaction.debit_amount is not None else None,
    }


@router.delete("/transactions/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """
    Hard-delete a transaction from the building.
    Used by the review UI when the user wants to remove an entry entirely
    (e.g., the bank exported a duplicate or a clearly-erroneous row).
    Returns 204 No Content — frontend must not parse a JSON body.
    """
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction with id {transaction_id} not found"
        )

    db.delete(transaction)
    db.commit()
    return None


@router.delete("/{statement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_statement(
    statement_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """
    Hard-delete a bank statement and all its transactions + allocations.
    NameMappings and VendorMappings are intentionally preserved — they are a
    learned training set, not statement metadata.
    Returns 204 No Content.
    """
    statement = db.query(BankStatement).filter(BankStatement.id == statement_id).first()
    if not statement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bank statement with id {statement_id} not found",
        )

    db.delete(statement)
    db.commit()
    return None


@router.get("/{building_id}/statements")
def list_building_statements(
    building_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer_plus),
):
    """List all bank statements for a building"""
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    statements = db.query(BankStatement).filter(
        BankStatement.building_id == building_id
    ).order_by(BankStatement.period_year.desc(), BankStatement.period_month.desc()).all()

    # Compute match counts per statement. PAYMENT transactions with a matched_tenant_id
    # count as matched; PAYMENT/credit-TRANSFER without one count as unmatched.
    return {
        "building_id": str(building_id),
        "statement_count": len(statements),
        "statements": [
            {
                "id": str(s.id),
                "filename": s.original_filename,
                "period": f"{s.period_month}/{s.period_year}",
                "upload_date": s.upload_date.isoformat(),
                "transaction_count": len(s.transactions),
                "matched_count": sum(
                    1 for t in s.transactions
                    if t.matched_tenant_id is not None
                    and t.transaction_type == TransactionType.PAYMENT
                ),
                "unmatched_count": sum(
                    1 for t in s.transactions
                    if t.matched_tenant_id is None
                    and (
                        t.transaction_type == TransactionType.PAYMENT
                        or (t.transaction_type == TransactionType.TRANSFER and t.credit_amount)
                    )
                ),
            }
            for s in statements
        ],
    }


# ── Categorize endpoints ──────────────────────────────────────────────────────

@transactions_router.post("/{transaction_id}/categorize")
def categorize_transaction(
    transaction_id: UUID,
    body: CategorizeRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Manually classify a debit transaction as an expense.
    Creates or replaces the expense allocation.
    If body.remember=True, upserts a VendorMapping so future uploads auto-classify.
    """
    from decimal import Decimal

    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if not transaction.debit_amount:
        raise HTTPException(status_code=400, detail="Transaction is not a debit row")

    # Get period (and building_id) from the parent bank statement.
    statement = db.query(BankStatement).filter(
        BankStatement.id == transaction.statement_id
    ).first()

    # Validate category — prefer category_id (per-building), fall back to legacy string.
    from ..models.transaction_allocation import ALLOCATION_CATEGORIES
    category_obj = None
    if body.category_id is not None:
        category_obj = db.query(ExpenseCategory).filter(
            ExpenseCategory.id == body.category_id
        ).first()
        if not category_obj:
            raise HTTPException(status_code=400, detail="Unknown category_id")
        if statement and category_obj.building_id != statement.building_id:
            raise HTTPException(
                status_code=400,
                detail="Category does not belong to this building",
            )
    elif body.category is not None:
        if body.category not in ALLOCATION_CATEGORIES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid category. Must be one of: {', '.join(ALLOCATION_CATEGORIES)}",
            )
    else:
        raise HTTPException(
            status_code=400,
            detail="Either category_id or category is required",
        )

    # Remove any existing expense allocation for this transaction
    existing = db.query(TransactionAllocation).filter(
        TransactionAllocation.transaction_id == transaction_id,
        TransactionAllocation.tenant_id == None,
    ).first()
    if existing:
        db.delete(existing)
        db.flush()

    alloc = TransactionAllocation(
        transaction_id=transaction_id,
        tenant_id=None,
        label=body.vendor_label,
        category=body.category,  # legacy (may be None when category_id is used)
        category_id=category_obj.id if category_obj else None,
        amount=Decimal(str(abs(transaction.debit_amount))),
        notes=(body.notes.strip() if body.notes and body.notes.strip() else None),
    )
    db.add(alloc)

    # Upsert VendorMapping if remember=True. The mapping stores the building
    # category name as the legacy string so the vendor classifier can re-apply
    # it on the next upload.
    if body.remember and statement:
        keyword = body.vendor_label.strip().lower()
        remember_category = category_obj.name if category_obj else body.category
        existing_mapping = db.query(VendorMapping).filter(
            VendorMapping.building_id == statement.building_id,
            VendorMapping.keyword == keyword,
        ).first()
        if existing_mapping:
            existing_mapping.vendor_label = body.vendor_label
            existing_mapping.category = remember_category
            existing_mapping.created_by = MappingCreatedBy.MANUAL
        else:
            db.add(VendorMapping(
                building_id=statement.building_id,
                keyword=keyword,
                vendor_label=body.vendor_label,
                category=remember_category,
                created_by=MappingCreatedBy.MANUAL,
            ))

    db.commit()
    db.refresh(alloc)

    return {
        "allocation_id": str(alloc.id),
        "vendor_label": alloc.label,
        "category": alloc.category,
        "category_id": str(alloc.category_id) if alloc.category_id else None,
        "category_name": category_obj.name if category_obj else None,
        "category_color": category_obj.color if category_obj else None,
        "notes": alloc.notes,
        "amount": float(alloc.amount),
    }


@transactions_router.delete("/{transaction_id}/categorize", status_code=status.HTTP_204_NO_CONTENT)
def uncategorize_transaction(
    transaction_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Remove the expense allocation from a debit transaction,
    returning it to the uncategorized expenses group.
    """
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")

    alloc = db.query(TransactionAllocation).filter(
        TransactionAllocation.transaction_id == transaction_id,
        TransactionAllocation.tenant_id == None,
    ).first()
    if alloc:
        db.delete(alloc)
        db.commit()


# ── Vendor mapping management ─────────────────────────────────────────────────

@vendor_mappings_router.get("/buildings/{building_id}/vendor-mappings/")
def list_vendor_mappings(
    building_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """List all user-defined vendor classification rules for a building."""
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    mappings = db.query(VendorMapping).filter(
        VendorMapping.building_id == building_id
    ).order_by(VendorMapping.created_at.desc()).all()

    return {
        "building_id": str(building_id),
        "count": len(mappings),
        "mappings": [
            {
                "id": str(m.id),
                "keyword": m.keyword,
                "vendor_label": m.vendor_label,
                "category": m.category,
                "created_by": m.created_by.value,
                "created_at": m.created_at.isoformat(),
            }
            for m in mappings
        ],
    }


@vendor_mappings_router.delete("/vendor-mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor_mapping(
    mapping_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Remove a learned vendor classification rule."""
    mapping = db.query(VendorMapping).filter(VendorMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Vendor mapping not found")
    db.delete(mapping)
    db.commit()
