import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Layout from '../components/layout/Layout';
import Button from '../components/ui/Button';
import { buildingsAPI } from '../services/api';
import BuildingTabs, { type BuildingTab } from '../components/building/BuildingTabs';
import PeriodRangePicker from '../components/building/PeriodRangePicker';
import CollectionTab from '../components/building/CollectionTab';
import SummaryTab from '../components/building/SummaryTab';
import ExpensesTab from '../components/building/ExpensesTab';
import ExportReportDialog from '../components/modals/ExportReportDialog';
import SpecialChargeModal from '../components/modals/SpecialChargeModal';
import { useBuildingPeriodRange } from '../hooks/useBuildingPeriodRange';
import { useAuth } from '../context/AuthContext';

const VALID_TABS: BuildingTab[] = ['summary', 'collection', 'expenses'];

export default function Dashboard() {
  const { t } = useTranslation();
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Tab state (URL-synced) ─────────────────────────────────────────────────
  const rawTab = searchParams.get('tab') as BuildingTab | null;
  const activeTab: BuildingTab = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'summary';

  const setTab = (tab: BuildingTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  // ── Period range (URL-synced) ──────────────────────────────────────────────
  const { range, setRange } = useBuildingPeriodRange();

  // ── Report export dialog ───────────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false);
  // ── Special-charge modal (available on all tabs) ───────────────────────────
  const [showSpecialCharge, setShowSpecialCharge] = useState(false);
  const { user } = useAuth();
  const canCreateCharges = user?.role === 'manager' || user?.role === 'worker';

  // ── Building header data ───────────────────────────────────────────────────
  const { data: building } = useQuery({
    queryKey: ['building', buildingId],
    queryFn: () => buildingsAPI.get(buildingId!),
    enabled: !!buildingId,
  });

  if (!buildingId) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-danger-600">{t('common.error')}: Missing building ID</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-5">
        {/* ── Building header ─────────────────────────────────────────────── */}
        <div className="flex justify-between items-start" dir="rtl">
          <div>
            <button
              onClick={() => navigate('/buildings')}
              className="text-primary-600 hover:text-primary-800 mb-2 inline-flex items-center gap-1 text-sm font-medium"
            >
              <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              {t('nav.buildings')}
            </button>
            <h2 className="text-2xl font-bold text-ink-900">
              {building?.name ?? t('common.loading')}
            </h2>
            {building && (
              <p className="text-sm text-ink-500 flex items-center gap-1.5 mt-0.5">
                <svg className="w-4 h-4 text-ink-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {building.address}, {building.city}
              </p>
            )}
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button variant="secondary" onClick={() => navigate(`/building/${buildingId}/tenants`)}>
              {t('nav.tenants')}
            </Button>
            <Button variant="secondary" onClick={() => navigate(`/building/${buildingId}/upload`)}>
              {t('dashboard.uploadStatement')}
            </Button>
            {canCreateCharges && (
              <Button variant="secondary" onClick={() => setShowSpecialCharge(true)}>
                {t('specialCharge.addButton')}
              </Button>
            )}
            <Button onClick={() => setShowExport(true)}>
              ייצוא דוח
            </Button>
          </div>
        </div>

        {/* ── Tabs + range picker row ──────────────────────────────────────── */}
        <BuildingTabs activeTab={activeTab} onChange={setTab} />
        <PeriodRangePicker range={range} onChange={setRange} />

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        {activeTab === 'summary' && (
          <SummaryTab
            buildingId={buildingId}
            range={range}
            onGoToExpenses={() => setTab('expenses')}
          />
        )}
        {activeTab === 'collection' && (
          <CollectionTab buildingId={buildingId} range={range} />
        )}
        {activeTab === 'expenses' && (
          <ExpensesTab buildingId={buildingId} range={range} />
        )}
      </div>

      <ExportReportDialog
        buildingId={buildingId}
        isOpen={showExport}
        onClose={() => setShowExport(false)}
      />
      <SpecialChargeModal
        isOpen={showSpecialCharge}
        buildingId={buildingId}
        onClose={() => setShowSpecialCharge(false)}
      />
    </Layout>
  );
}
