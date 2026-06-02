import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Layout from '../components/layout/Layout';
import { buildingsAPI, paymentsAPI } from '../services/api';
import type { Building, BuildingPaymentSummary } from '../types';
import ConfirmDialog from '../components/modals/ConfirmDialog';
import BuildingEditModal from '../components/modals/BuildingEditModal';
import CollectionTrendChart from '../components/charts/CollectionTrendChart';
import { useCollectionTrend } from '../hooks/useCollectionTrend';
import PortfolioKpiStrip from '../components/building/PortfolioKpiStrip';
import FilterBar, { type SizeFilter, type StatusFilter } from '../components/building/FilterBar';
import BuildingCardV2 from '../components/building/BuildingCardV2';
import { buildingStatus } from '../lib/buildingStatus';
import { useRiskThresholds } from '../context/ConfigContext';

export default function Buildings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const thresholds = useRiskThresholds();

  const [buildingToDelete, setBuildingToDelete] = useState<Building | null>(null);
  const [buildingToEdit, setBuildingToEdit] = useState<Building | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [search, setSearch] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('');
  const [filterSize, setFilterSize] = useState<SizeFilter>('');
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: buildings, isLoading, error } = useQuery({
    queryKey: ['buildings'],
    queryFn: buildingsAPI.list,
  });

  const { data: bulkSummary } = useQuery({
    queryKey: ['bulkSummary', selectedMonth, selectedYear],
    queryFn: () => paymentsAPI.getBulkSummary(selectedMonth, selectedYear),
  });

  const persistFilter = (month: number, year: number) => {
    try { localStorage.setItem('lp:lastBuildingFilter', JSON.stringify({ month, year })); } catch { /* ignore */ }
  };

  const { data: trendData, isLoading: trendLoading } = useCollectionTrend();

  const summaryMap: Record<string, BuildingPaymentSummary> = useMemo(
    () => Object.fromEntries((bulkSummary || []).map(s => [s.building_id, s])),
    [bulkSummary],
  );

  // Per-building 13-month rate series, derived from the existing portfolio-trend payload.
  const trendByBuilding: Record<string, number[]> = useMemo(() => {
    const out: Record<string, number[]> = {};
    if (!trendData) return out;
    for (const m of trendData) {
      for (const b of m.buildings) {
        if (!out[b.building_id]) out[b.building_id] = [];
        out[b.building_id].push(b.rate);
      }
    }
    return out;
  }, [trendData]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => buildingsAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buildings'] });
      setBuildingToDelete(null);
      setDeleteError(null);
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  const handleDelete = () => {
    if (!buildingToDelete) return;
    deleteMutation.mutate(buildingToDelete.id);
  };

  const handleEdit = async (data: Partial<Building>) => {
    if (!buildingToEdit) return;
    await buildingsAPI.update(buildingToEdit.id, data);
    queryClient.invalidateQueries({ queryKey: ['buildings'] });
    setBuildingToEdit(null);
  };

  const handleCreate = async (data: Partial<Building>) => {
    await buildingsAPI.create(data as Omit<Building, 'id' | 'created_at' | 'updated_at'>);
    queryClient.invalidateQueries({ queryKey: ['buildings'] });
  };

  const cities = [...new Set((buildings || []).map((b: Building) => b.city).filter(Boolean))].sort() as string[];

  const filteredBuildings = (buildings || []).filter((b: Building) => {
    if (search) {
      const q = search.toLowerCase();
      if (!b.name.toLowerCase().includes(q) && !b.address.toLowerCase().includes(q)) return false;
    }
    if (filterCity && b.city !== filterCity) return false;
    const tenantCount = b.total_tenants || 0;
    if (filterSize === 'small' && !(tenantCount >= 1 && tenantCount <= 5)) return false;
    if (filterSize === 'medium' && !(tenantCount >= 6 && tenantCount <= 15)) return false;
    if (filterSize === 'large' && !(tenantCount >= 16)) return false;
    if (filterStatus) {
      const s = summaryMap[b.id];
      if (!s) return filterStatus === 'none_paid';
      if (filterStatus === 'all_paid' && s.collection_rate < 100) return false;
      if (filterStatus === 'partial' && (s.collection_rate === 0 || s.collection_rate >= 100)) return false;
      if (filterStatus === 'none_paid' && s.collection_rate > 0) return false;
    }
    return true;
  });

  // KPI strip aggregates across ALL buildings (not the filtered subset) so the user
  // always sees full-portfolio context regardless of which filters are active.
  const portfolio = useMemo(() => {
    const allBuildings = buildings || [];
    let collected = 0;
    let expected = 0;
    let unpaidTenants = 0;
    let atRisk = 0;
    for (const b of allBuildings) {
      const s = summaryMap[b.id];
      const target = b.total_expected_monthly ?? (b.expected_monthly_payment != null ? b.expected_monthly_payment * (b.total_tenants || 0) : 0);
      const hasRate = target > 0;
      const c = s?.total_collected ?? 0;
      const e = s?.total_expected ?? target;
      collected += c;
      expected += e;
      unpaidTenants += s?.unpaid ?? (b.total_tenants || 0);
      const status = buildingStatus(hasRate, s?.collection_rate, thresholds);
      if (status === 'atRisk' || status === 'needsSetup') atRisk += 1;
    }
    return { collected, expected, unpaidTenants, atRisk, total: allBuildings.length };
  }, [buildings, summaryMap, thresholds]);

  const monthLabel = useMemo(() => {
    const locale = i18n.language === 'en' ? 'en-US' : 'he-IL';
    return new Date(selectedYear, selectedMonth - 1).toLocaleString(locale, { month: 'long', year: 'numeric' });
  }, [selectedMonth, selectedYear, i18n.language]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-ink-200 border-t-accent-500 mx-auto" />
            <p className="mt-6 text-sm text-ink-500 font-medium">{t('common.loading')}</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="bg-danger-50 border-l-4 border-danger-500 rounded-r-lg p-6">
          <p className="text-sm font-medium text-danger-600">{t('common.error')}: {(error as Error).message}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-7" dir="rtl">
        {/* Page header */}
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[12px] text-ink-500 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500" />
              <span>{monthLabel}</span>
            </div>
            <h1 className="text-[28px] font-semibold tracking-tight leading-none text-ink-900">{t('nav.buildings')}</h1>
            <p className="text-[14px] text-ink-500 mt-2">
              {t('buildings.header.summary', {
                count: filteredBuildings.length,
                total: (buildings || []).length,
              })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selectedMonth}
              onChange={e => { const m = Number(e.target.value); setSelectedMonth(m); persistFilter(m, selectedYear); }}
              className="h-9 ring-1 ring-ink-200 rounded-md bg-white px-3 text-[13px] font-medium text-ink-700 focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <option key={m} value={m}>
                  {new Date(2024, m - 1).toLocaleString(i18n.language === 'en' ? 'en-US' : 'he-IL', { month: 'long' })}
                </option>
              ))}
            </select>
            <select
              value={selectedYear}
              onChange={e => { const y = Number(e.target.value); setSelectedYear(y); persistFilter(selectedMonth, y); }}
              className="h-9 ring-1 ring-ink-200 rounded-md bg-white px-3 text-[13px] font-medium text-ink-700 focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              {Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - 1 + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <button
              onClick={() => setShowAddModal(true)}
              className="h-9 px-3 rounded-md bg-ink-900 text-white text-[13px] font-medium hover:bg-ink-700 transition flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t('buildings.addBuilding')}
            </button>
          </div>
        </div>

        <PortfolioKpiStrip
          collected={portfolio.collected}
          expected={portfolio.expected}
          atRiskCount={portfolio.atRisk}
          totalBuildings={portfolio.total}
          unpaidTenants={portfolio.unpaidTenants}
        />

        <FilterBar
          search={search} onSearchChange={setSearch}
          city={filterCity} onCityChange={setFilterCity} cities={cities}
          size={filterSize} onSizeChange={setFilterSize}
          status={filterStatus} onStatusChange={setFilterStatus}
        />

        {filteredBuildings.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBuildings.map((building: Building) => (
              <BuildingCardV2
                key={building.id}
                building={building}
                summary={summaryMap[building.id]}
                trend={trendByBuilding[building.id]}
                onClick={() => {
                  if ((building.total_tenants || 0) === 0) {
                    navigate(`/building/${building.id}/tenants`);
                  } else {
                    navigate(`/building/${building.id}`);
                  }
                }}
                onEdit={() => setBuildingToEdit(building)}
                onDelete={() => setBuildingToDelete(building)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-xl ring-1 ring-ink-200">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-ink-100 mb-5">
              <svg className="w-7 h-7 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21h18M5 21V7l7-4 7 4v14M9 10h2M9 14h2M13 10h2M13 14h2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-ink-900 mb-2">
              {search || filterCity || filterStatus || filterSize
                ? t('buildings.empty.filteredTitle')
                : t('buildings.empty.title')}
            </h3>
            <p className="text-ink-500 mb-6 max-w-md mx-auto text-sm">
              {search || filterCity || filterStatus || filterSize
                ? t('buildings.empty.filteredBody')
                : t('buildings.empty.body')}
            </p>
            {!(search || filterCity || filterStatus || filterSize) && (
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900 text-white text-sm font-medium rounded-md hover:bg-ink-700 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {t('buildings.empty.firstCta')}
              </button>
            )}
          </div>
        )}

        {/* 13-month chart — now a deep-dive section below the grid */}
        <div className="bg-white rounded-xl ring-1 ring-ink-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink-900">{t('buildings.chart.title')}</h2>
              <p className="text-[12px] text-ink-500 mt-0.5">{t('buildings.chart.subtitle')}</p>
            </div>
          </div>
          {trendLoading ? (
            <div className="h-72 rounded-lg bg-ink-100 animate-pulse" />
          ) : (
            <CollectionTrendChart data={trendData ?? []} />
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!buildingToDelete}
        title={t('buildings.deleteBuilding')}
        message={t('buildings.deleteConfirm', { name: buildingToDelete?.name ?? '' })}
        confirmText={t('buildings.deleteConfirmCta')}
        cancelText={t('common.cancel')}
        type="danger"
        isLoading={deleteMutation.isPending}
        onConfirm={handleDelete}
        onCancel={() => {
          if (deleteMutation.isPending) return;
          setBuildingToDelete(null);
          setDeleteError(null);
        }}
      />

      <BuildingEditModal
        isOpen={!!buildingToEdit}
        building={buildingToEdit}
        onSave={handleEdit}
        onCancel={() => setBuildingToEdit(null)}
      />

      <BuildingEditModal
        isOpen={showAddModal}
        building={null}
        onSave={handleCreate}
        onCancel={() => setShowAddModal(false)}
      />

      {deleteError && (
        <div className="fixed bottom-4 right-4 bg-danger-50 ring-1 ring-danger-500/30 rounded-lg p-4 shadow-xl max-w-md">
          <p className="text-danger-600 font-medium text-sm">{deleteError}</p>
        </div>
      )}
    </Layout>
  );
}
