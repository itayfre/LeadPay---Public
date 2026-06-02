import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Layout from '../components/layout/Layout';
import Button from '../components/ui/Button';
import TenantModal from '../components/modals/TenantModal';
import TenantImportModal from '../components/modals/TenantImportModal';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import MonthlyImportModal from '../components/modals/MonthlyImportModal';
import { buildingsAPI, tenantsAPI, apartmentsAPI, paymentsAPI } from '../services/api';
import type { Tenant } from '../types';

const SortIcon = ({
  col,
  sortColumn,
  sortDirection,
}: {
  col: string;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
}) => {
  const active = sortColumn === col;
  return (
    <svg
      className={`inline-block w-3 h-3 ml-1 ${active ? 'text-primary-600' : 'text-ink-300'} ${active && sortDirection === 'asc' ? 'rotate-180' : ''}`}
      fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"
    >
      <path d="M10 13l-4-4h8l-4 4z" />
    </svg>
  );
};

export default function Tenants() {
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showMonthlyImportModal, setShowMonthlyImportModal] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  // Apartment-grouped view: track which apartments are expanded.
  // Default collapsed so the page is a quick overview; click to drill in.
  const [expandedApts, setExpandedApts] = useState<Set<string>>(new Set());
  const toggleApt = (aptId: string) =>
    setExpandedApts((prev) => {
      const next = new Set(prev);
      if (next.has(aptId)) next.delete(aptId);
      else next.add(aptId);
      return next;
    });
  const [editTenant, setEditTenant] = useState<Tenant | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deleteTenant, setDeleteTenant] = useState<Tenant | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingPaymentValue, setEditingPaymentValue] = useState<string>('');
  const [savingPayment, setSavingPayment] = useState(false);

  // Task 15: move_in_date editing state
  const [editingMoveInId, setEditingMoveInId] = useState<string | null>(null);
  const [editingMoveInValue, setEditingMoveInValue] = useState<string>('');
  const [savingMoveIn, setSavingMoveIn] = useState(false);

  const { data: building } = useQuery({
    queryKey: ['building', buildingId],
    queryFn: () => buildingsAPI.get(buildingId!),
    enabled: !!buildingId,
  });

  const { data: tenants, isLoading } = useQuery({
    queryKey: ['tenants', buildingId],
    queryFn: () => tenantsAPI.list(buildingId!),
    enabled: !!buildingId,
  });

  const { data: tenantDebts } = useQuery({
    queryKey: ['tenantDebts', buildingId],
    queryFn: () => paymentsAPI.getTenantDebts(buildingId!),
    enabled: !!buildingId,
  });

  const { data: archivedTenants, isLoading: archivedLoading } = useQuery({
    queryKey: ['tenants', buildingId, 'archived'],
    queryFn: () => tenantsAPI.listArchived(buildingId!),
    enabled: !!buildingId && showArchive,
  });

  // Sort state
  const [sortColumn, setSortColumn] = useState<string>('apartment_number');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const sortedTenants = useMemo(() => [...(tenants || [])].sort((a, b) => {
    // Primary: active tenants always come before inactive, regardless of column/direction.
    const activeDelta = (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
    if (activeDelta !== 0) return activeDelta;

    const dir = sortDirection === 'asc' ? 1 : -1;
    switch (sortColumn) {
      case 'apartment_number':
        return ((a.apartment_number || 0) - (b.apartment_number || 0)) * dir;
      case 'name':
        return a.name.localeCompare(b.name, 'he') * dir;
      case 'ownership_type':
        return (a.ownership_type || '').localeCompare(b.ownership_type || '', 'he') * dir;
      case 'language':
        return a.language.localeCompare(b.language) * dir;
      case 'standing_order_start_date':
        return (a.standing_order_start_date || '').localeCompare(b.standing_order_start_date || '') * dir;
      case 'is_active':
        return 0;  // already handled by activeDelta above
      case 'expected_payment': {
        const aV = a.expected_payment ?? a.building_expected_payment ?? 0;
        const bV = b.expected_payment ?? b.building_expected_payment ?? 0;
        return (aV - bV) * dir;
      }
      case 'total_debt': {
        const aD = tenantDebts?.[a.id] ?? 0;
        const bD = tenantDebts?.[b.id] ?? 0;
        return (aD - bD) * dir;
      }
      case 'move_in_date': {
        const aV = a.effective_move_in_date || a.move_in_date || '';
        const bV = b.effective_move_in_date || b.move_in_date || '';
        return aV.localeCompare(bV) * dir;
      }
      default:
        return 0;
    }
  }), [tenants, sortColumn, sortDirection, tenantDebts]);

  // Group sortedTenants by apartment. Active-first sort within each group
  // is preserved from sortedTenants. Apartment groups are ordered by apt
  // number for stable visual layout regardless of column-level sort.
  const apartmentGroups = useMemo(() => {
    const map = new Map<string, { aptId: string; aptNumber: number; tenants: Tenant[] }>();
    for (const t of sortedTenants) {
      const existing = map.get(t.apartment_id);
      if (existing) {
        existing.tenants.push(t);
      } else {
        map.set(t.apartment_id, {
          aptId: t.apartment_id,
          aptNumber: t.apartment_number ?? 0,
          tenants: [t],
        });
      }
    }
    return [...map.values()].sort((a, b) => a.aptNumber - b.aptNumber);
  }, [sortedTenants]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tenants', buildingId] });
    queryClient.invalidateQueries({ queryKey: ['building', buildingId] });
    queryClient.invalidateQueries({ queryKey: ['paymentStatus', buildingId] });
    queryClient.invalidateQueries({ queryKey: ['tenantDebts', buildingId] });
  };

  const handleRestore = async (t: Tenant) => {
    setRestoringId(t.id);
    try {
      await tenantsAPI.restore(t.id);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['tenants', buildingId, 'archived'] });
    } catch (err) {
      console.error(err);
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTenant) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await tenantsAPI.delete(deleteTenant.id);
      setDeleteTenant(null);
      invalidate();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('active payer')) {
        setDeleteError('לא ניתן להעביר לארכיון את המשלם הראשי כשיש עוד דיירים בדירה. החלף תחילה את המשלם הראשי דרך עריכת הדייר.');
      } else {
        setDeleteError(msg);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleSavePayment = async (tenant: Tenant) => {
    setSavingPayment(true);
    try {
      const val = editingPaymentValue === '' ? null : parseFloat(editingPaymentValue);
      await apartmentsAPI.patch(tenant.apartment_id, { expected_payment: val });
      invalidate();
      setEditingPaymentId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPayment(false);
    }
  };

  const handleResetPayment = async (tenant: Tenant) => {
    setSavingPayment(true);
    try {
      await apartmentsAPI.patch(tenant.apartment_id, { expected_payment: null });
      invalidate();
      setEditingPaymentId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingPayment(false);
    }
  };

  // Task 15: save move_in_date
  const handleSaveMoveIn = async (tenant: Tenant) => {
    setSavingMoveIn(true);
    try {
      await tenantsAPI.update(tenant.id, { move_in_date: editingMoveInValue });
      invalidate();
      setEditingMoveInId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingMoveIn(false);
    }
  };

  // Reset per-tenant override → fall back to building default
  const handleResetMoveIn = async (tenant: Tenant) => {
    setSavingMoveIn(true);
    try {
      await tenantsAPI.update(tenant.id, { move_in_date: null });
      invalidate();
      setEditingMoveInId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingMoveIn(false);
    }
  };

  const OWNERSHIP_COLOR: Record<string, string> = {
    'בעלים': 'bg-primary-100 text-primary-800',
    'משכיר': 'bg-purple-100 text-purple-800',
    'שוכר': 'bg-accent-100 text-accent-700',
  };

  return (
    <Layout>
      <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <button
              onClick={() => navigate(`/building/${buildingId}`)}
              className="text-primary-600 hover:text-primary-800 mb-2 inline-flex items-center gap-1 text-sm font-medium"
            >
              <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              חזרה לדשבורד
            </button>
            <h2 className="text-2xl font-bold text-ink-900">{building?.name || 'טוען...'}</h2>
            <p className="text-sm text-ink-500">
              ניהול דיירים • {tenants?.length || 0} דיירים רשומים
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button variant="secondary" onClick={() => setShowMonthlyImportModal(true)} title="ייבוא סכומי תשלום חודשי לכל דירה מקובץ Excel">
              ייבוא סכומי חודש
            </Button>
            <Button variant="secondary" onClick={() => setShowImportModal(true)}>
              ייבוא מ-Excel
            </Button>
            <Button onClick={() => setShowAddModal(true)}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              הוסף דייר
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl ring-1 ring-ink-200 overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : (tenants?.length ?? 0) === 0 ? (
            <div className="text-center py-16">
              <svg className="w-12 h-12 mx-auto mb-4 text-ink-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h3 className="text-xl font-bold text-ink-900 mb-2">אין דיירים עדיין</h3>
              <p className="text-ink-500 mb-6">הוסף דיירים ידנית או ייבא מ-Excel</p>
              <div className="flex gap-3 justify-center">
                <Button variant="secondary" onClick={() => setShowImportModal(true)}>
                  ייבוא מ-Excel
                </Button>
                <Button onClick={() => setShowAddModal(true)}>
                  הוסף דייר ראשון
                </Button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-200">
                <thead className="bg-ink-50">
                  <tr>
                    <th onClick={() => handleSort('apartment_number')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      דירה<SortIcon col="apartment_number" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th onClick={() => handleSort('name')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      שם<SortIcon col="name" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th onClick={() => handleSort('ownership_type')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      סוג בעלות<SortIcon col="ownership_type" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">
                      טלפון
                    </th>
                    <th onClick={() => handleSort('language')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      שפה<SortIcon col="language" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th onClick={() => handleSort('standing_order_start_date')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      ה.קבע<SortIcon col="standing_order_start_date" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th onClick={() => handleSort('is_active')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      פעיל<SortIcon col="is_active" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th onClick={() => handleSort('expected_payment')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      תשלום צפוי<SortIcon col="expected_payment" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th
                      onClick={tenantDebts !== undefined ? () => handleSort('total_debt') : undefined}
                      className={`px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider select-none ${tenantDebts !== undefined ? 'cursor-pointer hover:bg-ink-100' : 'cursor-default opacity-60'}`}>
                      חוב כולל{tenantDebts !== undefined && <SortIcon col="total_debt" sortColumn={sortColumn} sortDirection={sortDirection} />}
                    </th>
                    <th onClick={() => handleSort('move_in_date')}
                      className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider cursor-pointer hover:bg-ink-100 select-none">
                      תאריך כניסה<SortIcon col="move_in_date" sortColumn={sortColumn} sortDirection={sortDirection} />
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-ink-500 uppercase tracking-wider">
                      פעולות
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-ink-100">
                  {apartmentGroups.flatMap(group => {
                    const isExpanded = expandedApts.has(group.aptId);
                    const primary = group.tenants.find(t => t.is_active) ?? group.tenants[0];
                    const aptExpected =
                      primary?.expected_payment ?? primary?.building_expected_payment ?? null;
                    const aptDebt = group.tenants.reduce(
                      (sum, t) => sum + (tenantDebts?.[t.id] ?? 0),
                      0
                    );
                    const standingOrderTenant = group.tenants.find(
                      t => t.standing_order_start_date
                    );
                    const headerRow = (
                      <tr
                        key={`apt-${group.aptId}`}
                        onClick={() => toggleApt(group.aptId)}
                        className="bg-slate-50 hover:bg-slate-100 cursor-pointer transition-colors border-t-2 border-slate-200"
                      >
                        <td className="px-4 py-2 text-sm font-bold text-ink-900">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="text-ink-500 text-xs transition-transform inline-block"
                              style={{ transform: isExpanded ? 'rotate(90deg)' : undefined }}
                            >▶</span>
                            <span className="text-base">{group.aptNumber || '—'}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2" colSpan={4}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-ink-900">{primary?.name ?? '—'}</span>
                            {primary?.is_active && (
                              <span className="text-[10px] uppercase tracking-wide text-slate-500 border border-slate-200 rounded px-1.5 py-0.5 bg-white">
                                משלם ראשי
                              </span>
                            )}
                            {primary?.ownership_type && (
                              <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-semibold rounded ${OWNERSHIP_COLOR[primary.ownership_type] || 'bg-ink-100 text-ink-700'}`}>
                                {primary.ownership_type}
                              </span>
                            )}
                            <span className="text-xs text-ink-500">
                              {group.tenants.length === 1
                                ? 'דייר אחד'
                                : `${group.tenants.length} דיירים`}
                            </span>
                          </div>
                        </td>
                        {/* ה.קבע */}
                        <td className="px-4 py-2 text-center">
                          {standingOrderTenant ? (
                            <span className="inline-flex flex-col items-end text-xs leading-tight text-sky-700" dir="ltr">
                              <span className="font-medium">{standingOrderTenant.standing_order_start_date}</span>
                              {standingOrderTenant.standing_order_amount != null && (
                                <span className="text-sky-600">₪{Math.round(standingOrderTenant.standing_order_amount).toLocaleString()}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        {/* פעיל */}
                        <td className="px-4 py-2 text-center">
                          {group.tenants.some(t => t.is_active) ? (
                            <span className="inline-block w-2.5 h-2.5 bg-accent-500 rounded-full"></span>
                          ) : (
                            <span className="inline-block w-2.5 h-2.5 bg-ink-300 rounded-full"></span>
                          )}
                        </td>
                        {/* תשלום צפוי (apt-level) */}
                        <td className="px-4 py-2 text-sm">
                          {aptExpected != null ? (
                            primary?.expected_payment != null ? (
                              <span className="text-ink-900">₪{aptExpected.toLocaleString()}</span>
                            ) : (
                              <span className="text-ink-500">₪{aptExpected.toLocaleString()}*</span>
                            )
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        {/* חוב כולל (apt aggregate) */}
                        <td className="px-4 py-2 text-sm">
                          {tenantDebts === undefined ? (
                            <span className="text-ink-300 text-xs">טוען...</span>
                          ) : (
                            <span className={aptDebt > 0 ? 'text-danger-600 font-medium' : 'text-accent-500'}>
                              ₪{Math.round(aptDebt).toLocaleString()}
                            </span>
                          )}
                        </td>
                        {/* תאריך כניסה */}
                        <td className="px-4 py-2 text-sm">
                          {primary?.effective_move_in_date ? (
                            <span className="text-ink-500">
                              {new Date(primary.effective_move_in_date).toLocaleDateString('he-IL')}
                            </span>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink-500">
                          {isExpanded ? 'סגור' : 'פתח'}
                        </td>
                      </tr>
                    );
                    if (!isExpanded) return [headerRow];
                    const tenantRows = group.tenants.map(tenant => {
                      const isPrimary = tenant.id === primary?.id;
                      return (
                    <tr key={tenant.id} className="hover:bg-ink-50 transition-colors">
                      <td className="px-4 py-3 text-sm font-bold text-ink-900">
                        {tenant.apartment_number || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-ink-900">{tenant.name}</div>
                        {tenant.full_name && tenant.full_name !== tenant.name && (
                          <div className="text-xs text-ink-500">{tenant.full_name}</div>
                        )}
                        {tenant.email && (
                          <div className="text-xs text-ink-500" dir="ltr">{tenant.email}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${OWNERSHIP_COLOR[tenant.ownership_type ?? ''] || 'bg-ink-100 text-ink-700'}`}>
                          {tenant.ownership_type || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-700" dir="ltr">
                        {tenant.phone || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs rounded ${tenant.language === 'he' ? 'bg-primary-50 text-primary-700' : 'bg-ink-100 text-ink-700'}`}>
                          {tenant.language === 'he' ? 'עב' : 'EN'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tenant.standing_order_start_date ? (
                          <span className="inline-flex flex-col items-end text-xs leading-tight text-sky-700" dir="ltr">
                            <span className="font-medium">{tenant.standing_order_start_date}</span>
                            {tenant.standing_order_amount != null && (
                              <span className="text-sky-600">₪{Math.round(tenant.standing_order_amount).toLocaleString()}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {tenant.is_active ? (
                          <span className="inline-block w-2.5 h-2.5 bg-accent-500 rounded-full"></span>
                        ) : (
                          <span className="inline-block w-2.5 h-2.5 bg-ink-300 rounded-full"></span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {!isPrimary ? (
                          <span className="text-ink-300">—</span>
                        ) : editingPaymentId === tenant.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={editingPaymentValue}
                              onChange={e => setEditingPaymentValue(e.target.value)}
                              placeholder="סכום"
                              className="w-20 rounded ring-1 ring-ink-200 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSavePayment(tenant);
                                if (e.key === 'Escape') setEditingPaymentId(null);
                              }}
                            />
                            <button
                              onClick={() => handleSavePayment(tenant)}
                              disabled={savingPayment}
                              className="text-accent-600 hover:text-accent-700 font-bold"
                              title="שמור"
                            >✓</button>
                            <button
                              onClick={() => setEditingPaymentId(null)}
                              className="text-ink-500 hover:text-ink-700"
                              title="ביטול"
                            >✗</button>
                            {tenant.expected_payment != null && (
                              <button
                                onClick={() => handleResetPayment(tenant)}
                                className="text-xs text-primary-500 hover:text-primary-700"
                                title="חזור לברירת מחדל של הבניין"
                              >🔄</button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingPaymentId(tenant.id);
                              setEditingPaymentValue(
                                tenant.expected_payment != null
                                  ? String(tenant.expected_payment)
                                  : ''
                              );
                            }}
                            className="flex items-center gap-1 group"
                            title="לחץ לעריכה"
                          >
                            {tenant.expected_payment != null ? (
                              <span className="text-ink-900">₪{tenant.expected_payment.toLocaleString()}</span>
                            ) : tenant.building_expected_payment != null ? (
                              <span className="text-ink-500">₪{tenant.building_expected_payment.toLocaleString()}*</span>
                            ) : (
                              <span className="text-ink-300">—</span>
                            )}
                            <svg className="w-3.5 h-3.5 text-ink-300 group-hover:text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        )}
                      </td>

                      {/* חוב כולל (auto-loaded) */}
                      <td className="px-4 py-3 text-sm">
                        {tenantDebts === undefined ? (
                          <span className="text-ink-300 text-xs">טוען...</span>
                        ) : (
                          <span className={(tenantDebts[tenant.id] ?? 0) > 0 ? 'text-danger-600 font-medium' : 'text-accent-500'}>
                            ₪{Math.round(tenantDebts[tenant.id] ?? 0).toLocaleString()}
                          </span>
                        )}
                      </td>

                      {/* Task 15: תאריך כניסה (move_in_date) — two-tier: tenant override → building default */}
                      <td className="px-4 py-3 text-sm">
                        {editingMoveInId === tenant.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={editingMoveInValue}
                              onChange={e => setEditingMoveInValue(e.target.value)}
                              className="rounded ring-1 ring-ink-200 px-2 py-1 text-sm focus:ring-2 focus:ring-primary-500"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleSaveMoveIn(tenant);
                                if (e.key === 'Escape') setEditingMoveInId(null);
                              }}
                            />
                            <button
                              onClick={() => handleSaveMoveIn(tenant)}
                              disabled={savingMoveIn}
                              className="text-accent-600 hover:text-accent-700 text-xs font-bold px-1"
                              title="שמור"
                            >✓</button>
                            <button
                              onClick={() => setEditingMoveInId(null)}
                              className="text-ink-500 hover:text-ink-700 text-xs px-1"
                              title="ביטול"
                            >✕</button>
                            {tenant.move_in_date && (
                              <button
                                onClick={() => handleResetMoveIn(tenant)}
                                disabled={savingMoveIn}
                                className="text-xs text-primary-500 hover:text-primary-700"
                                title="חזור לברירת מחדל של הבניין"
                              >🔄</button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingMoveInId(tenant.id);
                              setEditingMoveInValue(
                                tenant.move_in_date
                                || tenant.effective_move_in_date
                                || tenant.building_default_move_in_date
                                || '2026-01-01'
                              );
                            }}
                            className="text-ink-700 hover:text-primary-600 hover:underline cursor-pointer text-sm"
                            title={tenant.move_in_date ? 'לחץ לעריכת תאריך כניסה' : 'משתמש בברירת מחדל של הבניין — לחץ לעריכה'}
                          >
                            {tenant.move_in_date ? (
                              <span className="text-ink-900">
                                {new Date(tenant.move_in_date).toLocaleDateString('he-IL')}
                              </span>
                            ) : tenant.effective_move_in_date ? (
                              <span className="text-ink-500">
                                {new Date(tenant.effective_move_in_date).toLocaleDateString('he-IL')}*
                              </span>
                            ) : (
                              <span className="text-ink-300">—</span>
                            )}
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditTenant(tenant)}
                            className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-500 hover:text-primary-600 hover:bg-ink-100 transition-colors"
                            title="עריכה"
                            aria-label="עריכה"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => { setDeleteTenant(tenant); setDeleteError(null); }}
                            className="w-9 h-9 flex items-center justify-center rounded-lg text-ink-500 hover:text-danger-600 hover:bg-danger-50 transition-colors"
                            title="מחיקה"
                            aria-label="מחיקה"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                    });
                    return [headerRow, ...tenantRows];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Archive section */}
        <div className="pt-4">
          <button
            onClick={() => setShowArchive(s => !s)}
            className="text-sm text-ink-700 hover:text-ink-900 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span>{showArchive ? 'הסתר ארכיון דיירים' : 'הצג ארכיון דיירים'}</span>
            {archivedTenants && archivedTenants.length > 0 && (
              <span className="text-xs bg-ink-200 text-ink-700 rounded-full px-2 py-0.5">
                {archivedTenants.length}
              </span>
            )}
          </button>
          {showArchive && (
            <div className="mt-3 bg-white rounded-xl ring-1 ring-ink-200 overflow-hidden shadow-sm">
              {archivedLoading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-500"></div>
                </div>
              ) : (archivedTenants?.length ?? 0) === 0 ? (
                <div className="text-center py-8 text-sm text-ink-500">
                  אין דיירים בארכיון
                </div>
              ) : (
                <table className="min-w-full divide-y divide-ink-200">
                  <thead className="bg-ink-50">
                    <tr>
                      <th className="px-4 py-2 text-right text-xs font-medium text-ink-500 uppercase">דירה</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-ink-500 uppercase">שם</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-ink-500 uppercase">טלפון</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-ink-500 uppercase">אימייל</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-ink-500 uppercase">הועבר לארכיון</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-ink-500 uppercase">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-ink-100">
                    {archivedTenants!.map(t => (
                      <tr key={t.id} className="hover:bg-ink-50">
                        <td className="px-4 py-2 text-sm font-bold text-ink-700">{t.apartment_number || '—'}</td>
                        <td className="px-4 py-2 text-sm text-ink-900">{t.name}</td>
                        <td className="px-4 py-2 text-sm text-ink-700" dir="ltr">{t.phone || '—'}</td>
                        <td className="px-4 py-2 text-sm text-ink-700" dir="ltr">{t.email || '—'}</td>
                        <td className="px-4 py-2 text-sm text-ink-500">
                          {t.archived_at ? new Date(t.archived_at).toLocaleDateString('he-IL') : '—'}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          <button
                            onClick={() => handleRestore(t)}
                            disabled={restoringId === t.id}
                            className="text-primary-600 hover:text-primary-800 disabled:opacity-50 text-sm font-medium"
                          >
                            {restoringId === t.id ? 'משחזר...' : '↩ שחזר'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editTenant) && (
        <TenantModal
          buildingId={buildingId!}
          tenant={editTenant}
          onClose={() => { setShowAddModal(false); setEditTenant(null); }}
          onSaved={invalidate}
        />
      )}

      {/* Import Modal */}
      {showImportModal && (
        <TenantImportModal
          buildingId={buildingId!}
          onClose={() => setShowImportModal(false)}
          onImported={invalidate}
        />
      )}

      {/* Monthly-amounts Excel import */}
      <MonthlyImportModal
        isOpen={showMonthlyImportModal}
        buildingId={buildingId!}
        onClose={() => setShowMonthlyImportModal(false)}
        onApplied={invalidate}
      />


      {/* Delete Confirmation */}
      {deleteError && deleteTenant && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-danger-50 border border-danger-50 rounded-lg px-4 py-3 text-danger-600 text-sm shadow-lg">
          {deleteError}
        </div>
      )}
      <ConfirmDialog
        isOpen={!!deleteTenant}
        title="העברה לארכיון"
        message={deleteTenant ? `הדייר "${deleteTenant.name}" יועבר לארכיון ויוסתר מהרשימה. ניתן יהיה לשחזר אותו בכל עת מכפתור "ארכיון" בתחתית העמוד. להמשיך?` : ''}
        confirmText={deleting ? 'מעביר...' : 'העבר לארכיון'}
        cancelText="ביטול"
        type="warning"
        onConfirm={handleDelete}
        onCancel={() => { setDeleteTenant(null); setDeleteError(null); }}
      />
    </Layout>
  );
}
