import { useQuery } from '@tanstack/react-query';
import { paymentsAPI } from '../services/api';
import type { BuildingSummaryStats } from '../types';
import { toYYYYMM } from './useBuildingPeriodRange';
import type { MonthYear } from './useBuildingPeriodRange';

export function useBuildingSummary(
  buildingId: string | undefined,
  from: MonthYear,
  to: MonthYear,
  projectionMonths = 0
) {
  return useQuery<BuildingSummaryStats>({
    queryKey: ['summaryStats', buildingId, toYYYYMM(from), toYYYYMM(to), projectionMonths],
    queryFn: () =>
      paymentsAPI.getSummaryStats(buildingId!, toYYYYMM(from), toYYYYMM(to), projectionMonths),
    enabled: !!buildingId,
    staleTime: 3 * 60 * 1000,
  });
}
