import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Layout from '../components/layout/Layout';
import Button from '../components/ui/Button';
import { settingsAPI } from '../services/api';
import type { RiskThresholds } from '../types';
import { DEFAULT_RISK_THRESHOLDS } from '../lib/buildingStatus';
import { useRiskThresholds } from '../context/ConfigContext';
import { useAuth } from '../context/AuthContext';

export default function Settings() {
  const navigate = useNavigate();

  const settingsItems = [
    {
      title: 'תבניות WhatsApp',
      description: 'ערוך את תבניות ההודעות שנשלחות לדיירים',
      path: '/whatsapp-templates',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
  ];

  return (
    <Layout>
      <div className="space-y-6" dir="rtl">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">הגדרות</h1>
          <p className="text-sm text-ink-500 mt-1">הגדרות מערכת ואישיות</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {settingsItems.map((item, index) => (
            <div
              key={index}
              role="button"
              tabIndex={0}
              onClick={() => item.path && navigate(item.path)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (item.path) navigate(item.path); } }}
              className="group bg-white rounded-xl ring-1 ring-ink-200 shadow-sm hover:shadow-md transition p-5 flex flex-col gap-4 cursor-pointer focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-ink-900">{item.title}</h3>
                  <p className="text-[13px] text-ink-500 mt-0.5">{item.description}</p>
                </div>
              </div>
              <Button variant="secondary" className="w-full" onClick={() => item.path && navigate(item.path)}>
                פתח
              </Button>
            </div>
          ))}
        </div>

        <RiskThresholdsCard />
      </div>
    </Layout>
  );
}

function RiskThresholdsCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const liveThresholds = useRiskThresholds();

  const isManager = user?.role === 'manager';

  const [partial, setPartial] = useState<number>(liveThresholds.partial);
  const [onTrack, setOnTrack] = useState<number>(liveThresholds.onTrack);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Keep local form in sync if the live config changes externally (first load,
  // another tab saved, etc.). Adjusting state during render — rather than in an
  // effect — avoids a cascading re-render. See react.dev "storing information
  // from previous renders".
  const [syncedFrom, setSyncedFrom] = useState(liveThresholds);
  if (
    syncedFrom.partial !== liveThresholds.partial ||
    syncedFrom.onTrack !== liveThresholds.onTrack
  ) {
    setSyncedFrom(liveThresholds);
    setPartial(liveThresholds.partial);
    setOnTrack(liveThresholds.onTrack);
  }

  // Hide the "saved" pill after a few seconds
  useEffect(() => {
    if (savedAt === null) return;
    const id = window.setTimeout(() => setSavedAt(null), 2500);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  const validationError = (() => {
    if (!Number.isInteger(partial) || !Number.isInteger(onTrack)) return t('settings.thresholds.errors.integer');
    if (partial < 0 || partial > 100 || onTrack < 0 || onTrack > 100) return t('settings.thresholds.errors.range');
    if (partial >= onTrack) return t('settings.thresholds.errors.order');
    return null;
  })();

  const isDirty = partial !== liveThresholds.partial || onTrack !== liveThresholds.onTrack;

  const mutation = useMutation<RiskThresholds, Error, RiskThresholds>({
    mutationFn: (body) => settingsAPI.putRiskThresholds(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      setSavedAt(Date.now());
    },
  });

  const onSave = () => {
    if (validationError) return;
    mutation.mutate({ partial, onTrack });
  };

  const onReset = () => {
    setPartial(DEFAULT_RISK_THRESHOLDS.partial);
    setOnTrack(DEFAULT_RISK_THRESHOLDS.onTrack);
  };

  const saveDisabled = !!validationError || !isDirty || mutation.isPending || !isManager;

  return (
    <div className="bg-white rounded-xl ring-1 ring-ink-200 shadow-sm overflow-hidden" dir="rtl">
      <div className="px-6 py-5 border-b border-ink-100 flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center shrink-0">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <div>
          <h3 className="text-[15px] font-semibold text-ink-900">{t('settings.thresholds.title')}</h3>
          <p className="text-[13px] text-ink-500 mt-0.5">{t('settings.thresholds.description')}</p>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Partial threshold */}
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-2">
            {t('settings.thresholds.partialLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Number.isFinite(partial) ? partial : 0}
              onChange={e => setPartial(parseInt(e.target.value, 10) || 0)}
              disabled={!isManager || mutation.isPending}
              className="w-24 h-10 rounded-md ring-1 ring-ink-200 px-3 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:bg-ink-100"
            />
            <span className="text-sm text-ink-500">%</span>
            <span className="text-xs text-ink-500 mr-3">{t('settings.thresholds.partialHint')}</span>
          </div>
        </div>

        {/* On-track threshold */}
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-2">
            {t('settings.thresholds.onTrackLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={Number.isFinite(onTrack) ? onTrack : 0}
              onChange={e => setOnTrack(parseInt(e.target.value, 10) || 0)}
              disabled={!isManager || mutation.isPending}
              className="w-24 h-10 rounded-md ring-1 ring-ink-200 px-3 text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-accent-500 disabled:bg-ink-100"
            />
            <span className="text-sm text-ink-500">%</span>
            <span className="text-xs text-ink-500 mr-3">{t('settings.thresholds.onTrackHint')}</span>
          </div>
        </div>

        {/* Inline error */}
        {validationError && isDirty && (
          <div className="text-[13px] text-danger-600 font-medium">{validationError}</div>
        )}

        {/* Server error */}
        {mutation.isError && (
          <div className="text-[13px] text-danger-600 font-medium">
            {mutation.error.message}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-ink-100">
          <button
            onClick={onReset}
            disabled={!isManager || mutation.isPending}
            className="text-[13px] font-medium text-ink-500 hover:text-ink-900 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('settings.thresholds.resetDefaults')}
          </button>

          <div className="flex items-center gap-3">
            {savedAt !== null && (
              <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {t('settings.thresholds.saved')}
              </span>
            )}
            <Button
              onClick={onSave}
              disabled={saveDisabled}
              title={!isManager ? t('settings.thresholds.errors.notManager') : undefined}
            >
              {mutation.isPending ? t('common.saving') : t('settings.thresholds.save')}
            </Button>
          </div>
        </div>

        {!isManager && (
          <p className="text-[12px] text-ink-500 text-center pt-1">
            {t('settings.thresholds.errors.notManager')}
          </p>
        )}
      </div>
    </div>
  );
}
