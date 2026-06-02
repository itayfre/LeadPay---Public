import { useQuery } from '@tanstack/react-query';
import { paymentsAPI } from '../services/api';
import type { PortfolioTrendMonth } from '../types';

const MONTHS = 13;

export function useCollectionTrend() {
  return useQuery<PortfolioTrendMonth[]>({
    queryKey: ['portfolioTrend', MONTHS],
    queryFn: () => paymentsAPI.getPortfolioTrend(MONTHS),
    staleTime: 5 * 60 * 1000, // 5 min — trend data changes slowly
  });
}
