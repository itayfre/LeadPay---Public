import type { RiskThresholds } from '../types';

/**
 * In-code defaults — single source of truth for the home page when the
 * backend `app_config` table has no `risk_thresholds` row yet, or when
 * `GET /api/v1/settings/` is still loading / fails. Mirrored on the backend
 * in `app/schemas/settings.py::DEFAULT_RISK_THRESHOLDS`.
 */
export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = { partial: 30, onTrack: 70 };

export type BuildingStatus = 'onTrack' | 'partial' | 'atRisk' | 'needsSetup';

export function buildingStatus(
  hasMonthlyRate: boolean,
  collectionRate: number | undefined,
  thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS,
): BuildingStatus {
  if (!hasMonthlyRate) return 'needsSetup';
  const rate = collectionRate ?? 0;
  if (rate >= thresholds.onTrack) return 'onTrack';
  if (rate >= thresholds.partial) return 'partial';
  return 'atRisk';
}

export interface StatusVisual {
  dotClass: string;
  textClass: string;
  bgClass: string;
  barClass: string;
  sparkColor: string;
}

export const STATUS_VISUALS: Record<BuildingStatus, StatusVisual> = {
  onTrack:    { dotClass: 'bg-accent-500', textClass: 'text-accent-700', bgClass: 'bg-accent-50',  barClass: 'bg-accent-500', sparkColor: '#10B981' },
  partial:    { dotClass: 'bg-warn-500',   textClass: 'text-warn-600',   bgClass: 'bg-warn-50',    barClass: 'bg-warn-500',   sparkColor: '#F59E0B' },
  atRisk:     { dotClass: 'bg-danger-500', textClass: 'text-danger-600', bgClass: 'bg-danger-50',  barClass: 'bg-danger-500', sparkColor: '#EF4444' },
  needsSetup: { dotClass: 'bg-ink-400',    textClass: 'text-ink-700',    bgClass: 'bg-ink-100',    barClass: 'bg-ink-300',    sparkColor: '#8C95A1' },
};
